import { parseData } from "wiegand-control";
import Booking, { BookingStatuses } from "../models/Booking";

export default async function handleSocketData(data) {
  // handle text message
  if (data.slice(-2).toString() === "\r\n") {
    data = data.slice(0, -2);
    console.log("[SYS] Socket got text message:", data.toString("utf8"));
    return;
  }

  const message = parseData(data);
  console.log("[SYS] Socket got message:", message);

  if (message.funcName === "Status") {
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
  }
}
