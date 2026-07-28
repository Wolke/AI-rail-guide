import "dotenv/config";
import { createRealtimeApp } from "./realtimeServer";

const port = Number(process.env.RAILTALK_SERVER_PORT ?? 8787);
const host = "127.0.0.1";

createRealtimeApp().listen(port, host, () => {
  process.stdout.write(`RailTalk Realtime server: http://${host}:${port}\n`);
});
