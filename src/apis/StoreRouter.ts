import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Store, { storeGateControllers } from "../models/Store";

export default router => {
  // Store CURD
  router
    .route("/store")

    // create a store
    .post(
      handleAsyncErrors(async (req, res) => {
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        const store = new Store(req.body);
        await store.save();
        res.json(store);
      })
    )

    // get all the stores
    .get(
      paginatify,
      handleAsyncErrors(async (req, res) => {
        const { limit, skip } = req.pagination;
        const query = Store.find();
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
    .route("/store/:storeId")

    .all(
      handleAsyncErrors(async (req, res, next) => {
        const store = await Store.findById(req.params.storeId);
        if (req.user.role !== "admin") {
          throw new HttpError(403);
        }
        if (!store) {
          throw new HttpError(404, `Store not found: ${req.params.storeId}`);
        }
        req.item = store;
        next();
      })
    )

    // get the store with that id
    .get(
      handleAsyncErrors(async (req, res) => {
        const store = req.item;
        res.json(store);
      })
    )

    .put(
      handleAsyncErrors(async (req, res) => {
        const store = req.item;
        store.set(req.body);
        await store.save();
        res.json(store);
      })
    )

    // delete the store with this id
    .delete(
      handleAsyncErrors(async (req, res) => {
        const store = req.item;
        await store.remove();
        res.end();
      })
    );

  router.route("/store/:storeId/auth-bands").post(
    handleAsyncErrors(async (req, res) => {
      const store = await Store.findById(req.params.storeId);
      if (!["admin", "manager"].includes(req.user.role)) {
        throw new HttpError(403);
      }
      if (!store) {
        throw new HttpError(404, `Store not found: ${req.params.storeId}`);
      }

      store.authBands(req.body);

      req.item = store;
    })
  );

  router.route("/store/:storeId/open-all-gates").post(
    handleAsyncErrors(async (req, res) => {
      const store = await Store.findById(req.params.storeId);
      for (const g of store.gates.entry.concat(store.gates.exit).slice(1)) {
        await new Promise(r => {
          setTimeout(() => {
            storeGateControllers[g[0]].openDoor(g[1]);
            r();
          }, 200);
        });
      }
      res.end();
    })
  );

  router.route("/store/open-gate/:serial/:number").post(
    handleAsyncErrors(async (req, res) => {
      storeGateControllers[req.params.serial].openDoor(+req.params.number);
      res.end();
    })
  );

  return router;
};
