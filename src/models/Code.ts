import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import { IUser } from "./User";

const Code = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: "User", required: true },
  // User imports Code, so we cannot depend User here, use "User" instead
  title: { type: String, required: true },
  type: { type: String, enum: ["play"], default: "play" },
  num: String,
  amount: { type: Number, default: 0 },
  hours: Number,
  used: { type: Boolean, default: false },
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
  hours?: number;
  used: boolean;
  expiresAt?: Date;
}

export default mongoose.model<ICode>("Code", Code);
