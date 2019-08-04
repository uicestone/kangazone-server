import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Code from "../models/Code";

export default router => {
  // Code CURD
  router
    .route("/code")

    // get all the codes
    .get(
      paginatify,
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const { limit, skip } = req.pagination;
        const query = Code.find().populate("customer");
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
    .route("/code/:codeId")

    .all(
      handleAsyncErrors(async (req, res, next) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const code = await Code.findById(req.params.codeId);
        if (!code) {
          throw new HttpError(404, `Code not found: ${req.params.codeId}`);
        }
        req.item = code;
        next();
      })
    )

    // get the code with that id
    .get(
      handleAsyncErrors(async (req, res) => {
        const code = req.item;
        res.json(code);
      })
    )

    .put(
      handleAsyncErrors(async (req, res) => {
        const code = req.item;
        code.set(req.body);
        await code.save();
        // sendConfirmEmail(code);
        res.json(code);
      })
    )

    // delete the code with this id
    .delete(
      handleAsyncErrors(async (req, res) => {
        const code = req.item;
        await code.remove();
        res.end();
      })
    );

  return router;
};
