import "dotenv/config";
import path from "node:path";
type Environment = Record<string, string | undefined>;
export type VideoMode = "fixed" | "motion";
export type CameraConfig = {
  id: string; host: string; port: number; username: string; password: string; rtspUrl: string; name: string;
  photoEnabled: boolean; photoTrigger: "motion_start" | "recording_start"; photoFailureAction: "log" | "text";
  videoEnabled: boolean; videoMode: VideoMode; durationSeconds: number; postDelaySeconds: number; maxDurationSeconds: number;
  telegramVideo: boolean; localVideo: boolean; localSnapshot: boolean; driveVideo: boolean; driveSnapshot: boolean;
};
export function loadConfig(env: Environment) {
  const value = (key: string, fallback = "") => env[key]?.trim() || fallback;
  const required = (key: string) => { const v = value(key); if (!v) throw new Error(`Missing ${key}`); return v; };
  const number = (key: string, fallback: number, minimum = 1) => {
    const n = Number(value(key, String(fallback)));
    if (!Number.isFinite(n) || n < minimum) throw new Error(`${key} must be >= ${minimum}`);
    return n;
  };
  const bool = (key: string, fallback: boolean) => {
    const v = value(key, String(fallback)).toLowerCase();
    if (v !== "true" && v !== "false") throw new Error(`${key} must be true or false`);
    return v === "true";
  };
  const choice = <T extends string>(key: string, options: readonly T[], fallback: T): T => {
    const v = value(key, fallback) as T;
    if (!options.includes(v)) throw new Error(`${key} must be ${options.join(" or ")}`);
    return v;
  };
  const count = number("CAMERA_COUNT", env.CAMERA_2_HOST ? 2 : 1);
  if (!Number.isInteger(count) || count > 32) throw new Error("CAMERA_COUNT must be an integer from 1 to 32");
  const legacy = !env.CAMERA_1_HOST && Boolean(env.CAMERA_HOST);
  const driveEnabled = bool("DRIVE_UPLOAD_ENABLED", false);
  const cameras: CameraConfig[] = Array.from({ length: count }, (_, i) => {
    const prefix = legacy && i === 0 ? "CAMERA_" : `CAMERA_${i + 1}_`;
    const cameraBool = (key: string, fallback: boolean) => bool(`${prefix}${key}`, bool(key, fallback));
    const cameraNumber = (key: string, fallback: number) => number(`${prefix}${key}`, number(key, fallback));
    const host = required(`${prefix}HOST`), rtspUrl = required(`${prefix}RTSP_URL`);
    let parsed: URL;
    try { parsed = new URL(rtspUrl); } catch { throw new Error(`${prefix}RTSP_URL is invalid`); }
    if (parsed.protocol !== "rtsp:" || parsed.hostname !== host) throw new Error(`${prefix}RTSP_URL must match camera host`);
    const camera: CameraConfig = {
      id: `camera-${i + 1}`, host, rtspUrl, port: number(`${prefix}PORT`, 80),
      username: required(`${prefix}USERNAME`), password: required(`${prefix}PASSWORD`), name: value(`${prefix}NAME`, `Camera ${i + 1}`),
      photoEnabled: cameraBool("TELEGRAM_PHOTO_ENABLED", true),
      photoTrigger: choice(`${prefix}PHOTO_TRIGGER`, ["motion_start", "recording_start"], choice("PHOTO_TRIGGER", ["motion_start", "recording_start"], legacy ? "recording_start" : "motion_start")),
      photoFailureAction: choice(`${prefix}PHOTO_FAILURE_ACTION`, ["log", "text"], choice("PHOTO_FAILURE_ACTION", ["log", "text"], legacy ? "text" : "log")),
      videoEnabled: cameraBool("VIDEO_ENABLED", legacy),
      videoMode: choice(`${prefix}VIDEO_MODE`, ["fixed", "motion"], choice("VIDEO_MODE", ["fixed", "motion"], legacy ? "motion" : "fixed")),
      durationSeconds: cameraNumber("VIDEO_DURATION_SECONDS", 15),
      postDelaySeconds: cameraNumber("VIDEO_POST_DELAY_SECONDS", number("RECORDING_POST_DELAY_SECONDS", 10)),
      maxDurationSeconds: cameraNumber("VIDEO_MAX_DURATION_SECONDS", 300),
      telegramVideo: cameraBool("TELEGRAM_VIDEO_ENABLED", false), localVideo: cameraBool("LOCAL_VIDEO_ENABLED", legacy),
      localSnapshot: cameraBool("LOCAL_SNAPSHOT_ENABLED", legacy),
      driveVideo: driveEnabled && cameraBool("DRIVE_UPLOAD_VIDEOS", true), driveSnapshot: driveEnabled && cameraBool("DRIVE_UPLOAD_SNAPSHOTS", true),
    };
    if (!camera.videoEnabled && (camera.telegramVideo || camera.localVideo || camera.driveVideo)) throw new Error(`${prefix}video destinations require VIDEO_ENABLED=true`);
    if (camera.photoTrigger === "recording_start" && !camera.videoEnabled) throw new Error(`${prefix}PHOTO_TRIGGER=recording_start requires video`);
    return camera;
  });
  const dataPath = path.resolve(value("DATA_PATH", "./data")), siteId = value("SITE_ID", "camera-site");
  if (!/^[a-zA-Z0-9_-]+$/.test(siteId)) throw new Error("SITE_ID must contain letters, digits, underscores or hyphens");
  const needsTelegram = cameras.some(c => c.photoEnabled || c.telegramVideo);
  return {
    siteId, cameras, dataPath,
    recordingPath: path.resolve(value("RECORDING_PATH", path.join(dataPath, "recordings"))),
    snapshotPath: path.resolve(value("SNAPSHOT_PATH", path.join(dataPath, "snapshots"))),
    statePath: path.join(dataPath, "state"), preparedPath: path.join(dataPath, "telegram-video"),
    reconnectSeconds: number("CAMERA_RECONNECT_SECONDS", 10), snapshotTimeoutSeconds: number("SNAPSHOT_TIMEOUT_SECONDS", 20),
    retentionDays: number("LOCAL_RETENTION_DAYS", number("RETENTION_DAYS", 3)), cleanupIntervalMinutes: number("CLEANUP_INTERVAL_MINUTES", 60),
    protectPending: bool("PROTECT_PENDING_DELIVERIES", true), pendingMaxAgeHours: number("VIDEO_PENDING_MAX_AGE_HOURS", 72),
    minFreeBytes: number("MIN_FREE_DISK_BYTES", 256 * 1024 * 1024, 0),
    queue: { maxSize: number("VIDEO_QUEUE_MAX_SIZE", 20), maxBytes: number("VIDEO_QUEUE_MAX_BYTES", 500 * 1024 * 1024), intervalSeconds: number("VIDEO_SEND_INTERVAL_SECONDS", 5), maxAttempts: number("VIDEO_UPLOAD_MAX_ATTEMPTS", 10) },
    telegram: { token: needsTelegram ? required("TELEGRAM_BOT_TOKEN") : value("TELEGRAM_BOT_TOKEN"), chatId: needsTelegram ? required("TELEGRAM_CHAT_ID") : value("TELEGRAM_CHAT_ID"),
      videoMaxBytes: number("TELEGRAM_VIDEO_MAX_BYTES", 48 * 1024 * 1024), videoMaxSeconds: number("TELEGRAM_VIDEO_MAX_SECONDS", 60), uploadTimeoutSeconds: number("TELEGRAM_VIDEO_UPLOAD_TIMEOUT_SECONDS", 180) },
    drive: { enabled: driveEnabled, remote: driveEnabled ? required("DRIVE_REMOTE").replace(/\/$/, "") : value("DRIVE_REMOTE"), configPath: driveEnabled ? required("DRIVE_RCLONE_CONFIG") : value("DRIVE_RCLONE_CONFIG"),
      intervalSeconds: number("DRIVE_UPLOAD_INTERVAL_SECONDS", 300), bandwidth: value("DRIVE_UPLOAD_BWLIMIT", "2M"), timeoutSeconds: number("DRIVE_UPLOAD_TIMEOUT_SECONDS", 300) },
  };
}
export type AppConfig = ReturnType<typeof loadConfig>;
export const config = loadConfig(process.env);
