declare module "onvif" {
  import { EventEmitter } from "node:events";

  export class Cam extends EventEmitter {
    constructor(
      options: {
        hostname: string;
        port?: number;
        username?: string;
        password?: string;
        timeout?: number;
        preserveAddress?: boolean;
        autoconnect?: boolean;
      },
      callback: (this: Cam, error?: Error) => void,
    );

    getSystemDateAndTime(callback: (this: Cam, error?: Error) => void): void;
    getCapabilities(callback: (this: Cam, error?: Error) => void): void;
  }
}
