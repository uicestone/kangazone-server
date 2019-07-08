import Config from "../models/Config";

export default async () => {
  const configs = await Config.find();
  if (!configs.length) {
    await Config.insertMany([
      {
        cardTypes: {
          白金: {
            firstHourPrice: 138,
            netPrice: 199
          },
          荣耀: {
            firstHourPrice: 118,
            netPrice: 219
          },
          至尊: {
            firstHourPrice: 98,
            netPrice: 319
          }
        }
      },
      {
        depositLevels: [
          {
            price: 1000,
            cardType: "白金",
            awardCodes: [
              {
                type: "play",
                hour: 1,
                count: 1
              }
            ]
          },
          {
            price: 2000,
            cardType: "荣耀",
            awardCodes: [
              {
                type: "play",
                hour: 1,
                count: 2
              }
            ]
          },
          {
            price: 3000,
            cardType: "至尊",
            awardCodes: [
              {
                type: "play",
                hour: 1,
                count: 4
              }
            ]
          }
        ]
      },
      {
        hourPriceRatio: [1, 0.5, 0.5]
      }
    ]);

    console.log(`[SYS] Config collection initialized.`);
  }
};
