import HttpError from "../utils/HttpError";
import { getTokenData } from "../utils/helper";
import { Types } from "mongoose";

export default async function(req, res, next) {
  const token = req.get("authorization") || req.query.token;

  if (token) {
    try {
      const tokenData = getTokenData(token);
      req.user = {
        _id: Types.ObjectId(tokenData.userId),
        role: tokenData.userRole
      };
    } catch (err) {
      return next(new HttpError(401, "无效登录，请重新登录"));
    }
  } else {
    req.user = { _id: null, role: "guest" };
  }

  next();
}
