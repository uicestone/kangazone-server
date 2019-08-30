import moment from "moment";
import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import User from "../models/User";
import { signToken, hashPwd } from "../utils/helper";
import { config } from "../models/Config";
import Payment, { Gateways } from "../models/Payment";
import { payArgs as wechatPayArgs } from "../utils/wechat";

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
          res.body.password = hashPwd(res.body.password);
        }
        const user = new User(req.body);
        await user.save();
        res.json(user);
      })
    )

    // get all the users
    .get(
      paginatify,
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const { limit, skip } = req.pagination;
        const query = User.find();
        const sort = parseSortString(req.query.order) || {
          createdAt: -1
        };

        if (req.query.keyword) {
          query.find({ name: new RegExp(req.query.keyword, "i") });
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

        res.paginatify(limit, skip, total).json(page);
      })
    );

  router
    .route("/user/:userId")

    .all(
      handleAsyncErrors(async (req, res, next) => {
        const user = await User.findById(req.params.userId);
        if (
          req.user.role !== "admin" &&
          !req.user._id.equals(req.params.userId)
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
          ["role", "openid", "codes", "cardType", "credit"].forEach(f => {
            delete req.body[f];
          });
        }
        if (req.body.password) {
          req.body.password = hashPwd(req.body.password);
        }
        const user = req.item;
        user.set(req.body);
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

  router.route("/user-deposit").post(
    handleAsyncErrors(async (req, res) => {
      const level = config.depositLevels.filter(
        level => level.price === +req.body.depositLevel
      )[0];

      if (!level) {
        throw new HttpError(400, "充值金额错误");
      }

      const payment = new Payment({
        customer: req.user,
        amount: DEBUG === "true" ? level.price / 1e4 : level.price,
        title: `${level.cardType}卡 充值${level.price}元`,
        attach: `deposit ${req.user._id} ${level.price}`,
        gateway: Gateways.WechatPay // TODO more payment options
      });

      await payment.save();

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
        amount: DEBUG === "true" ? cardType.netPrice / 1e4 : cardType.netPrice,
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
