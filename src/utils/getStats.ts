import moment from "moment";
import { config } from "../models/Config";
import Booking, {
  paidBookingStatuses,
  BookingStatuses
} from "../models/Booking";
import Payment, { Gateways } from "../models/Payment";

export default async (dateInput?: string | Date) => {
  const dateStr = moment(dateInput).format("YYYY-MM-DD"),
    startOfDay = moment(dateInput)
      .startOf("day")
      .toDate(),
    endOfDay = moment(dateInput)
      .endOf("day")
      .toDate(),
    dateRangeStartStr = moment(dateInput)
      .subtract(6, "days")
      .format("YYYY-MM-DD"),
    startOfDateRange = moment(dateInput)
      .subtract(6, "days")
      .startOf("day")
      .toDate();

  const coupons = config.coupons;

  const bookingsPaid = await Booking.find({
    date: dateStr,
    status: { $in: paidBookingStatuses }
  });

  for (const booking of bookingsPaid) {
    if (booking.code) {
      await booking.populate("code").execPopulate();
    }
  }

  const payments = await Payment.find({
    createdAt: {
      $gte: startOfDay,
      $lte: endOfDay
    },
    paid: true
  });
  const bookingServing = await Booking.find({
    status: BookingStatuses.IN_SERVICE
  });
  const dueCount = bookingServing.filter(booking => {
    if (booking.checkInAt.length === 8) {
      return (
        moment(booking.checkInAt, "HH:mm:ss").diff() < -booking.hours * 3600000
      );
    } else {
      return false;
    }
  }).length;

  const checkedInCount = bookingServing.reduce(
    (count, booking) => count + booking.membersCount + booking.kidsCount,
    0
  );

  const customerCount = bookingsPaid.reduce(
    (count, booking) => count + booking.membersCount + booking.kidsCount,
    0
  );

  const kidsCount = bookingsPaid.reduce(
    (count, booking) => count + booking.kidsCount,
    0
  );

  const paidAmount = bookingsPaid.reduce((amount, booking) => {
    return (
      amount +
      booking.payments.filter(p => p.paid).reduce((a, p) => a + p.amount, 0)
    );
  }, 0);

  const depositAmount = payments
    .filter(p => p.attach.match(/deposit /))
    .reduce((amount, p) => amount + p.amount, 0);

  const codeDepositAmount = payments
    .filter(p => p.attach.match(/deposit /) && p.amount.toString().match(/80$/))
    .reduce((amount, p) => amount + p.amount, 0);

  const socksCount = bookingsPaid.reduce(
    (socks, booking) => socks + booking.socksCount,
    0
  );

  const paidAmountByGateways: { [gateway: string]: number } = payments.reduce(
    (amountByGateways, payment) => {
      if (!amountByGateways[payment.gateway]) {
        amountByGateways[payment.gateway] = 0;
      }
      amountByGateways[payment.gateway] += payment.amount;
      return amountByGateways;
    },
    {}
  );

  const couponsCount: {
    slug: string;
    name: string;
    count: number;
  }[] = bookingsPaid
    .filter(b => b.coupon)
    .reduce((couponsCount, booking) => {
      let couponCount = couponsCount.find(c => c.slug === booking.coupon);
      if (!couponCount) {
        const coupon = coupons.find(c => c.slug === booking.coupon);
        couponCount = {
          slug: coupon.slug,
          name: coupon.name,
          count: 0
        };
        couponsCount.push(couponCount);
      }
      couponCount.count += booking.membersCount + booking.kidsCount;
      return couponsCount;
    }, []);

  const codesCount: {
    title: string;
    count: number;
  }[] = bookingsPaid
    .filter(b => b.code)
    .reduce((codesCount, booking) => {
      let codeCount = codesCount.find(c => c.title === booking.code.title);
      if (!codeCount) {
        codeCount = {
          title: booking.code.title,
          count: 0
        };
        codesCount.push(codeCount);
      }
      codeCount.count++;
      return codesCount;
    }, []);

  const depositsCount: {
    desc: string;
    price: number;
    count: number;
  }[] = [];

  payments
    .filter(p => p.attach.match(/^deposit /))
    .reduce((depositsCount, payment) => {
      const [, levelPrice] = payment.attach.match(/^deposit [\d\w]+ (\-?\d+)/);
      let depositCount = depositsCount.find(c => c.price === +levelPrice);
      if (!depositCount) {
        const level = config.depositLevels.find(l => l.price === +levelPrice);
        if (!level) {
          // throw new Error(`Level not found for price ${levelPrice}`);
          depositCount = {
            desc: "已下架等级",
            price: +levelPrice,
            count: 0
          };
        } else {
          depositCount = {
            desc: level.desc,
            price: level.price,
            count: 0
          };
        }
        depositsCount.push(depositCount);
      }
      depositCount.count++;
      return depositsCount;
    }, depositsCount);

  const dailyCustomers = await Booking.aggregate([
    { $match: { date: { $gte: dateRangeStartStr, $lte: dateStr } } },
    {
      $project: {
        membersCount: 1,
        kidsCount: 1,
        date: {
          $dateToParts: {
            date: {
              $dateFromString: {
                dateString: "$date",
                timezone: "Asia/Shanghai"
              }
            },
            timezone: "Asia/Shanghai"
          }
        }
      }
    },
    {
      $group: {
        _id: {
          y: "$date.year",
          m: "$date.month",
          d: "$date.day"
        },
        membersCount: {
          $sum: "$membersCount"
        },
        kidsCount: {
          $sum: "$kidsCount"
        }
      }
    },
    {
      $sort: { _id: 1 }
    },
    {
      $project: {
        _id: 0,
        day: {
          $dayOfWeek: {
            date: {
              $dateFromParts: {
                year: "$_id.y",
                month: "$_id.m",
                day: "$_id.d",
                timezone: "Asia/Shanghai"
              }
            }
          }
        },
        membersCount: 1,
        kidsCount: 1
      }
    }
  ]);

  const dailyBookingPayment = await Payment.aggregate([
    {
      $match: {
        createdAt: { $gte: startOfDateRange, $lte: endOfDay },
        attach: { $regex: /^booking / }
      }
    },
    {
      $project: {
        amountDeposit: 1,
        amount: 1,
        date: {
          $dateToParts: {
            date: "$createdAt",
            timezone: "Asia/Shanghai"
          }
        }
      }
    },
    {
      $group: {
        _id: {
          y: "$date.year",
          m: "$date.month",
          d: "$date.day"
        },
        amount: {
          $sum: { $cond: ["$amountDeposit", "$amountDeposit", "$amount"] }
        }
      }
    },
    {
      $sort: { _id: 1 }
    },
    {
      $project: {
        _id: 0,
        day: {
          $dayOfWeek: {
            date: {
              $dateFromParts: {
                year: "$_id.y",
                month: "$_id.m",
                day: "$_id.d",
                timezone: "Asia/Shanghai"
              }
            }
          }
        },
        amount: 1
      }
    }
  ]);

  const dailyDepositPayment = await Payment.aggregate([
    {
      $match: {
        createdAt: { $gte: startOfDateRange, $lte: endOfDay },
        attach: { $regex: /^deposit / }
      }
    },
    {
      $project: {
        amount: 1,
        date: {
          $dateToParts: {
            date: "$createdAt",
            timezone: "Asia/Shanghai"
          }
        }
      }
    },
    {
      $group: {
        _id: {
          y: "$date.year",
          m: "$date.month",
          d: "$date.day"
        },
        amount: {
          $sum: "$amount"
        }
      }
    },
    {
      $sort: { _id: 1 }
    },
    {
      $project: {
        _id: 0,
        day: {
          $dayOfWeek: {
            date: {
              $dateFromParts: {
                year: "$_id.y",
                month: "$_id.m",
                day: "$_id.d",
                timezone: "Asia/Shanghai"
              }
            }
          }
        },
        amount: 1
      }
    }
  ]);

  return {
    checkedInCount,
    dueCount,
    customerCount,
    kidsCount,
    paidAmount,
    depositAmount,
    codeDepositAmount,
    socksCount,
    paidAmountByGateways,
    couponsCount,
    codesCount,
    depositsCount,
    dailyCustomers,
    dailyBookingPayment,
    dailyDepositPayment
  };
};
