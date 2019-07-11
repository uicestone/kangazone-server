import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import User, { IUser } from "./User";
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
    if (!payment.gatewayData.nonce_str || !payment.gatewayData.prepay_id) {
      throw new Error(
        `Incomplete gateway data: ${JSON.stringify(payment.gatewayData)}.`
      );
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

Payment.pre("save", async function(next) {
  const payment = this as IPayment;

  if (payment.paid) return next();

  switch (payment.gateway) {
    case Gateways.WechatPay:
      if (payment.gatewayData) return next();
      await payment.populate("customer").execPopulate();
      payment.gatewayData = await wechatUnifiedOrder(
        payment._id.toString(),
        payment.amount,
        payment.customer.openid,
        payment.title,
        payment.attach
      );
      break;
    case Gateways.Credit:
      payment.paid = true;
      const customer = await User.findOne({ _id: payment.customer });
      customer.credit -= payment.amount;
      await customer.save();
      break;
    default:
      throw Error("Payment gateway not supported.");
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
}

export enum Gateways {
  Credit = "credit",
  WechatPay = "wechatpay",
  Alipay = "alipay",
  UnionPay = "unionpay",
  ApplePay = "applepay",
  PayPal = "paypal",
  VISA = "visa",
  MASTERCARD = "mastercard",
  AMEX = "amex"
}

export default mongoose.model<IPayment>("payment", Payment);
