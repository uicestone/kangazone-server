import moment from "moment";
import { Socket } from "net";
import { Server as SocketIoServer } from "socket.io";
import handleSocketData from "./handleSocketData";
import { IStore, storeServerSockets } from "../models/Store";

export default function handleCreateServer(io: SocketIoServer) {
  return async (socket: Socket) => {
    const client: { store: IStore } = { store: null };
    console.log(
      `[SYS] Socket connect from: ${socket.remoteAddress}:${socket.remotePort}.`
    );
    const heartBeatInterval = setInterval(() => {
      socket.write(`PONG. Server time is ${moment().format("HH:mm:ss")}.`);
    }, 300000);

    socket.setKeepAlive(true);
    socket.setTimeout(10000);

    // When receive socket data.
    socket.on("data", handleSocketData(socket, client));

    // When socket send data complete.
    socket.on("close", async function() {
      clearInterval(heartBeatInterval);
      if (client.store) {
        storeServerSockets[client.store.id] = null;
      }
      console.log(
        `[SYS] Socket disconnect from ${socket.remoteAddress}:${socket.remotePort}`
      );
    });

    socket.on("error", async function(err) {
      console.error(`[DEBUG] Socket error:`, err.message);
    });

    // When socket timeout.
    socket.on("timeout", function() {
      if (client.store) return;
      console.log(
        `[SOK] Daemon not declaring store identity, timeout ${socket.remoteAddress}:${socket.remotePort}.`
      );
      socket.destroy(new Error("store_unidentified"));
    });
  };
}
