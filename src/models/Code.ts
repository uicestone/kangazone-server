import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import { IUser } from "./User";
import { IBooking } from "./Booking";

const Code = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: "User", required: true },
  // User imports Code, so we cannot depend User here, use "User" instead
  title: { type: String, required: true },
  type: { type: String, enum: ["play"], default: "play" },
  num: String,
  amount: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  hours: { type: Number },
  membersCount: { type: Number, default: 1 },
  kidsCount: { type: Number, default: 0 },
  used: { type: Boolean, default: false },
  usedAt: Date,
  usedInBooking: { type: Schema.Types.ObjectId, ref: "Booking" },
  expiresAt: { type: Date }
});

Code.plugin(updateTimes);

Code.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

export interface ICode extends mongoose.Document {
  customer: IUser;
  title: string;
  type: string;
  num?: string;
  amount: number;
  price: number;
  hours?: number;
  membersCount: number;
  kidsCount: number;
  used: boolean;
  usedAt?: Date;
  usedInBooking?: IBooking;
  expiresAt?: Date;
}

export default mongoose.model<ICode>("Code", Code);
