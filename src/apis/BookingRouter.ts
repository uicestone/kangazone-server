import moment from "moment";
import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Booking from "../models/Booking";
import Payment, { Gateways } from "../models/Payment";
import { config } from "../models/Config";
import User from "../models/User";
import Store from "../models/Store";

const { DEBUG } = process.env;

export default router => {
  // Booking CURD
  router
    .route("/booking")

    // create a booking
    .post(
      handleAsyncErrors(async (req, res) => {
        const booking = new Booking(req.body);
        if (!booking.customer) {
          booking.customer = req.user;
        }

        if (!booking.store) {
          booking.store = await Store.findOne();
        }
        await booking.populate("store").execPopulate();

        if (!booking.store.name) {
          throw new HttpError(400, "门店信息错误");
        }

        if (booking.hours > config.hourPriceRatio.length) {
          throw new HttpError(
            400,
            `预定小时数超过限制（${config.hourPriceRatio.length}小时）`
          );
        }

        if (
          req.user.role === "customer" &&
          !booking.customer.equals(req.user._id)
        ) {
          throw new HttpError(403, "只能为自己预订");
        }

        const customer = await User.findOne({ _id: req.user._id }); // load user from db to get cardType

        if (!customer) {
          throw new HttpError(401, "用户不存在");
        }

        const cardType = config.cardTypes[customer.cardType];

        const firstHourPrice = cardType
          ? cardType.firstHourPrice
          : config.hourPrice;

        let chargedHours = booking.hours;

        if (booking.code) {
          await booking.populate("code").execPopulate();
          if (!booking.code) {
            throw new HttpError(400, "优惠券不存在");
          }
        }

        if (booking.code && booking.code.hours) {
          chargedHours -= booking.code.hours;
        }

        booking.price = config.hourPriceRatio
          .slice(0, chargedHours)
          .reduce((price, ratio) => {
            return +(price + firstHourPrice * ratio).toFixed(2);
          }, 0);

        const useCredit = req.query.useCredit !== "false";

        let creditPayAmount = 0;

        if (useCredit && customer.credit) {
          creditPayAmount = Math.min(booking.price, customer.credit);
          const creditPayment = new Payment({
            customer: req.user,
            amount: creditPayAmount,
            title: `预定${booking.store.name} ${booking.date} ${
              booking.hours
            }小时 ${booking.checkInAt}入场`,
            attach: `booking ${booking._id}`,
            gateway: Gateways.Credit
          });
          await creditPayment.save();
          booking.payments.push(creditPayment);
        }

        const extraPayAmount = booking.price - creditPayAmount;
        if (extraPayAmount < 0.01) {
          booking.status = "BOOKED";
        } else {
          const extraPayment = new Payment({
            customer: req.user,
            amount: DEBUG === "true" ? extraPayAmount / 1e4 : extraPayAmount,
            title: `预定${booking.store.name} ${booking.date} ${
              booking.hours
            }小时 ${booking.checkInAt}入场`,
            attach: `booking ${booking._id}`,
            gateway: Gateways.WechatPay // TODO more payment options
          });

          await extraPayment.save();

          booking.payments.push(extraPayment);

          if (extraPayment.gateway === Gateways.WechatPay) {
            if (
              !extraPayment.gatewayData.nonce_str ||
              !extraPayment.gatewayData.prepay_id
            ) {
              throw new Error(
                `Incomplete gateway data: ${JSON.stringify(
                  extraPayment.gatewayData
                )}.`
              );
            }
            const wechatGatewayData = extraPayment.gatewayData as {
              nonce_str: string;
              prepay_id: string;
            };
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
        const booking = await Booking.findOne({ _id: req.params.bookingId });
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

    .put(
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
