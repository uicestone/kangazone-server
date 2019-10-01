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
    type: [{ entry: Boolean, serial: Number, number: Number, name: String }]
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
  // control auth by controller, not door, so collect controller serials
  const serials = Array.from(
    store.gates.reduce((acc, cur) => {
      acc.add(cur.serial);
      return acc;
    }, new Set())
  ) as number[];

  for (const serial of serials) {
    for (const bandId of bandIds) {
      try {
        revoke
          ? storeGateControllers[serial].removeAuth(icCode10To8(bandId))
          : storeGateControllers[serial].setAuth(icCode10To8(bandId));
        console.log(
          `[STR] ${revoke ? "Revoke" : "Auth"} ${bandId} (${icCode10To8(
            bandId
          )}) to ${serial} (All doors).`
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
  gates: { entry: boolean; serial: number; number: number; name?: "" }[];
  authBands: (bandIds: string[], revoke?: boolean) => Promise<boolean>;
}

export default mongoose.model<IStore>("Store", Store);
