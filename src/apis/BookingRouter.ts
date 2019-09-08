import moment from "moment";
import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Booking, { IBooking } from "../models/Booking";
import { config } from "../models/Config";
import User from "../models/User";
import Store from "../models/Store";

// setTimeout(async () => {
//   const u = await User.findOne({ name: "Uice Stone" });
//   u.depositSuccess(2000);
// }, 500);

export default router => {
  // Booking CURD
  router
    .route("/booking")

    // create a booking
    .post(
      handleAsyncErrors(async (req, res) => {
        if (req.body.status && req.user.role !== "admin") {
          throw new HttpError(403, "Only admin can set status directly.");
        }

        const booking = new Booking(req.body);

        if (!booking.customer) {
          booking.customer = req.user;
        }
        await booking.populate("customer").execPopulate();

        if (!booking.customer) {
          throw new HttpError(401, "客户信息错误");
        }

        if (!booking.store) {
          booking.store = await Store.findOne();
          // TODO booking default store should be disabled
        }
        await booking.populate("store").execPopulate();

        if (!booking.store || !booking.store.name) {
          throw new HttpError(400, "门店信息错误");
        }

        if (!booking.date) {
          booking.date = moment().format("YYYY-MM-DD");
        }

        if (!booking.checkInAt) {
          booking.checkInAt = moment()
            .add(5, "minutes")
            .format("HH:mm:ss");
        }

        if (booking.hours > config.hourPriceRatio.length) {
          throw new HttpError(
            400,
            `预定小时数超过限制（${config.hourPriceRatio.length}小时）`
          );
        }

        if (
          req.user.role === "customer" &&
          !booking.customer.equals(req.user)
        ) {
          throw new HttpError(403, "只能为自己预订");
        }

        if (
          req.body.bandIds &&
          req.body.bandIds.length &&
          req.body.bandIds.length !== booking.membersCount
        ) {
          throw new HttpError(
            400,
            `手环数量必须等于玩家数量（${booking.membersCount}）`
          );
        }

        try {
          await booking.calculatePrice();
        } catch (err) {
          switch (err.message) {
            case "coupon_not_found":
              throw new HttpError(400, "优惠券不存在");
            case "coupon_used":
              throw new HttpError(403, "优惠券已经使用");
            default:
              throw err;
          }
        }

        try {
          await booking.createPayment({
            paymentGateway: req.query.paymentGateway,
            useCredit: req.query.useCredit !== "false",
            adminAddWithoutPayment: req.user.role === "admin"
          });
        } catch (err) {
          switch (err.message) {
            case "no_customer_openid":
              throw new HttpError(400, "Customer openid is missing.");
            case "insufficient_credit":
              throw new HttpError(400, "Customer credit is insufficient.");
            default:
          }
        }

        if (booking.code) {
          booking.code.used = true;
          await booking.code.save();
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

        // restrict self bookings for customers
        if (req.user.role === "customer") {
          query.find({ customer: req.user._id });
        }

        ["type", "store", "date", "status", "customer"].forEach(field => {
          if (req.query[field]) {
            query.find({ [field]: req.query[field] });
          }
        });

        // restrict self store bookings for managers
        // TODO

        let total = await query.countDocuments();

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
        const booking = await Booking.findOne({ _id: req.params.bookingId });
        if (req.user.role === "customer") {
          if (!booking.customer.equals(req.user)) {
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

    .put(
      handleAsyncErrors(async (req, res) => {
        const booking = req.item as IBooking;

        // TODO restrict for roles

        const statusWas = booking.status;
        const hoursWas = booking.hours;

        booking.set(req.body);

        if (
          req.body.bandIds &&
          req.body.bandIds.length !== booking.membersCount
        ) {
          throw new HttpError(
            400,
            `手环数量必须等于玩家数量（${booking.membersCount}）`
          );
        }

        if (booking.status === "IN_SERVICE" && statusWas === "BOOKED") {
          if (!booking.bandIds.length) {
            throw new Error("必须绑定手环才能签到入场");
          }
          booking.checkIn();
        }

        if (booking.status === "CANCELED") {
          // TODO refund permission should be restricted
          // TODO IN_SERVICE refund

          try {
            booking.status = statusWas;
            await booking.cancel(false);
          } catch (err) {
            switch (err.message) {
              case "uncancelable_booking_status":
                throw new HttpError(
                  403,
                  "服务状态无法取消，只有待付款/已确认状态才能取消"
                );
              default:
                throw err;
            }
          }
        }

        if (hoursWas !== booking.hours) {
          if (booking.hours < hoursWas) {
            throw new HttpError(
              400,
              "Hour must greater than original if not equal."
            );
          }
          const priceWas = booking.price;
          await booking.calculatePrice();
          await booking.createPayment(
            {
              paymentGateway: req.query.paymentGateway,
              useCredit: req.query.useCredit !== "false",
              adminAddWithoutPayment: req.user.role === "admin",
              extendHoursBy: booking.hours - hoursWas
            },
            booking.price - priceWas
          );
          booking.hours = hoursWas;
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

  router.route("/booking-price").post(
    handleAsyncErrors(async (req, res) => {
      const booking = new Booking(req.body);

      if (!booking.customer) {
        booking.customer = req.user;
      }
      await booking.populate("customer").execPopulate();

      if (!booking.customer) {
        throw new HttpError(401, "客户信息错误");
      }

      if (!booking.store) {
        booking.store = await Store.findOne();
        // TODO booking default store should be disabled
      }
      await booking.populate("store").execPopulate();

      if (!booking.store || !booking.store.name) {
        throw new HttpError(400, "门店信息错误");
      }

      if (!booking.date) {
        booking.date = moment().format("YYYY-MM-DD");
      }

      if (!booking.checkInAt) {
        booking.checkInAt = moment()
          .add(5, "minutes")
          .format("HH:mm:ss");
      }

      if (booking.hours > config.hourPriceRatio.length) {
        throw new HttpError(
          400,
          `预定小时数超过限制（${config.hourPriceRatio.length}小时）`
        );
      }

      try {
        await booking.calculatePrice();
      } catch (err) {
        switch (err.message) {
          case "coupon_not_found":
            throw new HttpError(400, "优惠券不存在");
          case "coupon_used":
            throw new HttpError(403, "优惠券已经使用");
          default:
            throw err;
        }
      }

      res.json({ price: booking.price });
    })
  );

  router
    /**
     *  get availability of dates
     *  :type could be 'play', 'party'
     *  either ?month=2019-07 or ?date=2019-07-11 should be provided
     */
    .route("/booking-availability/:type")
    .get(
      handleAsyncErrors(async (req, res) => {
        const { month, date, hours } = req.query;
        const { type } = req.params;
        if (!month && !date) {
          throw new HttpError(400, "Missing month or date in query.");
        }
        if (date && !hours) {
          throw new HttpError(
            400,
            "Missing hours in query, date availability requires hours."
          );
        }
        if (!["play", "party"].includes(type)) {
          throw new HttpError(400, `Invalid booking type: ${type}.`);
        }

        let availability: {
          full: string[];
          peak?: string[];
          remarks?: string;
          checkInAt?: string[];
        } = { full: [] };

        if (date && type !== "party") {
          availability.remarks = "Only party has hourly availability.";
        } else if (month) {
          const nextMonth = moment(month, "YYYY-MM")
            .add(1, "month")
            .format("YYYY-MM");

          availability = {
            full: ["2019-07-16", "2019-07-18"],
            peak: ["2019-07-20", "2019-07-21"]
          };
        } else {
          availability = {
            full: ["10:00", "12:00", "16:00", "20:00"],
            checkInAt: [
              "11:00",
              "13:00",
              "14:00",
              "15:00",
              "17:00",
              "18:00",
              "19:00",
              "21:00"
            ]
          };
        }

        res.json(availability);
      })
    );

  return router;
};
