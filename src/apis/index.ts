import cors from "cors";
import methodOverride from "method-override";
import authenticate from "../middlewares/authenticate";
import castEmbedded from "../middlewares/castEmbedded";
import AuthRouter from "./AuthRouter";
import BookingRouter from "./BookingRouter";
import ConfigRouter from "./ConfigRouter";
import PaymentRouter from "./PaymentRouter";
import StoreRouter from "./StoreRouter";
import UserRouter from "./UserRouter";

export default (app, router) => {
  // register routes
  [
    AuthRouter,
    BookingRouter,
    ConfigRouter,
    PaymentRouter,
    StoreRouter,
    UserRouter
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
        "items-end"
      ]
    }),
    methodOverride(),
    authenticate,
    castEmbedded,
    router
  );
};
