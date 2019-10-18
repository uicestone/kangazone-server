import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import SocketIo from "socket.io";
import http from "http";
import { createServer } from "net";
import ensureEnv from "./utils/ensureEnv";

ensureEnv();

import handleError from "./utils/handleError";
import handleCreateServer from "./socket/handleCreateServer";
import applyRoutes from "./apis";
import agenda from "./utils/agenda";
import { config } from "./models/Config";
import initConfig from "./utils/initConfig";

const app = express();
const router = express.Router();
const httpServer = http.createServer(app);
const io = SocketIo(httpServer);
const socketServer = createServer(handleCreateServer(io));

const mongooseUrl: string = process.env.MONGODB_URL || process.exit();
const portHttp: string = process.env.PORT_HTTP || process.exit();
const portSocket: string = process.env.PORT_SOCKET || process.exit();

console.log(`[SYS] System time is ${new Date()}`);

mongoose.connect(mongooseUrl, {
  useNewUrlParser: true,
  useFindAndModify: false
});
mongoose.set("useCreateIndex", true);
mongoose.Promise = global.Promise;

app.use(bodyParser.json({ limit: "4mb" }));
app.use(bodyParser.raw({ type: "text/xml" }));

app.set("trust proxy", "loopback");
applyRoutes(app, router);

app.use(handleError);

httpServer.listen(portHttp, () => {
  console.log(`[SYS] HTTP server listening port: ${portHttp}.`);
});

socketServer.listen(portSocket, () => {
  console.log(`[SYS] Socket server listening port: ${portSocket}.`);
});

(async () => {
  await initConfig(config);
})();

agenda.start();
