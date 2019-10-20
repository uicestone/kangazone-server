import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import Config, { config } from "../models/Config";
import HttpError from "../utils/HttpError";
import reduceConfig from "../utils/reduceConfig";
import initConfig from "../utils/initConfig";

export default router => {
  // Config CURD
  router
    .route("/config")

    // create a config
    .post(
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const config = new Config(req.body);
        await config.save();
        res.json(config);
      })
    )

    // get all the configs
    .get(
      paginatify,
      handleAsyncErrors(async (req, res) => {
        const items = await Config.find()
          .sort({ createdAt: -1 })
          .exec();

        res.json(req.query.seperate ? items : reduceConfig(items));
      })
    );

  router
    .route("/config/:key")

    .all(
      handleAsyncErrors(async (req, res, next) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const config = await Config.findOne({
          [req.params.key]: { $exists: true }
        });
        if (!config) {
          throw new HttpError(404, `Config not found: ${req.params.key}`);
        }
        req.item = config;
        next();
      })
    )

    // get the config with that id
    .get(
      handleAsyncErrors(async (req, res) => {
        const config = req.item;
        res.json(config);
      })
    )

    .put(
      handleAsyncErrors(async (req, res) => {
        const config = req.item;
        const value = req.body[req.params.key]
          ? req.body[req.params.key]
          : { [req.params.key]: req.body };
        config.set(value);
        await config.save();
        res.json(config);
      })
    )

    // delete the config with this id
    .delete(
      handleAsyncErrors(async (req, res) => {
        const config = req.item;
        await config.remove();
        res.end();
      })
    );

  router
    .route("/config-init")

    // load or reload config from database
    .post(
      handleAsyncErrors(async (req, res) => {
        initConfig(config);
        res.end();
      })
    );

  return router;
};
