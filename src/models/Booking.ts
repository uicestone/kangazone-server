import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import Payment, { IPayment } from "./Payment";
import Store, { IStore } from "./Store";
import User, { IUser } from "./User";

const Booking = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: User },
  store: { type: Schema.Types.ObjectId, ref: Store },
  type: { type: String, enum: ["play", "party"] },
  date: String,
  checkInAt: String,
  hours: Number,
  membersCount: Number,
  socksCount: Number,
  status: { type: String, default: "PENDING" },
  payments: { type: [Schema.Types.ObjectId], ref: Payment }
});

Booking.index({ date: 1, checkInAt: 1, customer: 1 }, { unique: true });

Booking.plugin(autoPopulate, ["customer", "store", "payments"]);
Booking.plugin(updateTimes);

Booking.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

export interface IBooking extends mongoose.Document {
  customer: IUser;
  store: IStore;
  type: string;
  date: string;
  checkInAt: string;
  hours: number;
  membersCount: number;
  socksCount: number;
  status: string;
  price: number;
  payment?: IPayment[];
}

export default mongoose.model<IBooking>("Booking", Booking);
