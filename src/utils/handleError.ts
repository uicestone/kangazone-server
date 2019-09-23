import { MongoError } from "mongodb";
import HttpError from "./HttpError";

export default (err: Error, req, res, next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
  } else if (err instanceof MongoError && err.code === 11000) {
    const match = err.message.match(
      /collection: .*?\.(.*?) index: (.*?) dup key: { : (.*?) }$/
    );
    let message = "";
    if (match) {
      message = `Duplicated "${match[1]}" "${match[2].replace(
        /_\d+_?/g,
        ", "
      )}": ${match[3]}`;
    } else {
      message = `Duplicated key.`;
    }
    res.status(409).json({ message });
  } else if (err.name === "ValidationError") {
    res.status(400).json({
      // @ts-ignore
      message: Object.values(err.errors)
        // @ts-ignore
        .map(e => e.message)
        .join("\n")
    });
  } else {
    console.error(`${err.name}: ${err.message}`, "\n[Stack]", err.stack);
    res.status(500).send("Internal server error.");
  }
};
