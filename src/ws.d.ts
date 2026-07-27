declare module "ws" {
  import { EventEmitter } from "node:events";

  interface WebSocketOptions {
    headers?: Record<string, string>;
  }

  class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(url: string, options?: WebSocketOptions);
    send(data: string): void;
    close(): void;
    once(event: "open", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    on(event: "message", listener: (data: { toString(): string }) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
  }

  export default WebSocket;
}
