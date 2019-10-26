import Agenda from "agenda";
import moment from "moment";
import Store, { storeGateControllers } from "../models/Store";
import Booking, { BookingStatuses } from "../models/Booking";
import User from "../models/User";
import { icCode10To8, sleep } from "./helper";

const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URL,
    options: {
      useNewUrlParser: true
    }
  }
});

agenda.define("revoke band auth", async (job, done) => {
  const { bandIds, storeId } = job.attrs.data;
  console.log(`[CRO] Start revoke band auth ${JSON.stringify(bandIds)}.`);
  const store = await Store.findOne({ _id: storeId });
  await store.authBands(bandIds, true);
  done();
});

agenda.define("cancel expired pending bookings", async (job, done) => {
  console.log(`[CRO] Start cancel expired pending bookings.`);
  const bookings = await Booking.find({
    status: BookingStatuses.PENDING,
    createdAt: {
      $lt: moment()
        .subtract(1, "day")
        .toDate()
    }
  });

  for (const booking of bookings) {
    await booking.cancel();
  }

  done();
});

agenda.define("cancel expired booked bookings", async (job, done) => {
  console.log(`[CRO] Start cancel expired booked bookings.`);
  const bookings = await Booking.find({
    status: BookingStatuses.BOOKED,
    date: {
      $lt: moment().format("YYYY-MM-DD")
    }
  });
  for (const booking of bookings) {
    await booking.cancel();
  }

  done();
});

agenda.define("finish expired booked bookings", async (job, done) => {
  console.log(`[CRO] Start finish expired booked bookings.`);
  const bookings = await Booking.find({
    status: BookingStatuses.BOOKED,
    date: {
      $lt: moment().format("YYYY-MM-DD")
    }
  });
  for (const booking of bookings) {
    await booking.finish();
  }

  done();
});

agenda.define("finish overtime served bookings", async (job, done) => {
  console.log(`[CRO] Start finish overtime served bookings.`);
  const bookings = await Booking.find({
    status: BookingStatuses.IN_SERVICE,
    date: { $lte: moment().format("YYYY-MM-DD") }
  });
  for (const booking of bookings) {
    if (
      moment(`${booking.date} ${booking.checkInAt}`)
        .add(booking.hours + 1, "hours")
        .toDate() < new Date()
    ) {
      await booking.finish();
    }
  }

  done();
});

agenda.define("reset auth", async (job, done) => {
  console.log(`[CRO] Start reset gate card auth for staff users.`);
  const stores = await Store.find();
  for (const store of stores) {
    const serials = Array.from(
      store.gates.reduce((serials, gate) => {
        serials.add(gate.serial);
        return serials;
      }, new Set())
    ) as number[];
    for (const serial of serials) {
      const ctl = storeGateControllers[serial];
      if (!ctl) {
        console.error(`[CRO] Controller ${serial} is not connected to server.`);
        continue;
      }
      ctl.clearAuth();
      await sleep(500);
      const users = await User.find({ passNo8: { $exists: true } }); // TODO add store to condition
      for (const user of users) {
        ctl.setAuth(user.passNo8);
        await sleep(500);
      }
    }
  }
  done();
});

agenda.define("generate 8 digit card no", async (job, done) => {
  const users = await User.find({ passNo: { $exists: true } });
  const promisesUsers = users.map(user => {
    if (user.passNo8) return Promise.resolve(user);
    user.passNo8 = icCode10To8(user.passNo);
    return user.save();
  });
  await Promise.all(promisesUsers);

  const bookings = await Booking.find({
    bandIds: { $exists: true },
    bandIds8: { $exists: false }
  });
  const promisesBookings = bookings.map(booking => {
    if (booking.bandIds8 && booking.bandIds8.length)
      return Promise.resolve(booking);
    booking.bandIds8 = booking.bandIds.map(id => icCode10To8(id));
    return booking.save();
  });
  await Promise.all(promisesBookings);

  done();
});

agenda.on("ready", () => {
  agenda.every("1 hour", "cancel expired pending bookings");
  agenda.every("1 hour", "finish expired booked bookings");
  // agenda.every("1 day", "cancel expired booked bookings");
  agenda.every("5 minutes", "finish overtime served bookings");
  // agenda.now("generate 8 digit card no");
  agenda.every("0 1 * * *", "reset auth");
});

export default agenda;
