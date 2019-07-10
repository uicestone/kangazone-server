import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import { config } from "./Config";
import Code from "./Code";

const User = new Schema({
  role: { type: String, default: "customer" },
  login: { type: String, index: { unique: true, sparse: true } },
  password: { type: String, select: false },
  name: String,
  gender: String,
  mobile: String,
  avatarUrl: String,
  region: String,
  openid: { type: String, index: { unique: true, sparse: true } },
  credit: Number, // for customer only
  cardType: { type: String } // for customer only
});

// User.virtual("avatarUrl").get(function(req) {
//   if (!this.avatarUri) return null;
//   return (process.env.CDN_URL || req.baseUrl )+ this.avatarUri;
// });

User.plugin(updateTimes);

User.pre("validate", function(next) {
  const user = this as IUser;
  user.credit = +user.credit.toFixed(2);
  next();
});

User.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

User.methods.depositSuccess = async function(levelPrice: number) {
  const user = this as IUser;
  const level = config.depositLevels.filter(l => l.price === levelPrice)[0];
  if (!level) {
    throw new Error(`Deposit level not found for price ${levelPrice}.`);
  }
  user.cardType = level.cardType;
  user.credit = user.credit ? user.credit + levelPrice : levelPrice;
  const codes = level.rewardCodes.reduce((codes, cur) => {
    for (let i = 0; i < cur.count; i++) {
      codes.push(
        new Code({ type: cur.type, hours: cur.hours, customer: user })
      );
    }
    return codes;
  }, []);

  await Promise.all([Code.insertMany(codes), await user.save()]);

  // send user notification
};

export interface IUser extends mongoose.Document {
  role: string;
  login?: string;
  password?: string;
  name?: string;
  gender?: string;
  mobile?: string;
  avatarUrl?: string;
  region?: string;
  openid?: string;
  credit?: number;
  cardType?: string;
  depositSuccess: (price: number) => Promise<IUser>;
}

export default mongoose.model<IUser>("User", User);
