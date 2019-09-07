import Agenda from "agenda";
import Store from "../models/Store";

const agenda = new Agenda({ db: { address: process.env.MONGODB_URL } });

agenda.define("revoke band auth", async (job, done) => {
  const { bandIds, storeId } = job.attrs.data;
  const store = await Store.findOne({ _id: storeId });
  store.authBands(bandIds, true);
  done();
});

export default agenda;
