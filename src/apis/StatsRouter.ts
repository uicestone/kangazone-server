import handleAsyncErrors from "../utils/handleAsyncErrors";
import Booking, { BookingStatuses } from "../models/Booking";
import moment from "moment";

export default router => {
  // Store CURD
  router
    .route("/stats")

    .get(
      handleAsyncErrors(async (req, res) => {
        const today = moment().format("YYYY-MM-DD");
        const bookingsToday = await Booking.find({ date: today });
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

        const todayCount = bookingsToday.reduce(
          (count, booking) => count + booking.membersCount,
          0
        );

        const todayAmount = bookingsToday.reduce((amount, booking) => {
          return (
            amount +
            booking.payments
              .filter(p => p.paid)
              .reduce((a, p) => a + p.amount, 0)
          );
        }, 0);

        res.json({
          checkedInCount,
          dueCount,
          todayCount,
          todayAmount
        });
      })
    );

  return router;
};
