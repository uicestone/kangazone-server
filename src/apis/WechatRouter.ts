import { Router } from "express";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import User from "../models/User";
import { oAuth, pay } from "../utils/wechat";
import HttpError from "../utils/HttpError";
import { utils } from "@sigodenjs/wechatpay";
import { signToken } from "../utils/helper";
import Payment from "../models/Payment";
import Booking from "../models/Booking";

export default (router: Router) => {
  router.route("/wechat/login").post(
    handleAsyncErrors(async (req, res) => {
      const { code } = req.body;
      if (!code) throw new Error("缺少参数");
      const { openid, session_key } = await oAuth.getUser(code);
      const user = await User.findOne({ openid });
      res.json({
        user,
        token: user ? signToken(user) : null,
        session_key,
        openid
      });
    })
  );

  router.route("/wechat/signup").post(
    handleAsyncErrors(async (req, res) => {
      const { session_key, encryptedData, iv } = req.body;
      if (!session_key || !encryptedData || !iv) {
        throw new Error("缺少参数");
      }

      const userData = oAuth.decrypt(encryptedData, session_key, iv);
      const { openid } = userData;

      let user = await User.findOne({ openid });
      if (!user) {
        const {
          nickName,
          avatarUrl,
          gender,
          city,
          province,
          country
        } = userData;
        user = await User.create({
          openid,
          name: nickName,
          gender,
          avatarUrl,
          region: `${country} ${province} ${city}`
        });
      }

      res.json({
        user,
        token: signToken(user),
        openid,
        session_key
      });
    })
  );

  router.route("/wechat/decrypt").post(
    handleAsyncErrors(async (req, res) => {
      const { encryptedData, session_key, iv } = req.body;
      if (!session_key || !encryptedData || !iv) {
        throw new HttpError(400, "缺少参数");
      }
      const data = oAuth.decrypt(encryptedData, session_key, iv);
      res.json(data);
    })
  );

  router.route("/wechat/pay/notify").post(
    handleAsyncErrors(async (req, res) => {
      let data: any = await utils.fromXML(req.body);
      const returnData = await pay.payNotify(data, async parsedData => {
        const successData = {
          return_code: "SUCCESS",
          return_msg: "OK"
        };

        if (!pay.verifySign(parsedData)) {
          throw new Error("WechatPay sign error: " + parsedData.out_trade_no);
        }
        if (parsedData.result_code === "FAIL") {
          throw new Error("WechatPay error: " + parsedData.out_trade_no);
        }

        console.log(
          `[PAY] WechatPay success. Data: ${JSON.stringify(parsedData)}`
        );

        const payment = await Payment.findOne({ _id: parsedData.out_trade_no });

        console.log(`[PAY] Payment found, id: ${parsedData.out_trade_no}.`);

        if (!payment) {
          return {
            return_code: "FAIL",
            return_msg: `Payment id not found: ${parsedData.out_trade_no}.`
          };
        }

        if (payment.paid) {
          console.log(`[PAY] Payment ${payment._id} is paid before, skipped.`);
          return successData;
        }

        payment.paid = true;
        payment.gatewayData = parsedData;
        const paymentAttach = payment.attach.split(" ");
        switch (paymentAttach[0]) {
          case "booking":
            const booking = await Booking.findOne({ _id: paymentAttach[1] });
            await booking.paymentSuccess();
            console.log(`[PAY] Booking payment success, id: ${booking._id}.`);
            break;
          case "deposit":
            const user = await User.findOne({ _id: paymentAttach[1] });
            await user.depositSuccess(+paymentAttach[2]);
            console.log(`[PAY] User deposit success, id: ${user._id}.`);
            break;
          default:
            console.error(
              `[PAY] Unknown payment attach: ${JSON.stringify(payment.attach)}`
            );
        }

        await payment.save();

        return successData;
      });

      res.type("application/xml; charset=utf-8");
      res.end(returnData);
    })
  );
  return router;
};
