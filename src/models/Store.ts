import mongoose, { Schema } from "mongoose";
import WgCtl from "wiegand-control";
import updateTimes from "./plugins/updateTimes";

export const storeGateControllers: { [serial: string]: WgCtl } = {};

const Store = new Schema({
  name: String,
  address: String,
  phone: String,
  partyRooms: Number,
  gates: {
    entry: { type: [[Number]] },
    exit: { type: [[Number]] },
    localServer: {
      ip: String
    }
  }
});

Store.index({ name: 1 }, { unique: true });

Store.plugin(updateTimes);

Store.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

Store.methods.authBands = async function(bandIds: string[], revoke = false) {
  const store = this as IStore;
  for (const g of store.gates.entry) {
    for (const bandId of bandIds) {
      try {
        await new Promise(resolve => {
          setTimeout(() => {
            revoke
              ? storeGateControllers[g[0]].removeAuth(+bandId)
              : storeGateControllers[g[0]].setAuth(+bandId);
            resolve();
          }, 200);
        });
      } catch (err) {
        throw new Error("auth_band_fail");
      }
    }
  }
};

export interface IStore extends mongoose.Document {
  name: string;
  address: string;
  phone: string;
  partyRooms: number;
  gates: {
    entry: number[];
    exit: number[];
  };
  authBands: (bandIds: string[], revoke?: boolean) => Promise<boolean>;
}

export default mongoose.model<IStore>("Store", Store);
