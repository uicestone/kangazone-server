import { Router } from "express";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import User from "../models/User";
import { wxoauth, wxpay } from "../utils/wechat";
import HttpError from "../utils/HttpError";
import { utils as wepayUtils } from "@sigodenjs/wechatpay";
import { signToken } from "../utils/helper";

export default (router: Router) => {
  router.route("/wechat/login").post(
    handleAsyncErrors(async (req, res) => {
      const { code, encryptedData, iv } = req.body;
      if (!code || !encryptedData || !iv) {
        throw new HttpError(400, "缺少参数");
      }
      const userData = await wxoauth.getUser(code, encryptedData, iv);
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
        await User.create({
          openid,
          name: nickName,
          gender,
          avatarUrl
        });
      }
      user.token = signToken(user);

      res.json({
        user,
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
      const data = wxoauth.decrypt(encryptedData, session_key, iv);
      res.json(data);
    })
  );

  router.route("/wechat/pay/notify").post(
    handleAsyncErrors(async (req, res) => {
      let data: any = await wepayUtils.fromXML(req.body);
      const returnData = await wxpay.payNotify(data, async parsedData => {
        if (!wxpay.verifySign(parsedData)) {
          throw new Error("签名异常" + parsedData.out_trade_no);
        }
        if (parsedData.result_code === "FAIL") {
          throw new Error("业务逻辑异常" + parsedData.out_trade_no);
        }

        // TODO: 业务流程

        return {
          return_code: "SUCCESS",
          return_msg: "OK"
        };
      });
    })
  );
  return router;
};
