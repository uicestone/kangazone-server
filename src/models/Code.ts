import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";

const Code = new Schema({
  num: String,
  type: { type: String, enum: ["play"], default: "play" },
  hours: Number,
  expiresAt: { type: Date, required: true }
});

Code.plugin(updateTimes);

Code.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

export interface ICode extends mongoose.Document {
  num?: string;
  hours?: number;
  expiresAt: Date;
}

export default mongoose.model("Code", Code);
