import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";

const configSchema = new Schema({}, { strict: false });

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
    price: number;
    cardType: string;
    rewardCredit: number;
    rewardCodes: {
      title: string;
      type: string;
      hours: number;
      count: number;
    }[];
  }[];
  hourPrice?: number;
  hourPriceRatio?: number[];
  coupons?: {
    slug: string;
    name: string;
    validFrom: Date;
    validTill: Date;
    type: string;
    hours: number;
    membersCount?: number;
    fixedHours?: boolean;
    fixedMembersCount?: boolean;
    price?: number;
  }[];
}

export const config: IConfig = {};
