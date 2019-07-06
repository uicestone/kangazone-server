import User from "../models/User";
import HttpError from "../utils/HttpError";
import { getTokenData } from "../utils/helper";

export default async function(req, res, next) {
  if (
    ["^/api/$", "^/api/auth/login", "^/api/config", "^/api/wechat/*"].some(p =>
      req._parsedUrl.pathname.match(p)
    )
  ) {
    next();
    return;
  }

  const token = req.get("authorization") || req.query.token;
  if (!token) {
    next(new HttpError(401, "无效登录，请重新登录"));
  }
  const user = getTokenData(token);

  if (!user) {
    next(new HttpError(401, "无效登录，请重新登录"));
  }

  req.user = user;
  next();
}
