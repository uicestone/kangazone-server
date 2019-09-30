import { parseData } from "wiegand-control";
import Booking, { BookingStatuses } from "../models/Booking";
import Store, {
  storeGateControllers,
  IStore,
  storeServerSockets
} from "../models/Store";
import { sleep } from "../utils/helper";
import { Socket } from "net";
import WgCtl from "wiegand-control";
import User from "../models/User";

export default function handleSocketData(
  socket: Socket,
  client: { store: IStore }
) {
  return async (data: Buffer | string) => {
    if (typeof data === "string") {
      data = Buffer.from(data, "utf-8");
    }

    // handle text message
    if (data.slice(-2).toString() === "\r\n") {
      const textMessage = data.slice(0, -2).toString("utf8");
      console.log("[SOK] Got text message:", textMessage);
      const matchStoreId = textMessage.match(/^store ([\d\w]+?)$/);
      if (matchStoreId) {
        try {
          client.store = await Store.findOne({ _id: matchStoreId[1] });
          if (!client.store) {
            throw new Error("store_not_found");
          }
          console.log(`[SOK] Identified store ${client.store.name}.`);
          storeServerSockets[client.store.id] = socket;
          client.store.ip = socket.remoteAddress;
          await client.store.save();

          const serials = Array.from(
            client.store.gates.entry
              .concat(client.store.gates.exit)
              .reduce((acc, cur) => {
                acc.add(cur[0]);
                return acc;
              }, new Set())
          ) as number[];

          const controllers = serials.map(serial => new WgCtl(socket, serial));
          controllers.forEach(c => {
            storeGateControllers[c.serial] = c;
            // c.getServerAddress();
          });
        } catch (err) {
          console.error(
            `[SOK] Fail to identity store, id: ${matchStoreId[1]}.`
          );
        }
      }
      return;
    }

    const message = parseData(data);

    if (message.funcName.match(/^Unknown/)) {
      console.log("[SOK] Unknown function name.");
      return socket.destroy(new Error("unknown_function"));
    }

    console.log("[SOK] Got message:", JSON.stringify(message));

    if (message.funcName === "Status" && message.type === "card") {
      const bookings = await Booking.find({
        bandIds8: +message.cardNo
      });

      const bookedBookings = bookings.filter(
        b => b.status === BookingStatuses.BOOKED
      );

      if (bookedBookings.length > 1) {
        console.error(
          `[SOK] Card No. ${message.cardNo} matched more than one booked bookings.`
        );
      }

      bookedBookings.forEach(booking => booking.checkIn());

      const matchedUsers = await User.find({ passNo8: +message.cardNo });

      if (matchedUsers.length > 1) {
        console.error(
          `[SOK] Card No. ${message.cardNo} matched more than one user.`
        );
      }

      matchedUsers.forEach(user => {
        console.log(
          `[SOK] Card No. ${message.cardNo} matched user ${user.name}, user id: ${user.id}`
        );
      });

      if (process.env.GATE_AUTO_AUTH) {
        const store = await Store.findOne();
        for (const g of store.gates.entry.concat(store.gates.exit)) {
          await sleep(200);
          storeGateControllers[g[0]].setAuth(message.cardNo);
        }
      }
    }
  };
}
