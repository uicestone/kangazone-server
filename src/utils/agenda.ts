import Agenda from "agenda";
import moment from "moment";
import Store from "../models/Store";
import Booking, { BookingStatuses } from "../models/Booking";

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
  const store = await Store.findOne({ _id: storeId });
  await store.authBands(bandIds, true);
  done();
});

agenda.define("cancel expired pending bookings", async (job, done) => {
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

agenda.define("finish overtime served bookings", async (job, done) => {
  const bookings = await Booking.find({
    status: BookingStatuses.IN_SERVICE,
    date: moment().format("YYYY-MM-DD")
  });
  for (const booking of bookings) {
    if (
      moment()
        .subtract(`${booking.hours + 1} hours`)
        .format("HH:mm:ss") > booking.checkInAt
    ) {
      await booking.finish();
    }
  }

  done();
});

agenda.on("ready", () => {
  agenda.every("1 hour", "cancel expired pending bookings");
  // agenda.every("1 day", "cancel expired booked bookings");
  agenda.every("5 minutes", "finish overtime served bookings");
});

export default agenda;
