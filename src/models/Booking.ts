import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import { config } from "../models/Config";
import Payment, { IPayment, Gateways } from "./Payment";
import Store, { IStore } from "./Store";
import User, { IUser } from "./User";
import Code, { ICode } from "./Code";
import agenda from "../utils/agenda";

const { DEBUG } = process.env;

const Booking = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: User, required: true },
  store: { type: Schema.Types.ObjectId, ref: Store, required: true },
  type: { type: String, enum: ["play", "party"], default: "play" },
  date: { type: String, required: true },
  checkInAt: { type: String, required: true },
  hours: { type: Number, required: true, default: 1 },
  membersCount: { type: Number, default: 1 },
  socksCount: { type: Number, default: 0 },
  bandIds: { type: [String] },
  status: {
    type: String,
    enum: ["PENDING", "BOOKED", "IN_SERVICE", "FINISHED", "CANCELED"],
    default: "PENDING"
  },
  price: { type: Number },
  code: { type: Schema.Types.ObjectId, ref: Code },
  payments: [{ type: Schema.Types.ObjectId, ref: Payment }],
  remarks: String
});

Booking.index({ date: 1, checkInAt: 1, customer: 1 }, { unique: true });

Booking.plugin(autoPopulate, [
  { path: "customer", select: "name avatarUrl mobile" },
  "store",
  { path: "payments", options: { sort: { _id: -1 } } }
]);
Booking.plugin(updateTimes);

Booking.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

Booking.methods.calculatePrice = async function() {
  const booking = this as IBooking;

  await booking.populate("customer").execPopulate();

  const cardType = config.cardTypes[booking.customer.cardType];

  const firstHourPrice = cardType ? cardType.firstHourPrice : config.hourPrice;

  let chargedHours = booking.hours;

  if (booking.code) {
    await booking.populate("code").execPopulate();
    if (!booking.code) {
      throw new Error("coupon_not_found");
    }
    if (booking.code.used) {
      throw new Error("coupon_used");
    }
  }

  if (booking.code && booking.code.hours) {
    chargedHours -= booking.code.hours;
  }

  const sockPrice = 10;

  booking.price = +(
    config.hourPriceRatio.slice(0, chargedHours).reduce((price, ratio) => {
      return +(price + firstHourPrice * ratio).toFixed(2);
    }, 0) *
      booking.membersCount + // WARN code will reduce each user by hour, maybe unexpected
    (booking.socksCount || 0) * sockPrice
  ).toFixed(2);
};

Booking.methods.createPayment = async function(
  {
    paymentGateway = Gateways.WechatPay,
    useCredit = true,
    adminAddWithoutPayment = false,
    extendHoursBy = 0
  } = {},
  amount
) {
  const booking = this as IBooking;

  let totalPayAmount = amount || booking.price;

  let creditPayAmount = 0;

  let attach = `booking ${booking._id}`;

  if (extendHoursBy) {
    attach += ` extend ${extendHoursBy}`;
  }

  if (useCredit && booking.customer.credit && !adminAddWithoutPayment) {
    creditPayAmount = Math.min(totalPayAmount, booking.customer.credit);
    const creditPayment = new Payment({
      customer: booking.customer,
      amount: creditPayAmount,
      title: `预定${booking.store.name} ${booking.date} ${booking.hours}小时 ${booking.checkInAt}入场`,
      attach,
      gateway: Gateways.Credit
    });
    await creditPayment.save();
    booking.payments.push(creditPayment);
  }

  const extraPayAmount = totalPayAmount - creditPayAmount;
  console.log(`[PAY] Extra payment amount is ${extraPayAmount}`);

  if (extraPayAmount < 0.01 || adminAddWithoutPayment) {
    booking.status = booking.hours ? "BOOKED" : "FINISHED";
  } else {
    const extraPayment = new Payment({
      customer: booking.customer,
      amount: DEBUG === "true" ? extraPayAmount / 1e4 : extraPayAmount,
      title: `预定${booking.store.name} ${booking.date} ${booking.hours}小时 ${booking.checkInAt}入场`,
      attach,
      gateway: paymentGateway || Gateways.WechatPay
    });

    console.log(`[PAY] Extra payment: `, extraPayment.toObject());

    try {
      await extraPayment.save();
    } catch (err) {
      throw err;
    }

    booking.payments.push(extraPayment);
  }
};

Booking.methods.paymentSuccess = async function() {
  const booking = this as IBooking;
  booking.status = booking.hours ? "BOOKED" : "FINISHED";
  await booking.save();
  // send user notification
  // (re)authorize band to gate controllers
  booking.store.authBands(booking.bandIds);
  agenda.schedule("revoke band auth", `in ${booking.hours} hours`, {
    bandIds: booking.bandIds,
    storeId: booking.store.id
  });
  // (re)setup revoke job at [now + hours]
};

Booking.methods.createRefundPayment = async function() {
  const booking = this as IBooking;

  const creditPayments = booking.payments.filter(
    p => p.gateway === Gateways.Credit
  );
  const extraPayments = booking.payments.filter(
    p => p.gateway !== Gateways.Credit
  );

  await Promise.all(
    creditPayments.map(async p => {
      const refundPayment = new Payment({
        customer: p.customer,
        amount: -p.amount,
        title: `退款：${p.title}`,
        attach: p.attach,
        gateway: p.gateway
      });
      await refundPayment.save();
      booking.payments.push(refundPayment);
    })
  );

  if (!extraPayments.length) {
    booking.status = "CANCELED";
  } else {
    await Promise.all(
      extraPayments.map(async p => {
        const refundPayment = new Payment({
          customer: p.customer,
          amount: -p.amount,
          title: `退款：${p.title}`,
          attach: p.attach,
          gateway: p.gateway
        });
        await refundPayment.save();
        booking.payments.push(refundPayment);
      })
    );
  }
};

Booking.methods.refundSuccess = async function() {
  const booking = this as IBooking;
  booking.status = "CANCELED";
  await booking.save();
  // send user notification
  // revoke band auth to gate controllers
};

Booking.methods.checkIn = async function() {
  const booking = this as IBooking;
  // authorize band
  // send user notification
};

Booking.methods.cancel = async function(save = true) {
  const booking = this as IBooking;

  if (!["PENDING", "BOOKED"].includes(booking.status)) {
    throw new Error("uncancelable_booking_status");
  }
  if (booking.payments.filter(p => p.paid).length) {
    console.log(`[BOK] Refund booking ${booking._id}.`);
    // we don't change status here, will auto change on payment fullfil
    await booking.createRefundPayment();
  } else {
    booking.status = "CANCELED";
  }

  console.log(`[BOK] Cancel booking ${booking._id}.`);

  if (save) {
    await booking.save();
  }
};

export interface IBooking extends mongoose.Document {
  customer: IUser;
  store: IStore;
  type: string;
  date: string;
  checkInAt: string;
  hours: number;
  membersCount: number;
  bandIds: string[];
  socksCount: number;
  status: string;
  price?: number;
  code?: ICode;
  payments?: IPayment[];
  calculatePrice: () => Promise<IBooking>;
  createPayment: (
    Object: {
      paymentGateway?: Gateways;
      useCredit?: boolean;
      adminAddWithoutPayment?: boolean;
      extendHoursBy?: number;
    },
    amount?: number
  ) => Promise<IBooking>;
  paymentSuccess: () => Promise<IBooking>;
  createRefundPayment: () => Promise<IBooking>;
  refundSuccess: () => Promise<IBooking>;
  checkIn: () => Promise<boolean>;
  cancel: (save?: boolean) => Promise<boolean>;
  remarks?: string;
}

export default mongoose.model<IBooking>("Booking", Booking);
