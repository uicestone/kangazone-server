import { parseData } from "../utils/wiegand-control/utils";

export default function handleSocketData(data) {
  // handle text message
  if (data.slice(-2).toString() === "\r\n") {
    data = data.slice(0, -2);
    console.log("[SYS] Socket got message:", data.toString("utf8"));
    return;
  }

  console.log("[SYS] Socket got message:", parseData(data));
}
