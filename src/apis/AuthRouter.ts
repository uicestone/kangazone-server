// import bluebird from "bluebird";
import crypto from "crypto";
// import { createClient as redisClient } from "redis";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import User, { IUser } from "../models/User";
import HttpError from "../utils/HttpError";

// bluebird.promisifyAll(redisClient);

export default router => {
  router.route("/auth/login").post(
    handleAsyncErrors(async (req, res) => {
      if (!req.body.email) {
        throw new HttpError(400, "请输入用户名");
      }

      if (!req.body.password) {
        throw new HttpError(400, "请输入密码");
      }

      const user = await User.findOne({ email: req.body.email }).select([
        "+password",
        "+token"
      ]);

      if (!user) {
        throw new HttpError(401, "用户不存在");
      }

      if (user.password !== req.body.password) {
        throw new HttpError(403, "密码错误");
      }

      if (user.token) {
        user.password = undefined;
        res.json(user);
      } else {
        await user.save();
        user.password = undefined;
        res.json(user);
      }

      let authLog = `[USR] 用户 ${user.name} 成功登录`;

      ["version", "device-serial", "system", "device-model"].forEach(field => {
        if (req.get(`x-client-${field}`)) {
          authLog += ` ${req.get(`x-client-${field}`)}`;
        }
      });

      console.log(authLog);
    })
  );

  router.route("/auth/user").get(
    handleAsyncErrors(async (req, res) => {
      const user = req.user;

      let authLog = `[USR] 用户 ${user.name} 获取登录信息`;

      ["version", "device-serial", "system", "device-model"].forEach(field => {
        if (req.get(`x-client-${field}`)) {
          authLog += ` ${req.get(`x-client-${field}`)}`;
        }
      });

      console.log(authLog);

      res.json(user);
    })
  );

  return router;
};
