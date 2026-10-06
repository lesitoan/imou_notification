import "dotenv/config";
import path from "node:path";

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

export const config = {
  camera: {
    host: process.env.CAMERA_HOST?.trim() || "192.168.1.2",
    port: positiveNumber("CAMERA_PORT", 80),
    username: required("CAMERA_USERNAME"),
    password: required("CAMERA_PASSWORD"),
    rtspUrl: required("CAMERA_RTSP_URL"),
    name: process.env.CAMERA_NAME?.trim() || "Phòng",
    reconnectSeconds: positiveNumber("CAMERA_RECONNECT_SECONDS", 10),
  },
  recording: {
    path: path.resolve(process.env.RECORDING_PATH?.trim() || "./recordings"),
    snapshotPath: path.resolve(process.env.SNAPSHOT_PATH?.trim() || "./snapshots"),
    postDelaySeconds: positiveNumber("RECORDING_POST_DELAY_SECONDS", 10),
  },
  retention: {
    days: positiveNumber("RETENTION_DAYS", 3),
    cleanupIntervalMinutes: positiveNumber("CLEANUP_INTERVAL_MINUTES", 60),
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
    chatId: process.env.TELEGRAM_CHAT_ID?.trim() || "",
  },
} as const;
