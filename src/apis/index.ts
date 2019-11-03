import cors from "cors";
import methodOverride from "method-override";
import authenticate from "../middlewares/authenticate";
import castEmbedded from "../middlewares/castEmbedded";
import AuthRouter from "./AuthRouter";
import BookingRouter from "./BookingRouter";
import CodeRouter from "./CodeRouter";
import ConfigRouter from "./ConfigRouter";
import PaymentRouter from "./PaymentRouter";
import StatsRouter from "./StatsRouter";
import StoreRouter from "./StoreRouter";
import UserRouter from "./UserRouter";
import WechatRouter from "./WechatRouter";

export default (app, router) => {
  // register routes
  [
    AuthRouter,
    BookingRouter,
    CodeRouter,
    ConfigRouter,
    PaymentRouter,
    StatsRouter,
    StoreRouter,
    UserRouter,
    WechatRouter
  ].forEach(R => {
    router = R(router);
  });

  router.get("/", (req, res) => {
    res.send("Welcome!");
  });

  app.use(
    "/api",
    cors({
      exposedHeaders: [
        "content-range",
        "accept-range",
        "items-total",
        "items-start",
        "items-end",
        "total-amount",
        "total-credit"
      ]
    }),
    methodOverride(),
    authenticate,
    castEmbedded,
    router
  );
};
