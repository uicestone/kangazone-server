import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import { config } from "./Config";
import Code, { ICode } from "./Code";
import autoPopulate from "./plugins/autoPopulate";
import Store, { IStore } from "./Store";

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
  mobile: {
    type: String,
    index: { unique: true, sparse: true },
    validate: {
      validator: function(v) {
        return v.length === 11 || v.match(/^\+/);
      },
      // @ts-ignore
      message: props =>
        `手机号必须是11位数或“+”开头的国际号码，输入的是${JSON.stringify(
          props.value
        )}`
    }
  },
  avatarUrl: String,
  region: String,
  openid: { type: String, index: { unique: true, sparse: true } },
  passNo: { type: String }, // staff only
  passNo8: { type: Number }, // staff only
  store: { type: Schema.Types.ObjectId, ref: Store }, // manager only
  passLogs: {
    type: [{ time: Date, gate: String, entry: Boolean, allow: Boolean }]
  },
  creditDeposit: Number, // below for customer only
  creditReward: Number,
  codeAmount: Number, // sum of amount of unused code
  cardType: { type: String },
  cardNo: { type: String },
  codes: [{ type: Schema.Types.ObjectId, ref: Code }]
});

// User.virtual("avatarUrl").get(function(req) {
//   if (!this.avatarUri) return null;
//   return (process.env.CDN_URL || req.baseUrl )+ this.avatarUri;
// });

User.virtual("credit").get(function() {
  const user = this as IUser;
  if (user.creditDeposit === undefined && user.creditReward === undefined) {
    return undefined;
  }
  return +((user.creditDeposit || 0) + (user.creditReward || 0)).toFixed(2);
});

User.plugin(autoPopulate, ["codes"]);
User.plugin(updateTimes);

User.pre("validate", function(next) {
  const user = this as IUser;
  ["creditDeposit", "creditReward"].forEach(field => {
    if (user[field]) {
      user[field] = +user[field].toFixed(2);
    }
  });
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

  if (!user.creditDeposit) {
    user.creditDeposit = 0;
  }
  if (!user.creditReward) {
    user.creditReward = 0;
  }

  console.log(
    `[USR] User ${user.id} credit was ${user.creditDeposit}:${user.creditReward}.`
  );

  user.cardType = level.cardType;
  user.creditDeposit +=
    level.depositCredit === undefined ? levelPrice : level.depositCredit;
  user.creditReward += level.rewardCredit;

  console.log(
    `[USR] Deposit success ${user.id}, credit is now ${user.creditDeposit}:${user.creditReward}.`
  );

  const codeWeights = level.rewardCodes.reduce(
    (weights, template) =>
      weights + (template.amountWeight || 1) * template.count,
    0
  );

  // console.log(`CodeWeights is ${codeWeights}.`);

  let amountPerWeight: number;

  if (level.depositCredit === undefined || level.depositCredit > 0) {
    amountPerWeight = 0;
  } else {
    amountPerWeight = +(levelPrice / codeWeights).toFixed(2);
  }

  // console.log(`[USR] AmountPerWeight is ${amountPerWeight}.`);

  const codes = level.rewardCodes.reduce((codes, template) => {
    for (let i = 0; i < template.count; i++) {
      const code = new Code({
        title: template.title,
        type: template.type,
        amount: amountPerWeight * (template.amountWeight || 1),
        hours: template.hours,
        customer: user
      });
      console.log(`[USR] Code amount is ${code.amount}`);
      codes.push(code);
      user.codes.push(code);
    }
    return codes;
  }, []);

  await Promise.all([Code.insertMany(codes), user.save()]);

  const codeAmount = +codes
    .reduce((codeAmount, code) => codeAmount + (code.amount || 0), 0)
    .toFixed(2);

  await user.updateCodeAmount();

  console.log(
    `[USR] ${codes.length} codes was rewarded to user ${user._id}, amount: ${codeAmount}, user total: ${user.codeAmount}.`
  );

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

User.methods.updateCodeAmount = async function(save = true) {
  const user = this as IUser;
  user.codeAmount = +user.codes
    .filter(c => !c.used)
    .reduce((codeAmount, code) => codeAmount + (code.amount || 0), 0)
    .toFixed(2);

  if (save) {
    await user.save();
  }

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
  passNo?: string;
  passNo8?: number;
  store?: IStore;
  passLogs: { time: Date; gate: string; entry: boolean; allow: boolean }[];
  creditDeposit?: number;
  creditReward?: number;
  credit?: number;
  codeAmount?: number;
  cardType?: string;
  cardNo?: string;
  codes?: ICode[];
  depositSuccess: (price: number) => Promise<IUser>;
  membershipUpgradeSuccess: (cardTypeName: string) => Promise<IUser>;
  updateCodeAmount: (save?: boolean) => Promise<IUser>;
}

export default mongoose.model<IUser>("User", User);
