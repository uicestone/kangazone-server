import moment from "moment";
import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Booking from "../models/Booking";
import Payment, { Gateways } from "../models/Payment";
import { payArgs as wechatPayArgs } from "../utils/wechat";
import { config } from "../models/Config";
import User from "../models/User";

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

        booking.price = config.hourPriceRatio
          .slice(0, booking.hours)
          .reduce((price, ratio) => {
            return +(price + firstHourPrice * ratio).toFixed(2);
          }, 0);

        const { useCredit = true } = req.query;

        let creditPayAmount = 0;

        if (useCredit && customer.credit) {
          const creditPayAmount = Math.min(booking.price, customer.credit);
          customer.credit -= creditPayAmount;
          customer.validate();
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

        let payArgs: {};

        const extraPayAmount = booking.price - creditPayAmount;

        if (extraPayAmount >= 0.01) {
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

            payArgs = wechatPayArgs(wechatGatewayData);
          }
        }

        await booking.save();

        res.json({ payArgs, ...booking.toObject() });
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
