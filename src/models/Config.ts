import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";

const configSchema = new Schema(
  {
    desc: String
  },
  { strict: false }
);

configSchema.plugin(updateTimes);

configSchema.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

configSchema.statics.get = async function(key, defaults) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaults;
};

export default mongoose.model("Config", configSchema);

export interface IConfig {
  cardTypes?: { [name: string]: { firstHourPrice: number; netPrice: number } };
  depositLevels?: {
    slug: string;
    desc: string;
    price: number;
    cardType: string;
    depositCredit?: number;
    rewardCredit?: number;
    rewardCodes?: {
      title: string;
      type: string;
      hours: number;
      amountWeight?: number;
      membersCount?: number;
      kidsCount?: number;
      count: number;
    }[];
    freePlayFrom?: Date;
    freePlayTo?: Date;
  }[];
  hourPrice?: number;
  sockPrice?: number;
  unlimitedPrice?: number;
  kidHourPrice?: number;
  kidUnlimitedPrice?: number;
  hourPriceRatio?: number[];
  coupons?: {
    slug: string;
    name: string;
    validFrom: Date;
    validTill: Date;
    type: string;
    hours: number;
    amount: number; // value of the coupon itself
    membersCount?: number;
    kidsCount?: number;
    fixedHours?: boolean;
    fixedMembersCount?: boolean;
    price?: number;
    discountAmount?: number;
    discountRate?: number;
  }[];
}

export const config: IConfig = {};
