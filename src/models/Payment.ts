import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import User, { IUser } from "./User";

const Payment = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: User },
  amount: Number,
  paid: Boolean,
  gateway: String,
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

export interface IPayment extends mongoose.Document {
  customer: IUser;
  amount: number;
  paid: boolean;
  gateway: string;
  gatewayData: Object;
}

export default mongoose.model<IPayment>("payment", Payment);
