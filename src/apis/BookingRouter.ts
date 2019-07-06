import moment from "moment";
import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Booking from "../models/Booking";

export default router => {
  // Booking CURD
  router
    .route("/booking")

    // create a booking
    .post(
      handleAsyncErrors(async (req, res) => {
        const booking = new Booking(req.body);
        if (req.user.role === "customer") {
          booking.customer = req.user;
        }
        await booking.save();
        res.json(booking);
      })
    )

    // get all the bookings
    .get(
      paginatify,
      handleAsyncErrors(async (req, res) => {
        const { limit, skip } = req.pagination;
        const query = Booking.find();
        const sort = parseSortString(req.query.order) || {
          createdAt: -1
        };

        let total = await query.countDocuments();

        // restrict self bookings form customers
        if (req.user.role === "customer") {
          query.find({ customer: req.user._id });
        }

        // restrict self store bookings for managers
        // TODO

        const page = await query
          .find()
          .sort(sort)
          .limit(limit)
          .skip(skip)
          .exec();

        if (skip + page.length > total) {
          total = skip + page.length;
        }

        res.paginatify(limit, skip, total).json(page);
      })
    );

  router
    .route("/booking/:bookingId")

    .all(
      handleAsyncErrors(async (req, res, next) => {
        const booking = await Booking.findOne(req.params.bookingId);
        if (req.user.role === "customer") {
          if (!booking.customer.equals(req.user._id)) {
            throw new HttpError(403);
          }
        }
        if (!booking) {
          throw new HttpError(
            404,
            `Booking not found: ${req.params.bookingId}`
          );
        }
        req.item = booking;
        next();
      })
    )

    // get the booking with that id
    .get(
      handleAsyncErrors(async (req, res) => {
        const booking = req.item;
        res.json(booking);
      })
    )

    .patch(
      handleAsyncErrors(async (req, res) => {
        if (req.user.role === "customer") {
          throw new HttpError(
            403,
            "Customers are not allowed to change booking for now."
          );
        }
        const booking = req.item;
        booking.set(req.body);
        if (booking.payment && booking.payment.status === "COMPLETED") {
          booking.status = "paid";
        }
        await booking.save();
        // sendConfirmEmail(booking);
        res.json(booking);
      })
    )

    // delete the booking with this id
    .delete(
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const booking = req.item;
        await booking.remove();
        res.end();
      })
    );

  router
    .route("/booking-availability/:month")

    // get availability of dates
    .get(
      handleAsyncErrors(async (req, res) => {
        const yearMonth = req.params.month;
        const ltYearMonth = moment(yearMonth, "YYYY-MM")
          .add(1, "month")
          .format("YYYY-MM");
        const availability = {
          full: [],
          am: [],
          pm: []
        };
        const availabilityByDates = await Booking.aggregate([
          { $match: { date: { $gte: yearMonth, $lt: ltYearMonth } } },
          {
            $group: {
              _id: "$date",
              total: { $sum: 1 },
              am: { $sum: { $cond: [{ $eq: ["$ampm", "am"] }, 1, 0] } },
              pm: { $sum: { $cond: [{ $eq: ["$ampm", "pm"] }, 1, 0] } }
            }
          },
          {
            $project: {
              date: "$_id",
              _id: false,
              total: true,
              am: true,
              pm: true
            }
          }
        ]);

        availabilityByDates.forEach(availabilityByDate => {
          if (availabilityByDate.total >= 2) {
            availability.full.push(availabilityByDate.date);
          } else if (availabilityByDate.am >= 1) {
            availability.am.push(availabilityByDate.date);
          } else if (availabilityByDate.pm >= 1) {
            availability.pm.push(availabilityByDate.date);
          }
        });

        res.json(availability);
      })
    );

  return router;
};
