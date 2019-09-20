import mongoose, { Schema } from "mongoose";
import WgCtl from "wiegand-control";
import updateTimes from "./plugins/updateTimes";
import { Socket } from "net";
import { sleep, icCode10To8 } from "../utils/helper";

export const storeGateControllers: { [serial: string]: WgCtl } = {};
export const storeServerSockets: { [storeId: string]: Socket } = {};

const Store = new Schema({
  name: String,
  address: String,
  phone: String,
  partyRooms: Number,
  ip: String,
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

Store.methods.authBands = async function(
  bandIds: string[],
  revoke: boolean = false
) {
  const store = this as IStore;
  for (const g of store.gates.entry) {
    for (const bandId of bandIds) {
      try {
        revoke
          ? storeGateControllers[g[0]].removeAuth(icCode10To8(bandId))
          : storeGateControllers[g[0]].setAuth(icCode10To8(bandId));
        console.log(
          `${revoke ? "Revoke" : "Auth"} ${bandId} (${icCode10To8(
            bandId
          )}) to ${g[0]} (All doors).`
        );
      } catch (err) {
        throw new Error("auth_band_fail");
      }
      await sleep(200);
    }
  }
};

export interface IStore extends mongoose.Document {
  name: string;
  address: string;
  phone: string;
  partyRooms: number;
  ip: string;
  gates: {
    entry: number[];
    exit: number[];
  };
  authBands: (bandIds: string[], revoke?: boolean) => Promise<boolean>;
}

export default mongoose.model<IStore>("Store", Store);
