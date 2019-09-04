import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import User, { IUser } from "./User";
import Booking from "./Booking";
import {
  unifiedOrder as wechatUnifiedOrder,
  payArgs as wechatPayArgs
} from "../utils/wechat";

const Payment = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: User, required: true },
  amount: { type: Number, required: true },
  paid: { type: Boolean, default: false },
  title: { type: String, default: " " },
  attach: { type: String },
  gateway: { type: String, required: true },
  gatewayData: Object
});

Payment.plugin(autoPopulate, [{ path: "customer", select: "name avatarUrl" }]);
Payment.plugin(updateTimes);

Payment.virtual("payArgs").get(function() {
  const payment = this as IPayment;
  if (payment.gateway === Gateways.WechatPay && !payment.paid) {
    if (
      !payment.gatewayData ||
      !payment.gatewayData.nonce_str ||
      !payment.gatewayData.prepay_id
    ) {
      throw new Error(`incomplete_gateway_data`);
    }
    const wechatGatewayData = payment.gatewayData as {
      nonce_str: string;
      prepay_id: string;
    };
    return wechatPayArgs(wechatGatewayData);
  }
});

Payment.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

Payment.methods.paidSuccess = async function() {
  const payment = this as IPayment;

  const paymentAttach = payment.attach.split(" ");

  switch (paymentAttach[0]) {
    case "booking":
      const booking = await Booking.findOne({ _id: paymentAttach[1] });
      await booking.paymentSuccess();
      console.log(`[PAY] Booking payment success, id: ${booking._id}.`);
      break;
    case "deposit":
      const depositUser = await User.findOne({ _id: paymentAttach[1] });
      await depositUser.depositSuccess(+paymentAttach[2]);
      console.log(`[PAY] User deposit success, id: ${depositUser._id}.`);
      break;
    case "membership":
      const membershipUser = await User.findOne({
        _id: paymentAttach[1]
      });
      await membershipUser.membershipUpgradeSuccess(paymentAttach[2]);
      console.log(
        `[PAY] User membership upgrade success, id: ${membershipUser._id}.`
      );
      break;
    default:
      console.error(
        `[PAY] Unknown payment attach: ${JSON.stringify(payment.attach)}`
      );
  }
};

Payment.pre("save", async function(next) {
  const payment = this as IPayment;

  if (!payment.isModified("paid") && !payment.isNew) {
    return next();
  }

  if (payment.paid) {
    payment.paidSuccess();
    return next();
  }

  switch (payment.gateway) {
    case Gateways.WechatPay:
      if (payment.gatewayData) return next();
      await payment.populate("customer").execPopulate();
      if (!payment.customer.openid) {
        throw new Error("no_customer_openid");
      }
      payment.gatewayData = await wechatUnifiedOrder(
        payment._id.toString(),
        payment.amount,
        payment.customer.openid,
        payment.title,
        payment.attach
      );
      break;
    case Gateways.Credit:
      const customer = await User.findOne({ _id: payment.customer });
      if (customer.credit < payment.amount) {
        throw new Error("insufficient_credit");
      }
      customer.credit -= payment.amount;
      payment.paid = true;
      // await payment.paidSuccess();
      // we don't trigger paidSuccess or booking.paidSuccess here cause booking may not be saved
      // we need to change booking status manually after credit payment
      await customer.save();
      break;
    case Gateways.Card:
      break;
    case Gateways.Scan:
      break;
    case Gateways.Cash:
      break;
    default:
      throw new Error("unsupported_payment_gateway");
  }
  next();
});

export interface IPayment extends mongoose.Document {
  customer: IUser;
  amount: number;
  paid: boolean;
  title: string;
  attach: string;
  gateway: string;
  gatewayData?: { [key: string]: any };
  paidSuccess: () => Promise<IPayment>;
}

export enum Gateways {
  Credit = "credit",
  Scan = "scan",
  Card = "card",
  Cash = "cash",
  WechatPay = "wechatpay",
  Alipay = "alipay",
  UnionPay = "unionpay"
}

export default mongoose.model<IPayment>("payment", Payment);
