import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import User, { IUser } from "../models/User";
import { hashPwd, icCode10To8 } from "../utils/helper";
import { config } from "../models/Config";
import Payment, { Gateways } from "../models/Payment";
import Store from "../models/Store";
import idCard from "idcard";
import Code from "../models/Code";

const { DEBUG } = process.env;

export default router => {
  // User CURD
  router
    .route("/user")

    // create a user
    .post(
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          ["role", "openid", "codes", "cardType", "credit"].forEach(f => {
            delete req.body[f];
          });
        }
        if (req.body.password) {
          req.body.password = await hashPwd(req.body.password);
        }
        if (req.body.mobile) {
          const userMobileExists = await User.findOne({
            mobile: req.body.mobile
          });
          if (userMobileExists) {
            throw new HttpError(409, `手机号${req.body.mobile}已被使用.`);
          }
        }
        if (req.body.cardNo) {
          const userCardNoExists = await User.findOne({
            cardNo: req.body.cardNo
          });
          if (userCardNoExists) {
            throw new HttpError(409, `会员卡号${req.body.cardNo}已被使用.`);
          }
        }
        if (req.body.idCardNo) {
          req.body.idCardNo = req.body.idCardNo.replace("*", "X").toUpperCase();
          const userIdCardNoExists = await User.findOne({
            idCardNo: req.body.idCardNo
          });
          if (userIdCardNoExists) {
            throw new HttpError(409, `身份证号${req.body.idCardNo}已被使用.`);
          }
        }
        const user = new User(req.body);
        if (req.body.idCardNo) {
          const idCardInfo = idCard.info(req.body.idCardNo);
          if (!idCardInfo.valid) {
            throw new HttpError(400, `非法身份证号`);
          }
          user.gender = idCardInfo.gender === "M" ? "男" : "女";
          user.region = `${idCardInfo.province.text} ${idCardInfo.city.text} ${idCardInfo.area.text}`;
          user.constellation = idCardInfo.constellation;
          user.birthday = idCardInfo.birthday
            .toString()
            .replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
        }
        await user.save();

        // award user an 0.5-hour code
        const trialCode = new Code({
          customer: user.id,
          title: "半小时体验券",
          price: 49,
          amount: 0,
          hours: 0.5
        });
        await trialCode.save();
        user.codes.push(trialCode);
        await user.save();

        res.json(user);
      })
    )

    // get all the users
    .get(
      paginatify,
      handleAsyncErrors(async (req, res) => {
        if (!["admin", "manager"].includes(req.user.role)) {
          // TODO should restrict manager user list to own store booking
          throw new HttpError(403);
        }
        const { limit, skip } = req.pagination;
        const query = User.find();
        const sort = parseSortString(req.query.order) || {
          createdAt: -1
        };

        const $and = []; // combine all $or conditions into one $and

        if (req.query.keyword) {
          $and.push({
            $or: [
              { name: new RegExp(req.query.keyword, "i") },
              { mobile: new RegExp(req.query.keyword) },
              { cardNo: new RegExp(req.query.keyword) }
            ]
          });
        }

        if (req.query.role) {
          query.find({ role: req.query.role });
        }

        if (req.query.membership) {
          const membershipConditions = {
            code: { codeAmount: { $gt: 0 } },
            deposit: { creditDeposit: { $gt: 0 } }
          };
          $and.push({
            $or: req.query.membership.map(type => membershipConditions[type])
          });
        }

        if (req.query.cardTypes) {
          query.find({ cardType: { $in: req.query.cardTypes } });
        }

        if ($and.length) {
          query.find({ $and });
        }

        let total = await query.countDocuments();
        const [{ totalCredit } = { totalCredit: 0 }] = await User.aggregate([
          //@ts-ignore
          { $match: query._conditions },
          {
            $group: {
              _id: null,
              totalCredit: {
                $sum: { $sum: ["$creditDeposit", "$codeAmount"] }
              }
            }
          }
        ]);

        const page = await query
          .find()
          .sort(sort)
          .limit(limit)
          .skip(skip)
          .exec();

        if (skip + page.length > total) {
          total = skip + page.length;
        }

        res.set("total-credit", Math.round(totalCredit));

        res.paginatify(limit, skip, total).json(page);
      })
    );

  router
    .route("/user/:userId")

    .all(
      handleAsyncErrors(async (req, res, next) => {
        const user = await User.findById(req.params.userId);
        if (
          !["admin", "manager"].includes(req.user.role) &&
          req.user.id !== req.params.userId
        ) {
          throw new HttpError(403);
        }
        if (!user) {
          throw new HttpError(404, `User not found: ${req.params.userId}`);
        }
        req.item = user;
        next();
      })
    )

    // get the user with that id
    .get(
      handleAsyncErrors(async (req, res) => {
        const user = req.item;
        res.json(user);
      })
    )

    .put(
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          [
            "role",
            "openid",
            "codes",
            "cardType",
            "creditDeposit",
            "creditReward"
          ].forEach(f => {
            delete req.body[f];
          });
        }
        if (!["admin", "manager"].includes(req.user.role)) {
          ["cardNo"].forEach(f => {
            delete req.body[f];
          });
        }
        const user = req.item as IUser;
        if (req.body.password) {
          console.log(`[USR] User ${user.id} password reset.`);
          req.body.password = await hashPwd(req.body.password);
        }
        if (req.body.mobile) {
          const userMobileExists = await User.findOne({
            mobile: req.body.mobile,
            _id: { $ne: user.id }
          });
          if (userMobileExists) {
            throw new HttpError(409, `手机号${req.body.mobile}已被使用`);
          }
        }
        if (req.body.cardNo) {
          const userCardNoExists = await User.findOne({
            cardNo: req.body.cardNo,
            _id: { $ne: user.id }
          });
          if (userCardNoExists) {
            throw new HttpError(409, `会员卡号${req.body.cardNo}已被使用`);
          }
        }
        if (req.body.idCardNo) {
          req.body.idCardNo = req.body.idCardNo.replace("*", "X").toUpperCase();
          const userIdCardNoExists = await User.findOne({
            idCardNo: req.body.idCardNo,
            _id: { $ne: user.id }
          });
          if (userIdCardNoExists) {
            throw new HttpError(409, `身份证号${req.body.idCardNo}已被使用`);
          }
        }
        if (req.body.isForeigner) {
          if (!req.body.country) {
            throw new HttpError(400, "外籍用户必须录入国籍");
          }
        }
        if (req.body.passNo) {
          if (req.user.role !== "admin") {
            throw new HttpError(403);
          }
          user.passNo8 = icCode10To8(req.body.passNo);
          const store = await Store.findOne();
          store.authBands([req.body.passNo]);
        }

        user.set(req.body);

        if (req.body.idCardNo) {
          const idCardInfo = idCard.info(req.body.idCardNo);
          if (!idCardInfo.valid) {
            throw new HttpError(400, `非法身份证号`);
          }
          user.gender = idCardInfo.gender === "M" ? "男" : "女";
          user.region = `${idCardInfo.province.text} ${idCardInfo.city.text} ${idCardInfo.area.text}`;
          user.constellation = idCardInfo.constellation;
          user.birthday = idCardInfo.birthday
            .toString()
            .replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
        }

        if (req.body.cardNo) {
          console.log(
            `[USR] User ${user.id} card number set to ${user.cardNo}.`
          );
        }
        await user.save();
        res.json(user);
      })
    )

    // delete the user with this id
    .delete(
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const user = req.item;
        await user.remove();
        res.end();
      })
    );

  router.route("/user-deposit/:userId?").post(
    handleAsyncErrors(async (req, res) => {
      const customer = await User.findOne({
        _id: req.params.userId || req.user.id
      });

      if (customer.id !== req.user.id && req.user.role !== "manager") {
        throw new HttpError(
          403,
          "店员可以为所有人充值，其他用户只能为自己充值"
        );
      }

      const level = config.depositLevels.filter(
        level => level.slug === req.body.depositLevel
      )[0];

      if (!level) {
        throw new HttpError(400, "充值种类错误");
      }

      const payment = new Payment({
        customer,
        amount: DEBUG ? level.price / 1e4 : level.price,
        title: `${level.desc}`,
        attach: `deposit ${customer.id} ${level.slug}`,
        gateway: req.query.paymentGateway || Gateways.WechatPay // TODO more payment options
      });

      try {
        await payment.save();
      } catch (err) {
        switch (err.message) {
          case "no_customer_openid":
            throw new HttpError(400, "Customer openid is missing.");
          default:
            throw err;
        }
      }

      console.log(`[PAY] Payment created, id: ${payment._id}.`);

      res.json(payment);
    })
  );

  router.route("/user-membership").post(
    handleAsyncErrors(async (req, res) => {
      const cardTypeName = req.body.cardType;
      const cardType = config.cardTypes[cardTypeName];

      if (!cardType) {
        throw new HttpError(400, "会员类型错误");
      }

      const payment = new Payment({
        customer: req.user,
        amount: DEBUG ? cardType.netPrice / 1e4 : cardType.netPrice,
        title: `${cardTypeName}卡会员资格`,
        attach: `membership ${req.user._id} ${cardTypeName}`,
        gateway: Gateways.WechatPay // TODO more payment options
      });

      await payment.save();

      console.log(`[PAY] Payment created, id: ${payment._id}.`);

      res.json(payment);
    })
  );

  return router;
};
