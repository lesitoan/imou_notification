import { CameraEvents } from "./camera.js";
import { config, type CameraConfig } from "./config.js";
import { log, logError } from "./logger.js";
import { captureSnapshot } from "./snapshot.js";
import { sendMotionNotification } from "./telegram.js";

let shuttingDown = false;
const activeNotifications = new Set<Promise<void>>();

async function notify(camera: CameraConfig): Promise<void> {
  try {
    const image = await captureSnapshot(camera);
    await sendMotionNotification(camera.name, image);
    log(`${camera.name}: snapshot sent to Telegram`);
  } catch (error) {
    logError(`${camera.name}: snapshot notification failed`, error);
  }
}

function watchCamera(settings: CameraConfig): CameraEvents {
  let lastMotion: boolean | null = null;
  let notificationInProgress = false;

  return new CameraEvents(settings, (motion) => {
    if (shuttingDown || motion === lastMotion) return;
    lastMotion = motion;
    log(`${settings.name}: ${motion ? "MOTION START" : "MOTION END"}`);
    if (!motion || notificationInProgress) return;

    notificationInProgress = true;
    const task = notify(settings).finally(() => {
      notificationInProgress = false;
      activeNotifications.delete(task);
    });
    activeNotifications.add(task);
  });
}

const cameras = config.cameras.map(watchCamera);

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received; shutting down`);
  for (const camera of cameras) camera.stop();
  await Promise.allSettled([...activeNotifications]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => logError("Uncaught exception", error));
process.on("unhandledRejection", (error) => logError("Unhandled rejection", error));

log("Imou Motion Snapshot starting");
for (const camera of cameras) camera.start();
