import moment from "moment";
import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Booking, { IBooking, BookingStatuses } from "../models/Booking";
import { config } from "../models/Config";
import User from "../models/User";
import Store from "../models/Store";
import EscPosEncoder from "esc-pos-encoder-canvas";
import { Image } from "canvas";
import Payment, { gatewayNames } from "../models/Payment";
import agenda from "../utils/agenda";
import { icCode10To8 } from "../utils/helper";

setTimeout(async () => {
  //   const u = await User.findOne({ name: "Uice Stone" });
  //   u.depositSuccess(2000);
}, 500);

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
            case "code_not_found":
              throw new HttpError(400, "优惠券不存在");
            case "code_used":
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
              throw err;
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

        ["type", "store", "date", "customer"].forEach(field => {
          if (req.query[field]) {
            query.find({ [field]: req.query[field] });
          }
        });

        if (req.query.status) {
          query.find({
            status: {
              $in: req.query.status.split(",").map(s => s.toUpperCase())
            }
          });
        }

        if (req.query.customerKeyword) {
          const matchCustomers = await User.find({
            $or: [
              { name: new RegExp(req.query.customerKeyword, "i") },
              { mobile: new RegExp(req.query.customerKeyword) },
              { cardNo: new RegExp(req.query.customerKeyword) }
            ]
          });
          query.find({ customer: { $in: matchCustomers } });
        }

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

        if (req.body.bandIds && req.body.bandIds.length) {
          if (req.body.bandIds.length !== booking.membersCount) {
            throw new HttpError(
              400,
              `手环数量必须等于玩家数量（${booking.membersCount}）`
            );
          }
          // (re)authorize band to gate controllers
          try {
            booking.bandIds8 = booking.bandIds.map(id => icCode10To8(id));
            await booking.store.authBands(booking.bandIds);
            if (booking.hours) {
              agenda.schedule(`in ${booking.hours} hours`, "revoke band auth", {
                bandIds: booking.bandIds,
                storeId: booking.store.id
              });
            }
          } catch (err) {
            console.error(`Booking auth bands failed, id: ${booking.id}.`);
            console.error(err);
          }
          // (re)setup revoke job at [now + hours]
        }

        if (
          booking.status === BookingStatuses.IN_SERVICE &&
          statusWas === BookingStatuses.BOOKED
        ) {
          if (!booking.bandIds.length) {
            throw new HttpError(400, "必须绑定手环才能签到入场");
          }
          booking.checkIn(false);
        }

        if (
          booking.status === BookingStatuses.CANCELED &&
          req.user.role !== "admin"
        ) {
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

        const booking = req.item as IBooking;

        if (booking.payments.some(p => p.paid)) {
          throw new HttpError(403, "已有成功付款记录，无法删除");
        }

        await Payment.deleteOne({
          _id: { $in: booking.payments.map(p => p.id) }
        });
        await booking.remove();
        res.end();
      })
    );

  router.route("/booking/:bookingId/receipt-data").get(
    handleAsyncErrors(async (req, res) => {
      if (!["manager", "admin"].includes(req.user.role)) {
        throw new HttpError(403, "只有店员可以打印小票");
      }

      const receiptLogo = new Image();

      await new Promise((resolve, reject) => {
        receiptLogo.onload = () => {
          resolve();
        };
        receiptLogo.onerror = err => {
          reject(err);
        };
        receiptLogo.src = __dirname + "/../resource/images/logo-greyscale.png";
      });

      const booking = await Booking.findOne({ _id: req.params.bookingId });

      if (
        ![
          BookingStatuses.BOOKED,
          BookingStatuses.IN_SERVICE,
          BookingStatuses.FINISHED
        ].includes(booking.status) &&
        booking.bandIds.length
      ) {
        throw new HttpError(
          400,
          `当前预定状态无法打印小票 (${booking.status})`
        );
      }

      let encoder = new EscPosEncoder();
      encoder
        .initialize()
        .codepage("cp936")
        .align("center")
        .image(receiptLogo, 384, 152, "threshold")
        .newline()
        .align("left")
        .line("打印时间：" + moment().format("YYYY-MM-DD HH:mm:ss"))
        .line(
          "出场时间：" +
            moment(booking.checkInAt, "HH:mm:ss")
              .add(10, "minutes")
              .add(2, "hours")
              .format("YYYY-MM-DD HH:mm:ss")
        )
        .line("入场人数：" + booking.membersCount);

      booking.bandIds.forEach((bandId, index) => {
        const noStr = (index + 1).toString().padStart(2, "0");
        encoder.line(`手环号${noStr}：${bandId}`);
      });

      const counter = await User.findOne({ _id: req.user.id });

      encoder
        .line(`收银台号：${counter.name}`)
        .newline()
        .line("付款明细：")
        .line("-".repeat(31))
        .newline()
        .line(
          " ".repeat(3) +
            "类型" +
            " ".repeat(7) +
            "数量" +
            " ".repeat(7) +
            "金额" +
            " ".repeat(2)
        );

      if (booking.type === "play") {
        let playPrice = booking.price - 10 * booking.socksCount;
        let firstHourPrice = (playPrice / (booking.hours + 1)) * 2;

        for (let thHour = 1; thHour <= booking.hours; thHour++) {
          if (thHour === 1) {
            encoder.line(
              "自由游玩" +
                " ".repeat(3) +
                `${booking.membersCount}人x小时` +
                " ".repeat(4) +
                `￥${firstHourPrice.toFixed(2)}`
            );
          } else {
            encoder.line(
              "自由游玩" +
                " ".repeat(3) +
                `${booking.membersCount}人x小时(半)` +
                " ".repeat(4) +
                `￥${(firstHourPrice / 2).toFixed(2)}`
            );
          }
        }

        if (booking.socksCount > 0) {
          encoder.line(
            "蹦床袜" +
              " ".repeat(7) +
              `${booking.socksCount}双` +
              " ".repeat(7) +
              `￥${(10 * booking.socksCount).toFixed(2)}`
          );
        }
      }

      encoder
        .newline()
        .line("-".repeat(31))
        .newline()
        .align("right")
        .line(
          " ".repeat(3) + `合计：￥${booking.price.toFixed(2)}` + " ".repeat(4)
        );

      const creditPayment = booking.payments.filter(
        p => p.gateway === "credit" && p.paid
      )[0];
      if (creditPayment) {
        encoder.line(
          " ".repeat(3) +
            `余额支付：￥${creditPayment.amount.toFixed(2)}` +
            " ".repeat(4)
        );
      }

      const extraPayment = booking.payments.filter(
        p => p.gateway !== "credit" && p.paid
      )[0];

      if (extraPayment) {
        encoder.line(
          " ".repeat(3) +
            `${
              gatewayNames[extraPayment.gateway]
            }：￥${extraPayment.amount.toFixed(2)}` +
            " ".repeat(4)
        );
      }
      encoder
        .newline()
        .line("-".repeat(31))
        .align("center")
        .qrcode(
          "https://mp.weixin.qq.com/a/~vcK_feF35uOgreEAXvwxcw~~",
          1,
          8,
          "m"
        )
        .newline()
        .line("扫码使用微信小程序")
        .line("充值预定延时更方便")
        .align("right")
        .newline()
        .newline()
        .newline()
        .newline();

      const hexString = Buffer.from(encoder.encode()).toString("hex");

      res.send(hexString);
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
          case "code_not_found":
            throw new HttpError(400, "优惠券不存在");
          case "code_used":
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
              "11:00:00",
              "13:00:00",
              "14:00:00",
              "15:00:00",
              "17:00:00",
              "18:00:00",
              "19:00:00",
              "21:00:00"
            ]
          };
        }

        res.json(availability);
      })
    );

  return router;
};
