import { Cam } from "onvif";
import { config, type CameraConfig } from "./config.js";
import { log, logError } from "./logger.js";

type MotionHandler = (motion: boolean) => void;

function findMotionValue(value: unknown): boolean | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMotionValue(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const attributes =
    record.$ && typeof record.$ === "object"
      ? (record.$ as Record<string, unknown>)
      : {};
  const name = String(record.Name ?? record.name ?? attributes.Name ?? attributes.name ?? "");
  const raw = record.Value ?? record.value ?? attributes.Value ?? attributes.value;
  if (/^(IsMotion|State)$/i.test(name) && raw !== undefined) {
    const normalized = String(raw).toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  for (const nested of Object.values(record)) {
    const found = findMotionValue(nested);
    if (found !== null) return found;
  }
  return null;
}

export class CameraEvents {
  private camera: Cam | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly settings: CameraConfig,
    private readonly onMotion: MotionHandler,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.camera?.removeAllListeners();
    this.camera = null;
  }

  private connect(): void {
    if (this.stopped) return;
    log(`${this.settings.name}: connecting to ${this.settings.host}:${this.settings.port}`);

    const cam = new Cam(
      {
        hostname: this.settings.host,
        port: this.settings.port,
        username: this.settings.username,
        password: this.settings.password,
        timeout: 10_000,
        preserveAddress: true,
        // Imou A32EP-L returns malformed GetProfiles XML. Only initialize
        // device time and capabilities because event pulling does not need a profile.
        autoconnect: false,
      },
      () => undefined,
    );

    cam.getSystemDateAndTime((timeError?: Error) => {
      if (this.stopped) return;
      if (timeError) {
        logError(`${this.settings.name}: camera time query failed`, timeError);
        this.scheduleReconnect();
        return;
      }

      cam.getCapabilities((error?: Error) => {
        if (this.stopped) return;
        if (error) {
          logError(`${this.settings.name}: camera connection failed`, error);
          this.scheduleReconnect();
          return;
        }

        this.camera = cam;
        log(`${this.settings.name}: connected; waiting for ONVIF events`);
        cam.on("event", (message: unknown) => {
          const motion = findMotionValue(message);
          if (motion !== null) this.onMotion(motion);
        });
        cam.on("error", (eventError: unknown) => {
          logError(`${this.settings.name}: camera event connection error`, eventError);
          cam.removeAllListeners();
          if (this.camera === cam) this.camera = null;
          this.scheduleReconnect();
        });
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delayMs = config.reconnectSeconds * 1000;
    log(`${this.settings.name}: reconnect scheduled in ${config.reconnectSeconds}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }
}
