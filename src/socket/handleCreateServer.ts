import handleSocketData from "./handleSocketData";
import WgCtl from "wiegand-control";

export default function handleCreateServer(io) {
  return async function socket(socket) {
    console.log(
      `[SYS] Socket connect from: ${socket.remoteAddress}:${socket.remotePort}.`
    );

    const serials = [223236925, 225012725];
    const controllers = serials.map(serial => new WgCtl(socket, serial));
    await Promise.all(controllers.map(ctl => ctl.detected));
    // controllers.map(c => c.setServerAddress("192.168.3.2", 6000));
    controllers.map(c => c.openDoor(1));

    // socket.setTimeout(60000);

    // When receive socket data.
    socket.on("data", handleSocketData);

    // When socket send data complete.
    socket.on("close", async function() {
      console.log(
        `[SYS] Socket disconnect from ${socket.remoteAddress}:${
          socket.remotePort
        }`
      );
    });

    socket.on("error", async function(err) {
      console.error(`[DEBUG] Socket error:`, err.message);
    });

    // When socket timeout.
    socket.on("timeout", function() {
      // console.log(`[SYS] Socket request time out from ${socket.remoteAddress}:${socket.remotePort}.`);
    });
  };
}
