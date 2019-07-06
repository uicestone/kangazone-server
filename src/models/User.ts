import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import crypto from "crypto";

const User = new Schema({
  role: { type: String, default: "customer" },
  login: { type: String, index: { unique: true, sparse: true } },
  password: { type: String, select: false },
  token: { type: String, select: false },
  name: String,
  gender: String,
  mobile: String,
  avatarUrl: String,
  region: String,
  openid: { type: String, index: { unique: true, sparse: true } },
  credit: Number // for customer only
});

// User.virtual("avatarUrl").get(function(req) {
//   if (!this.avatarUri) return null;
//   return (process.env.CDN_URL || req.baseUrl )+ this.avatarUri;
// });

User.plugin(updateTimes);

User.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

User.pre("save", function() {
  const self = this as IUser;
  self.token = crypto.randomBytes(48).toString("hex");
});

export interface IUser extends mongoose.Document {
  role: string;
  login?: string;
  password?: string;
  token?: string;
  name?: string;
  gender?: string;
  mobile?: string;
  avatarUrl?: string;
  region?: string;
  openid?: string;
  credit: number;
}

export default mongoose.model<IUser>("User", User);
