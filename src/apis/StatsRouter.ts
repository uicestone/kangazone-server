import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Store, { storeGateControllers } from "../models/Store";
import Booking from "../models/Booking";
import moment = require("moment");

export default router => {
  // Store CURD
  router
    .route("/stats")

    .get(
      handleAsyncErrors(async (req, res) => {
        const today = moment().format("YYYY-MM-DD");
        const bookingsToday = await Booking.find({ date: today });
        const bookingServing = await Booking.find({ status: "IN_SERVICE" });
        const bookingDueCount = bookingServing.filter(booking => {
          return moment(booking.checkInAt).diff() < -booking.hours * 3600000;
        }).length;
        res.json({
          checkedInCount: bookingServing.length,
          dueCount: bookingDueCount,
          todayCount: bookingsToday.length,
          todayAmount: bookingsToday.reduce((amount, booking) => {
            return (
              amount +
              booking.payments
                .filter(p => p.paid)
                .reduce((a, p) => a + p.amount, 0)
            );
          }, 0)
        });
      })
    );

  return router;
};
