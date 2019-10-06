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

const { GATE_AUTO_AUTH } = process.env;

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
      const matchStoreData = textMessage.match(/^store (.+?)$/);
      if (matchStoreData) {
        const storeData = JSON.parse(matchStoreData[1]) as {
          storeId: string;
          serials: number[];
        };

        try {
          client.store = await Store.findOne({ _id: storeData.storeId });
          if (!client.store) {
            throw new Error("store_not_found");
          }
          console.log(
            `[SOK] Identified store ${
              client.store.name
            } with controllers ${storeData.serials.join(",")}.`
          );
          storeServerSockets[client.store.id] = socket;
          client.store.ip = socket.remoteAddress;
          await client.store.save();

          const serials = Array.from(
            client.store.gates.reduce((acc, cur) => {
              acc.add(cur.serial);
              return acc;
            }, new Set())
          ) as number[];

          const lostSerials = serials.filter(
            s => !storeData.serials.includes(s)
          );

          if (lostSerials.length) {
            console.error(
              `[SOK] Controller ${lostSerials.join(
                ", "
              )} is not detected by local server at ${client.store.name}.`
            );
          }

          const controllers = serials.map(serial => new WgCtl(socket, serial));
          controllers.forEach(c => {
            storeGateControllers[c.serial] = c;
          });
        } catch (err) {
          console.error(
            `[SOK] Fail to identity store, id: ${storeData.storeId}.`
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
      const statusMessage = message as {
        serial: number;
        funcName: "Status";
        index: number;
        type: "card";
        allow: boolean;
        door: number;
        inOut: "in" | "out";
        cardNo: number;
        time: Date;
      };

      const store = await Store.findOne({
        "gates.serial": statusMessage.serial
      });

      if (!store) return;

      const gate = store.gates.find(
        g =>
          g.serial === statusMessage.serial && g.number === statusMessage.door
      );

      if (!gate) {
        console.error(
          `[SOK] Unmatched gate, status message:`,
          JSON.stringify(statusMessage)
        );
        return;
      }

      const bookings = await Booking.find({ bandIds8: statusMessage.cardNo });

      for (const booking of bookings) {
        if (
          [
            BookingStatuses.CANCELED,
            BookingStatuses.PENDING,
            BookingStatuses.FINISHED
          ].includes(booking.status)
        ) {
          continue;
        }
        // booking bandId is active, can be logged

        if (!booking.passLogs) {
          booking.passLogs = [];
        }

        booking.passLogs.push({
          time: new Date(),
          gate: gate.name,
          entry: gate.entry,
          allow: statusMessage.allow
        });

        console[statusMessage.allow ? "log" : "error"](
          `[SOK] Booking ${booking.id} band ${statusMessage.cardNo} ${
            statusMessage.allow ? "passed" : "blocked"
          } ${gate.name}.`
        );

        await booking.save();
      }

      const bookedBookings = bookings.filter(
        b => b.status === BookingStatuses.BOOKED
      );

      if (bookedBookings.length > 1) {
        console.error(
          `[SOK] Card No. ${statusMessage.cardNo} matched more than one booked bookings.`
        );
      }

      bookedBookings.forEach(booking => booking.checkIn());

      const matchedUsers = await User.find({ passNo8: statusMessage.cardNo });

      if (matchedUsers.length > 1) {
        console.error(
          `[SOK] Card No. ${statusMessage.cardNo} matched more than one user.`
        );
      }

      for (const user of matchedUsers) {
        if (!user.passLogs) {
          user.passLogs = [];
        }
        user.passLogs.push({
          time: new Date(),
          gate: gate.name,
          entry: gate.entry,
          allow: statusMessage.allow
        });
        await user.save();
        console[statusMessage.allow ? "log" : "error"](
          `[SOK] User ${user.name}, id ${user.id}, band ${
            statusMessage.cardNo
          } ${statusMessage.allow ? "passed" : "blocked"} ${gate.name}.`
        );
      }

      if (GATE_AUTO_AUTH) {
        const store = await Store.findOne();
        for (const g of store.gates) {
          await sleep(200);
          storeGateControllers[g.serial].setAuth(message.cardNo);
        }
      }
    }
  };
}
