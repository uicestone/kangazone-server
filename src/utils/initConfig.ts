import Config, { IConfig } from "../models/Config";
import reduceConfig from "./reduceConfig";

export default async config => {
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
  Object.assign(config, existingConfig);
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
  hourPrice: 158
};
