import Config, { IConfig } from "../models/Config";
import reduceConfig from "./reduceConfig";
import moment from "moment";

const { DEBUG } = process.env;

export default async (config: IConfig) => {
  const existingConfig = reduceConfig(await Config.find());
  const initConfigItemsInsert = Object.keys(initConfig)
    .filter(key => !existingConfig[key])
    .map(initKey => ({ [initKey]: initConfig[initKey] }));
  if (initConfigItemsInsert.length) {
    await Config.insertMany(initConfigItemsInsert);
    console.log(
      `[SYS] ${initConfigItemsInsert.length} config items initialized.`
    );
  }
  Object.assign(config, ...initConfigItemsInsert, existingConfig);
  if (!DEBUG) {
    console.log("[CFG] Loaded:", JSON.stringify(config));
  }
};

const initConfig: IConfig = {
  cardTypes: {
    白金: {
      firstHourPrice: 158,
      netPrice: null
    },
    荣耀: {
      firstHourPrice: 158,
      netPrice: null
    },
    至尊: {
      firstHourPrice: 158,
      netPrice: null
    }
  },
  depositLevels: [
    {
      price: 1000,
      cardType: "白金",
      rewardCredit: 350,
      rewardCodes: [
        {
          title: "1小时自由体验券",
          type: "play",
          hours: 1,
          count: 1
        }
      ]
    },
    {
      price: 2000,
      cardType: "荣耀",
      rewardCredit: 1200,
      rewardCodes: [
        {
          title: "1小时自由体验券",
          type: "play",
          hours: 1,
          count: 2
        }
      ]
    },
    {
      price: 3000,
      cardType: "至尊",
      rewardCredit: 3000,
      rewardCodes: [
        {
          title: "1小时自由体验券",
          type: "play",
          hours: 1,
          count: 4
        }
      ]
    }
  ],
  hourPriceRatio: [1, 0.5, 0.5],
  hourPrice: 158,
  sockPrice: 10,
  unlimitedPrice: 200,
  kidHourPrice: 33,
  coupons: [
    {
      slug: "national-2019",
      name: "88元全场畅玩不限时",
      validFrom: moment("2019-10-01").toDate(),
      validTill: moment("2019-10-07")
        .endOf("day")
        .toDate(),
      type: "play",
      hours: 12,
      fixedHours: true,
      price: 88
    },
    {
      slug: "national-2019-family-2",
      name: "亲子畅玩不限时 1大1小",
      validFrom: moment("2019-10-01").toDate(),
      validTill: moment("2019-10-07")
        .endOf("day")
        .toDate(),
      type: "play",
      hours: 12,
      membersCount: 2,
      fixedHours: true,
      fixedMembersCount: true,
      price: 158
    },
    {
      slug: "national-2019-family-3",
      name: "亲子畅玩不限时 2大1小",
      validFrom: moment("2019-10-01").toDate(),
      validTill: moment("2019-10-07")
        .endOf("day")
        .toDate(),
      type: "play",
      hours: 12,
      membersCount: 3,
      fixedHours: true,
      fixedMembersCount: true,
      price: 188
    },
    {
      slug: "national-2019-couple",
      name: "情侣畅玩不限时",
      validFrom: moment("2019-10-01").toDate(),
      validTill: moment("2019-10-07")
        .endOf("day")
        .toDate(),
      type: "play",
      hours: 12,
      membersCount: 2,
      fixedHours: true,
      fixedMembersCount: true,
      price: 159
    },
    {
      slug: "national-2019-student",
      name: "学生畅玩不限时",
      validFrom: moment("2019-10-01").toDate(),
      validTill: moment("2019-10-07")
        .endOf("day")
        .toDate(),
      type: "play",
      hours: 12,
      membersCount: 1,
      fixedHours: true,
      price: 79
    }
  ]
};
