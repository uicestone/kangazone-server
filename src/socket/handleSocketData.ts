import { parseData } from "wiegand-control";
import Booking, { BookingStatuses } from "../models/Booking";
import Store, { storeGateControllers } from "../models/Store";
import { sleep } from "../utils/helper";
import { Socket } from "net";

export default function handleSocketData(socket: Socket) {
  return async (data: Buffer | string) => {
    // handle text message
    if (typeof data === "string" || data.slice(-2).toString() === "\r\n") {
      if (!process.env.DEBUG) {
        return socket.destroy();
      }
      if (data.slice(-2).toString() === "\r\n") {
        data = data.slice(0, -2);
      }
      console.log("[SYS] Socket got text message:", data.toString("utf8"));
      return;
    }

    const message = parseData(data);

    if (message.funcName.match(/^Unknown/)) {
      return socket.destroy();
    }

    console.log("[SYS] Socket got message:", message);

    if (message.funcName === "Status" && message.type === "card") {
      const bookings = await Booking.find({
        status: BookingStatuses.BOOKED,
        bandIds: message.cardNo
      });

      if (bookings.length > 1) {
        console.error(
          `[BOK] CardNo ${message.cardNo} matched more than one bookings.`
        );
      }

      bookings.forEach(booking => booking.checkIn());

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
