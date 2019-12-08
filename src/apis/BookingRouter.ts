import moment from "moment";
import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Booking, { IBooking, BookingStatuses } from "../models/Booking";
import User from "../models/User";
import Store from "../models/Store";
import EscPosEncoder from "esc-pos-encoder-canvas";
import { Image } from "canvas";
import Payment, { gatewayNames } from "../models/Payment";
import { config } from "../models/Config";
import stringWidth from "string-width";

setTimeout(async () => {
  // const u = await User.findOne({ name: "测试用户2" });
  // u.depositSuccess("deposit-1000");
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

        // if (booking.hours > config.hourPriceRatio.length) {
        //   throw new HttpError(
        //     400,
        //     `预定小时数超过限制（${config.hourPriceRatio.length}小时）`
        //   );
        // }

        if (
          req.user.role === "customer" &&
          !booking.customer.equals(req.user)
        ) {
          throw new HttpError(403, "只能为自己预订");
        }

        if (req.body.membersCount === 0 && req.body.kidsCount === 0) {
          throw new HttpError(400, "成人和儿童数不能都为0");
        }

        if (req.query.bypassBandIdsCheck && req.user.role !== "admin") {
          throw new HttpError(403);
        }

        if (req.body.bandIds && !req.query.bypassBandIdsCheck) {
          try {
            await booking.bindBands(req.query.authBands !== "false");
          } catch (err) {
            switch (err.message) {
              case "duplicate_band_id":
                throw new HttpError(400, `手环号重复`);
              case "band_count_unmatched":
                throw new HttpError(
                  400,
                  `手环数量必须等于玩家数量（${booking.membersCount +
                    booking.kidsCount}）`
                );
              case "band_occupied":
                throw new HttpError(
                  400,
                  "一个或多个手环已被其他有效预定使用，无法绑定"
                );
              default:
                console.error(err);
            }
          }
        }

        try {
          await booking.calculatePrice();
        } catch (err) {
          switch (err.message) {
            case "code_not_found":
              throw new HttpError(400, "优惠券不存在");
            case "code_used":
              throw new HttpError(403, "优惠券已经使用");
            case "coupon_not_found":
              throw new HttpError(400, "优惠不存在");
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

        const $and = []; // combine all $or conditions into one $and

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

        if (req.query.due) {
          query.find({
            status: BookingStatuses.IN_SERVICE
          });
          $and.push({
            $or: config.hourPriceRatio.map((ratio, index) => {
              const hours = index + 1;
              return {
                hours,
                checkInAt: {
                  $lt: moment()
                    .subtract(hours, "hours")
                    .subtract(5, "minutes")
                    .format("HH:mm:ss")
                }
              };
            })
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

        if (req.query.bandId) {
          $and.push({
            $or: [
              { bandIds: new RegExp(req.query.bandId) },
              { bandIds8: +req.query.bandId }
            ]
          });
        }

        if (req.query.coupon) {
          query.find({ coupon: new RegExp(req.query.coupon) });
        }

        // restrict self store bookings for managers
        // TODO

        if ($and.length) {
          query.find({ $and });
        }

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

        const result = page.map(i => {
          const o = i.toJSON();
          if (o.store && o.store.localServer) {
            delete o.store.localServer;
          }
          return o;
        });

        res.paginatify(limit, skip, total).json(result);
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

        await booking.populate("customer").execPopulate();
        await booking.populate("store").execPopulate();

        if (req.body.bandIds) {
          try {
            await booking.bindBands(req.query.authBands !== "false");
          } catch (err) {
            switch (err.message) {
              case "duplicate_band_id":
                throw new HttpError(400, `手环号重复`);
              case "band_count_unmatched":
                throw new HttpError(
                  400,
                  `手环数量必须等于玩家数量（${booking.membersCount +
                    booking.kidsCount}）`
                );
              case "band_occupied":
                throw new HttpError(
                  400,
                  "一个或多个手环已被其他有效预定使用，无法绑定"
                );
              default:
                console.error(err);
            }
          }
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
          if (booking.hours && booking.hours < hoursWas) {
            throw new HttpError(
              400,
              "Hour must greater than original if not equal."
            );
          }
          if (!hoursWas) {
            throw new HttpError(
              400,
              "Cannot extend hours for unlimited booking."
            );
          }
          const priceWas = booking.price;
          try {
            await booking.calculatePrice();
          } catch (err) {
            switch (err.message) {
              case "code_not_found":
                throw new HttpError(400, "优惠券不存在");
              case "code_used":
                throw new HttpError(403, "优惠券已经使用");
              case "coupon_not_found":
                throw new HttpError(400, "优惠不存在");
              default:
                throw err;
            }
          }
          const extendHoursBy = booking.hours ? booking.hours - hoursWas : 0;
          booking.hours = hoursWas;
          try {
            await booking.createPayment(
              {
                paymentGateway: req.query.paymentGateway,
                useCredit: req.query.useCredit !== "false",
                adminAddWithoutPayment: req.user.role === "admin",
                extendHoursBy
              },
              booking.price - priceWas
            );
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
        .line("手机尾号：" + booking.customer.mobile.substr(-4))
        .line("会员卡号：" + (booking.customer.cardNo || "无"))
        .line("打印时间：" + moment().format("YYYY-MM-DD HH:mm:ss"))
        .line("入场人数：" + booking.membersCount + booking.kidsCount);

      if (booking.hours) {
        encoder.line(
          "出场时间：" +
            moment(booking.checkInAt, "HH:mm:ss")
              .add(booking.hours, "hours")
              .format("YYYY-MM-DD HH:mm:ss")
        );
      }

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

      if (
        booking.type === "play" &&
        !booking.coupon &&
        !booking.code &&
        booking.hours
      ) {
        const cardType = config.cardTypes[booking.customer.cardType];

        const firstHourPrice =
          (cardType && cardType.firstHourPrice) || config.hourPrice;
        const kidFirstHourPrice = config.kidHourPrice;

        for (let thHour = 0; thHour <= booking.hours; thHour++) {
          encoder.line(
            "自由游玩" +
              " ".repeat(2) +
              `${booking.membersCount}成人第${thHour + 1}小时` +
              " ".repeat(2) +
              `￥${(
                firstHourPrice *
                config.hourPriceRatio[thHour] *
                booking.membersCount
              ).toFixed(2)}`
          );
          if (booking.kidsCount) {
            encoder.line(
              "自由游玩" +
                " ".repeat(2) +
                `${booking.kidsCount}儿童第${thHour + 1}小时` +
                " ".repeat(2) +
                `￥${(
                  kidFirstHourPrice *
                  config.hourPriceRatio[thHour] *
                  booking.kidsCount
                ).toFixed(2)}`
            );
          }
        }
      }

      if (
        booking.type === "play" &&
        !booking.hours &&
        !booking.coupon &&
        !booking.code
      ) {
        encoder.line(
          "自由游玩" +
            " ".repeat(2) +
            `${booking.membersCount}成人 畅玩` +
            " ".repeat(4) +
            `￥${(config.unlimitedPrice * booking.membersCount).toFixed(2)}`
        );
        if (booking.kidsCount) {
          encoder.line(
            "自由游玩" +
              " ".repeat(2) +
              `${booking.kidsCount}儿童 畅玩` +
              " ".repeat(4) +
              `￥${(config.kidUnlimitedPrice * booking.kidsCount).toFixed(2)}`
          );
        }
      }

      if (booking.coupon) {
        const coupon = config.coupons.find(c => c.slug === booking.coupon);
        if (coupon) {
          encoder.line(
            coupon.name +
              " ".repeat(
                Math.max(
                  0,
                  31 -
                    stringWidth(coupon.name) -
                    stringWidth(
                      coupon.price ? `￥${coupon.price.toFixed(2)}` : ""
                    )
                )
              ) +
              (coupon.price ? `￥${coupon.price.toFixed(2)}` : "")
          );
        }
      }

      if (booking.code) {
        await booking.populate("code").execPopulate();
        encoder.line(
          booking.code.title +
            " ".repeat(
              Math.max(
                0,
                31 -
                  stringWidth(booking.code.title) -
                  stringWidth(`￥${(0).toFixed(2)}`)
              )
            ) +
            `￥${(0).toFixed(2)}`
        );
      }

      if (booking.socksCount > 0) {
        encoder.line(
          "蹦床袜" +
            " ".repeat(7) +
            `${booking.socksCount}双` +
            " ".repeat(7) +
            `￥${(config.sockPrice * booking.socksCount).toFixed(2)}`
        );
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

      // if (booking.hours > config.hourPriceRatio.length) {
      //   throw new HttpError(
      //     400,
      //     `预定小时数超过限制（${config.hourPriceRatio.length}小时）`
      //   );
      // }

      try {
        await booking.calculatePrice();
      } catch (err) {
        switch (err.message) {
          case "code_not_found":
            throw new HttpError(400, "优惠券不存在");
          case "code_used":
            throw new HttpError(403, "优惠券已经使用");
          case "coupon_not_found":
            throw new HttpError(400, "优惠不存在");
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
