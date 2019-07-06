import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Payment from "../models/Payment";

export default router => {
  // Payment CURD
  router
    .route("/payment")

    // get all the payments
    .get(
      paginatify,
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const { limit, skip } = req.pagination;
        const query = Payment.find();
        const sort = parseSortString(req.query.order) || {
          createdAt: -1
        };

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
    .route("/payment/:paymentId")

    .all(
      handleAsyncErrors(async (req, res, next) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const payment = await Payment.findById(req.params.paymentId);
        if (!payment) {
          throw new HttpError(
            404,
            `Payment not found: ${req.params.paymentId}`
          );
        }
        req.item = payment;
        next();
      })
    )

    // get the payment with that id
    .get(
      handleAsyncErrors(async (req, res) => {
        const payment = req.item;
        res.json(payment);
      })
    )

    .put(
      handleAsyncErrors(async (req, res) => {
        const payment = req.item;
        payment.set(req.body);
        await payment.save();
        // sendConfirmEmail(payment);
        res.json(payment);
      })
    )

    // delete the payment with this id
    .delete(
      handleAsyncErrors(async (req, res) => {
        const payment = req.item;
        await payment.remove();
        res.end();
      })
    );

  return router;
};
