import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import User, { IUser } from "./User";
import Booking from "./Booking";
import Code from "./Code";
import {
  unifiedOrder as wechatUnifiedOrder,
  payArgs as wechatPayArgs
} from "../utils/wechat";

const Payment = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: User, required: true },
  amount: { type: Number, required: true },
  amountForceDeposit: { type: Number },
  amountDeposit: { type: Number },
  paid: { type: Boolean, default: false },
  title: { type: String, default: " " },
  attach: { type: String },
  gateway: { type: String, required: true },
  gatewayData: Object,
  original: { type: Schema.Types.ObjectId }
});

Payment.plugin(autoPopulate, [
  { path: "customer", select: "name avatarUrl mobile" }
]);
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
      if (paymentAttach[2] === "extend") {
        if (+paymentAttach[3] === 0) {
          booking.hours = 0;
        } else {
          booking.hours += +paymentAttach[3];
        }
      }
      if (payment.amount >= 0) {
        await booking.paymentSuccess();
        console.log(`[PAY] Booking payment success, id: ${booking._id}.`);
      } else {
        await booking.refundSuccess();
        console.log(`[PAY] Booking refund success, id: ${booking._id}.`);
      }
      break;
    case "deposit":
      const depositUser = await User.findOne({ _id: paymentAttach[1] });
      await depositUser.depositSuccess(paymentAttach[2]);
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

  console.log(`[PAY] Payment pre save ${payment._id}.`);

  if (payment.paid) {
    payment.paidSuccess();
    return next();
  }

  await payment.populate("customer").execPopulate();

  const customer = payment.customer;

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
      if (customer.credit < payment.amount) {
        throw new Error("insufficient_credit");
      }

      console.log(
        `[PAY] D:R was ${customer.creditDeposit}:${customer.creditReward}.`
      );

      if (!payment.amountForceDeposit) {
        payment.amountForceDeposit = 0;
      }

      const depositPaymentAmount =
        payment.amountDeposit ||
        Math.max(
          +(
            payment.amountForceDeposit +
            ((payment.amount - payment.amountForceDeposit) *
              customer.creditDeposit) /
              customer.credit
          ).toFixed(2),
          0.01
        );

      const rewardPaymentAmount = +(
        payment.amount - depositPaymentAmount
      ).toFixed(2);

      console.log(
        `[PAY] Payment amount D:R is ${depositPaymentAmount}:${rewardPaymentAmount}.`
      );

      customer.creditDeposit -= depositPaymentAmount;
      customer.creditReward -= rewardPaymentAmount;
      payment.amountDeposit = depositPaymentAmount;

      console.log(
        `[DEBUG] Credit payment saved, customer credit is now ${customer.credit}`
      );

      payment.paid = true;
      // await payment.paidSuccess();
      // we don't trigger paidSuccess or booking.paidSuccess here cause booking may not be saved
      // we need to change booking status manually after credit payment
      await customer.save();
      break;
    case Gateways.Code:
      if (
        !payment.gatewayData ||
        !payment.gatewayData.bookingId ||
        !payment.gatewayData.codeId
      ) {
        throw new Error("invalid_code_payment_gateway_data");
      }
      const code = await Code.findOne({ _id: payment.gatewayData.codeId });

      if (Math.abs(payment.amount) !== code.amount) {
        throw new Error("code_payment_amount_mismatch");
      }

      if (payment.gatewayData.codeRefund) {
        code.used = false;
        code.usedAt = undefined;
        code.usedInBooking = undefined;
        await code.save();
        await customer.updateCodeAmount();
        console.log(
          `[PAY] Code ${code.id} refunded, customer ${customer.id} code amount is now ${customer.codeAmount}`
        );
        payment.paid = true;
      } else {
        code.used = true;
        code.usedAt = new Date();
        code.usedInBooking = payment.gatewayData.bookingId;
        await code.save();
        await customer.updateCodeAmount();
        console.log(
          `[PAY] Code ${code.id} used in ${code.usedInBooking}, customer ${customer.id} code amount is now ${customer.codeAmount}`
        );
        payment.paid = true;
      }

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
  amountForceDeposit?: number;
  amountDeposit?: number;
  paid: boolean;
  title: string;
  attach: string;
  gateway: Gateways;
  gatewayData?: { [key: string]: any };
  original?: string;
  paidSuccess: () => Promise<IPayment>;
}

export enum Gateways {
  Credit = "credit",
  Code = "code",
  Coupon = "coupon",
  Scan = "scan",
  Card = "card",
  Cash = "cash",
  WechatPay = "wechatpay",
  Alipay = "alipay",
  UnionPay = "unionpay"
}

export const gatewayNames = {
  [Gateways.Credit]: "充值余额",
  [Gateways.Code]: "次卡券码",
  [Gateways.Coupon]: "团购优惠券",
  [Gateways.Scan]: "现场扫码",
  [Gateways.Card]: "现场刷卡",
  [Gateways.Cash]: "现场现金",
  [Gateways.WechatPay]: "微信小程序",
  [Gateways.Alipay]: "支付宝",
  [Gateways.UnionPay]: "银联"
};

export default mongoose.model<IPayment>("payment", Payment);
