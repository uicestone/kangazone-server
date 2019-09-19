import handleSocketData from "./handleSocketData";
import WgCtl from "wiegand-control";
import Store, {
  storeGateControllers,
  storeServerSockets
} from "../models/Store";
import { Socket } from "net";

export default function handleCreateServer(io) {
  return async function socket(socket: Socket) {
    console.log(
      `[SYS] Socket connect from: ${socket.remoteAddress}:${socket.remotePort}.`
    );

    // socket.setTimeout(60000);

    // When receive socket data.
    socket.on("data", handleSocketData);

    // When socket send data complete.
    socket.on("close", async function() {
      console.log(
        `[SYS] Socket disconnect from ${socket.remoteAddress}:${socket.remotePort}`
      );
    });

    socket.on("error", async function(err) {
      console.error(`[DEBUG] Socket error:`, err.message);
    });

    // When socket timeout.
    socket.on("timeout", function() {
      // console.log(`[SYS] Socket request time out from ${socket.remoteAddress}:${socket.remotePort}.`);
    });

    const stores = await Store.find();
    storeServerSockets[stores[0].id] = socket;
    stores[0].ip = socket.remoteAddress;
    await stores[0].save();

    const serials = Array.from(
      stores.reduce((acc, cur) => {
        cur.gates.entry.forEach(g => {
          acc.add(g[0]);
        });
        cur.gates.exit.forEach(g => {
          acc.add(g[0]);
        });
        return acc;
      }, new Set())
    ) as number[];

    const controllers = serials.map(serial => new WgCtl(socket, serial));
    await new Promise(resolve => {
      setTimeout(resolve, 1000);
    });
    await Promise.all(controllers.map(ctl => ctl.detected));
    // storeGateControllers["TEST"] = { test: true };
    controllers.map(c => {
      // c.setServerAddress("172.16.3.253", 6000);
      storeGateControllers[c.serial] = c;
    });
  };
}
