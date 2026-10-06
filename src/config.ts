import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

export type CameraConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  rtspUrl: string;
  name: string;
};

function cameraConfig(number: 1 | 2): CameraConfig {
  const prefix = `CAMERA_${number}_`;
  const host = required(`${prefix}HOST`);
  const rtspUrl = required(`${prefix}RTSP_URL`);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rtspUrl);
  } catch {
    throw new Error(`${prefix}RTSP_URL must be a valid RTSP URL`);
  }
  if (parsedUrl.protocol !== "rtsp:" || parsedUrl.hostname !== host) {
    throw new Error(`${prefix}RTSP_URL must use rtsp:// and match ${prefix}HOST`);
  }

  return {
    host,
    port: positiveNumber(`${prefix}PORT`, 80),
    username: required(`${prefix}USERNAME`),
    password: required(`${prefix}PASSWORD`),
    rtspUrl,
    name: required(`${prefix}NAME`),
  };
}

export const config = {
  cameras: [cameraConfig(1), cameraConfig(2)],
  reconnectSeconds: positiveNumber("CAMERA_RECONNECT_SECONDS", 10),
  snapshotTimeoutSeconds: positiveNumber("SNAPSHOT_TIMEOUT_SECONDS", 20),
  telegram: {
    token: required("TELEGRAM_BOT_TOKEN"),
    chatId: required("TELEGRAM_CHAT_ID"),
  },
} as const;
