import mongoose, { Schema } from "mongoose";
import updateTimes from "./plugins/updateTimes";
import initConfig from "../utils/initConfig";

const configSchema = new Schema({}, { strict: false });

configSchema.plugin(updateTimes);

configSchema.set("toJSON", {
  getters: true,
  transform: function(doc, ret, options) {
    delete ret._id;
    delete ret.__v;
  }
});

configSchema.statics.get = async function(key, defaults) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaults;
};

export default mongoose.model("Config", configSchema);

initConfig();
