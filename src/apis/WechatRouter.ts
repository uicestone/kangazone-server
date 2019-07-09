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
      const { code, encryptedData, iv } = req.body;
      if (!code || !encryptedData || !iv) {
        throw new HttpError(400, "缺少参数");
      }
      const userData = await oAuth.getUser(code, encryptedData, iv);
      const {
        openid,
        session_key,
        userInfo: {
          nickName,
          avatarUrl,
          gender,
          city,
          province,
          country,
          unionId
        }
      } = userData;

      let user = await User.findOne({ openid });
      if (!user) {
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
        if (!pay.verifySign(parsedData)) {
          throw new Error("WechatPay sign error: " + parsedData.out_trade_no);
        }
        if (parsedData.result_code === "FAIL") {
          throw new Error("WechatPay error: " + parsedData.out_trade_no);
        }

        const payment = await Payment.findOne({ _id: parsedData.out_trade_no });
        payment.paid = true;
        payment.gatewayData = parsedData;
        const paymentAttach = payment.attach.split(" ");
        switch (paymentAttach[0]) {
          case "booking":
            const booking = await Booking.findOne({ _id: paymentAttach[1] });
            await booking.paymentSuccess();
            break;
          case "deposit":
            const user = await User.findOne({ _id: paymentAttach[1] });
            await user.depositSuccess(+paymentAttach[2]);
            break;
          default:
            console.error(
              `[PAY] Unknown payment attach: ${JSON.stringify(payment.attach)}`
            );
        }
        // TODO trigger booking.paymentSuccess or user.depositSuccess

        console.log(`[PAY] WechatPay success.`, parsedData);

        return {
          return_code: "SUCCESS",
          return_msg: "OK"
        };
      });

      res.send(utils.toXML(returnData));
    })
  );
  return router;
};
