import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import User, { IUser } from "./User";
import { unifiedOrder as wechatUnifiedOrder } from "../utils/wechat";

const Payment = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: User, required: true },
  amount: { type: Number, required: true },
  paid: { type: Boolean, default: false },
  title: { type: String, default: " " },
  attach: { type: String },
  gateway: { type: String, required: true },
  gatewayData: Object
});

Payment.plugin(autoPopulate, ["customer"]);
Payment.plugin(updateTimes);

Payment.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

Payment.pre("save", async function(next) {
  const payment = this as IPayment;
  switch (payment.gateway) {
    case Gateways.WechatPay:
      await payment.populate("customer").execPopulate();
      payment.gatewayData = await wechatUnifiedOrder(
        payment._id.toString(),
        payment.amount,
        payment.customer.openid,
        payment.title,
        payment.attach
      );
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
