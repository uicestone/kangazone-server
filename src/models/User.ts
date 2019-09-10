import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import { config } from "./Config";
import Code, { ICode } from "./Code";
import autoPopulate from "./plugins/autoPopulate";

const User = new Schema({
  role: { type: String, default: "customer" },
  login: { type: String, index: { unique: true, sparse: true } },
  password: { type: String, select: false },
  name: String,
  gender: {
    type: String,
    set: v => {
      const genderIndex = ["未知", "男", "女"];
      return genderIndex[v] || v;
    }
  },
  mobile: { type: String, index: { unique: true, sparse: true } },
  avatarUrl: String,
  region: String,
  openid: { type: String, index: { unique: true, sparse: true } },
  creditDeposit: Number, // below for customer only
  creditReward: Number,
  credit: Number,
  cardType: { type: String },
  cardNo: { type: String },
  codes: [{ type: Schema.Types.ObjectId, ref: Code }]
});

// User.virtual("avatarUrl").get(function(req) {
//   if (!this.avatarUri) return null;
//   return (process.env.CDN_URL || req.baseUrl )+ this.avatarUri;
// });

User.plugin(autoPopulate, ["codes"]);
User.plugin(updateTimes);

User.pre("validate", function(next) {
  const user = this as IUser;
  if (user.credit) {
    user.credit = +user.credit.toFixed(2);
  }
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
    let code;
    for (let i = 0; i < cur.count; i++) {
      code = new Code({
        title: cur.title,
        type: cur.type,
        hours: cur.hours,
        customer: user
      });
      codes.push(code);
      user.codes.push(code);
    }
    return codes;
  }, []);

  await Promise.all([Code.insertMany(codes), user.save()]);

  // send user notification

  return user;
};

User.methods.membershipUpgradeSuccess = async function(cardTypeName: string) {
  const user = this as IUser;

  const cardType = config.cardTypes[cardTypeName];

  if (!cardType) {
    throw new Error(`Card type not found for price ${cardType}.`);
  }

  user.cardType = cardTypeName;

  await user.save();

  // send user notification

  return user;
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
  creditDeposit?: number;
  creditReward?: number;
  cardType?: string;
  cardNo?: string;
  codes?: ICode[];
  depositSuccess: (price: number) => Promise<IUser>;
  membershipUpgradeSuccess: (cardTypeName: string) => Promise<IUser>;
}

export default mongoose.model<IUser>("User", User);
