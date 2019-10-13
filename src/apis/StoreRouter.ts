import paginatify from "../middlewares/paginatify";
import handleAsyncErrors from "../utils/handleAsyncErrors";
import parseSortString from "../utils/parseSortString";
import HttpError from "../utils/HttpError";
import Store, {
  storeGateControllers,
  storeServerSockets
} from "../models/Store";
import WgCtl from "wiegand-control";
import { sleep, icCode10To8 } from "../utils/helper";
import Booking, { liveBookingStatuses } from "../models/Booking";
import moment from "moment";

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
      if (!["admin", "manager"].includes(req.user.role)) {
        throw new HttpError(403);
      }
      const store = await Store.findById(req.params.storeId);
      for (const g of store.gates) {
        await sleep(200);
        storeGateControllers[g.serial].openDoor(g.number);
      }
      res.end();
    })
  );

  router.route("/store/:storeId/re-auth-all-valid-bookings").post(
    handleAsyncErrors(async (req, res) => {
      if (!["admin", "manager"].includes(req.user.role)) {
        throw new HttpError(403);
      }
      const store = await Store.findById(req.params.storeId);
      const bookings = await Booking.find({
        date: moment().format("YYYY-MM-DD"),
        status: { $in: liveBookingStatuses },
        $where: "this.bandIds.length > 0"
      });
      for (let i = 0; i < bookings.length; i++) {
        if (i > 0) {
          await sleep(3000);
        }
        const booking = bookings[i];
        if (!booking.bandIds) {
          continue;
        }
        store.authBands(booking.bandIds);
      }
      res.end();
    })
  );

  router.route("/search-controllers").post(
    handleAsyncErrors(async (req, res) => {
      if (req.user.role !== "admin") {
        throw new HttpError(403);
      }
      const store = await Store.findOne();
      new WgCtl(storeServerSockets[store.id]).search();
      res.end();
    })
  );

  router.route("/set-controller-ip/:serial").put(
    handleAsyncErrors(async (req, res) => {
      if (req.user.role !== "admin") {
        throw new HttpError(403);
      }
      const serial = req.params.serial;
      const store = await Store.findOne();
      new WgCtl(storeServerSockets[store.id], serial).setAddress(
        req.body.ip,
        req.body.subnet || "255.255.255.0",
        req.body.gateway || req.body.ip.replace(/\d+$/, "1")
      );
      res.end();
    })
  );

  router.route("/set-server-ip/:serial").put(
    handleAsyncErrors(async (req, res) => {
      if (req.user.role !== "admin") {
        throw new HttpError(403);
      }
      const serial = req.params.serial;
      const store = await Store.findOne();
      new WgCtl(storeServerSockets[store.id], serial).setServerAddress(
        req.body.ip,
        6000
      );
      res.end();
    })
  );

  router.route("/store/open-gate/:serial/:doorNo").post(
    handleAsyncErrors(async (req, res) => {
      if (req.user.role !== "admin") {
        throw new HttpError(403);
      }
      storeGateControllers[req.params.serial].openDoor(+req.params.doorNo);
      res.end();
    })
  );

  router.route("/store/auth-card/:serial/:doorNo/:cardNo").post(
    handleAsyncErrors(async (req, res) => {
      if (req.user.role !== "admin") {
        throw new HttpError(403);
      }
      const cardNo =
        req.params.cardNo.length === 10
          ? icCode10To8(req.params.cardNo)
          : +req.params.cardNo;
      storeGateControllers[req.params.serial].setAuth(
        cardNo,
        +req.params.doorNo
      );
      res.end();
    })
  );

  router.route("/store/revoke-card/:serial/:cardNo").post(
    handleAsyncErrors(async (req, res) => {
      if (req.user.role !== "admin") {
        throw new HttpError(403);
      }
      const cardNo =
        req.params.cardNo.length === 10
          ? icCode10To8(req.params.cardNo)
          : +req.params.cardNo;
      storeGateControllers[req.params.serial].removeAuth(cardNo);
      res.end();
    })
  );

  router.route("/store/clear-card/:serial").post(
    handleAsyncErrors(async (req, res) => {
      if (req.user.role !== "admin") {
        throw new HttpError(403);
      }
      storeGateControllers[req.params.serial].clearAuth();
      res.end();
    })
  );

  return router;
};
