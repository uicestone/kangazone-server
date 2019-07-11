import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import autoPopulate from "./plugins/autoPopulate";
import Payment, { IPayment } from "./Payment";
import Store, { IStore } from "./Store";
import User, { IUser } from "./User";

const Booking = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: User, required: true },
  store: { type: Schema.Types.ObjectId, ref: Store, required: true },
  type: { type: String, enum: ["play", "party"], default: "play" },
  date: { type: String, required: true },
  checkInAt: { type: String, required: true },
  hours: { type: Number, required: true },
  membersCount: { type: Number, default: 1 },
  socksCount: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ["PENDING", "BOOKED", "IN_SERVICE", "FINISHED"],
    default: "PENDING"
  },
  price: { type: Number },
  payments: [{ type: Schema.Types.ObjectId, ref: Payment }]
});

Booking.index({ date: 1, checkInAt: 1, customer: 1 }, { unique: true });

Booking.plugin(autoPopulate, [
  { path: "customer", select: "name avatarUrl" },
  "store",
  "payments"
]);
Booking.plugin(updateTimes);

Booking.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

Booking.methods.paymentSuccess = async function() {
  const booking = this as IBooking;
  booking.status = "BOOKED";
  await booking.save();
  // send user notification
};
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
  price?: number;
  payments?: IPayment[];
  paymentSuccess: () => Promise<IBooking>;
}

export default mongoose.model<IBooking>("Booking", Booking);
