import moment from "moment";
import { config } from "../models/Config";
import Booking, {
  paidBookingStatuses,
  BookingStatuses
} from "../models/Booking";
import Payment, { Gateways } from "../models/Payment";

export default async (dateInput?: string | Date) => {
  const dateStr = moment(dateInput).format("YYYY-MM-DD"),
    startDate = moment(dateInput)
      .startOf("day")
      .toDate(),
    endDate = moment(dateInput)
      .endOf("day")
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
      $gte: startDate,
      $lte: endDate
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
    (count, booking) => count + booking.membersCount,
    0
  );

  const customerCount = bookingsPaid.reduce(
    (count, booking) => count + booking.membersCount,
    0
  );

  const paidAmount = bookingsPaid.reduce((amount, booking) => {
    return (
      amount +
      booking.payments.filter(p => p.paid).reduce((a, p) => a + p.amount, 0)
    );
  }, 0);

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
      couponCount.count += booking.membersCount;
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
      codeCount.count += booking.membersCount;
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
      const [, levelPrice] = payment.attach.match(/^deposit [\d\w]+ (\d+)/);
      let depositCount = depositsCount.find(c => c.price === +levelPrice);
      if (!depositCount) {
        const level = config.depositLevels.find(l => l.price === +levelPrice);
        if (!level) {
          throw new Error(`Level not found for price ${levelPrice}`);
        }
        depositCount = {
          desc: level.desc,
          price: level.price,
          count: 0
        };
        depositsCount.push(depositCount);
      }
      depositCount.count++;
      return depositsCount;
    }, depositsCount);

  return {
    checkedInCount,
    dueCount,
    customerCount,
    paidAmount,
    socksCount,
    paidAmountByGateways,
    couponsCount,
    codesCount,
    depositsCount
  };
};
