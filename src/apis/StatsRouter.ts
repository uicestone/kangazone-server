import handleAsyncErrors from "../utils/handleAsyncErrors";
import Booking, {
  BookingStatuses,
  paidBookingStatuses
} from "../models/Booking";
import moment from "moment";
import { config } from "../models/Config";
import Payment, { Gateways } from "../models/Payment";

export default router => {
  // Store CURD
  router
    .route("/stats/:date?")

    .get(
      handleAsyncErrors(async (req, res) => {
        const dateInput = req.params.date;
        const dateStr = moment(dateInput).format("YYYY-MM-DD"),
          startDate = moment(dateInput).startOf("day"),
          endDate = moment(dateInput).endOf("day");

        const coupons = config.coupons;

        const bookingsPaid = await Booking.find({
          date: dateStr,
          status: { $in: paidBookingStatuses }
        });
        const payments = await Payment.find({
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        });
        const bookingServing = await Booking.find({
          status: BookingStatuses.IN_SERVICE
        });
        const dueCount = bookingServing.filter(booking => {
          if (booking.checkInAt.length === 8) {
            return (
              moment(booking.checkInAt, "HH:mm:ss").diff() <
              -booking.hours * 3600000
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
            booking.payments
              .filter(p => p.paid)
              .reduce((a, p) => a + p.amount, 0)
          );
        }, 0);

        const socksCount = bookingsPaid.reduce(
          (socks, booking) => socks + booking.socksCount,
          0
        );

        const paidAmountByGateways = payments
          .filter(p => p.paid)
          .reduce((amountByGateways, payment) => {
            if (!amountByGateways[payment.gateway]) {
              amountByGateways[payment.gateway] = 0;
            }
            amountByGateways[payment.gateway] += payment.amount;
            return amountByGateways;
          }, {});

        const couponsCount = bookingsPaid
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
            couponCount.count++;
            return couponsCount;
          }, []);

        res.json({
          checkedInCount,
          dueCount,
          customerCount,
          paidAmount,
          socksCount,
          paidAmountByGateways,
          couponsCount
        });
      })
    );

  return router;
};
