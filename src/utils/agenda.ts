import Agenda from "agenda";
import moment from "moment";
import Store from "../models/Store";
import Booking from "../models/Booking";

const agenda = new Agenda({ db: { address: process.env.MONGODB_URL } });

agenda.define("revoke band auth", async (job, done) => {
  const { bandIds, storeId } = job.attrs.data;
  const store = await Store.findOne({ _id: storeId });
  await store.authBands(bandIds, true);
  done();
});

agenda.define("cancel expired pending bookings", async (job, done) => {
  const bookings = await Booking.find({
    status: "PENDING",
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
    status: "BOOKED",
    date: {
      $lt: moment().format("YYYY-MM-DD")
    }
  });
  for (const booking of bookings) {
    await booking.cancel();
  }

  done();
});

agenda.on("ready", () => {
  agenda.every("1 hour", "cancel expired pending bookings");
  agenda.every("1 day", "cancel expired booked bookings");
});

export default agenda;
