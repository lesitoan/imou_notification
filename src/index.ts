import { writeFile, rename } from "node:fs/promises";
import { CameraEvents } from "./camera.js";
import { config } from "./config.js";
import { captureSnapshot } from "./snapshot.js";
import { log, logError } from "./logger.js";
import { MediaStore } from "./storage.js";
import { TelegramClient } from "./telegram.js";
import { Recorder } from "./recorder.js";
import { MotionController } from "./motion.js";
import { DeliveryWorkers } from "./workers.js";

async function main(): Promise<void> {
  const store = new MediaStore(config), telegram = new TelegramClient(config), workers = new DeliveryWorkers(store, telegram);
  await store.initialize(); await workers.validate(); await store.cleanup();
  let shuttingDown = false, cleanupRunning = false;
  const photos = new Set<Promise<void>>();
  const controllers: MotionController[] = [], cameras: CameraEvents[] = [];
  for (const camera of config.cameras) {
    let photoInProgress = false;
    const notify = () => {
      if (shuttingDown || photoInProgress || !(camera.photoEnabled || camera.localSnapshot || camera.driveSnapshot)) return;
      photoInProgress = true;
      const startedAt = Date.now(); telegram.beginPhoto();
      const task = (async () => {
        let image: Buffer;
        try {
          image = await captureSnapshot(camera);
        } catch (error) {
          logError(`${camera.name}: snapshot failed`, error);
          if (camera.photoEnabled && camera.photoFailureAction === "text") await telegram.sendText(camera.name, startedAt);
          return;
        }
        if (camera.localSnapshot || camera.driveSnapshot) {
          let partial: string | undefined;
          try {
            const file = await store.allocate(camera, "snapshot", startedAt);
            partial = `${file}.part`; store.activePaths.add(partial);
            await writeFile(partial, image); await rename(partial, file);
            await store.register(camera, "snapshot", file, startedAt);
          } catch (error) { logError(`${camera.name}: snapshot archive failed`, error); }
          finally {
            if (partial) {
              store.activePaths.delete(partial);
              await store.removeFile(partial).catch(error => logError("Snapshot partial cleanup failed", error));
            }
          }
        }
        if (camera.photoEnabled) { await telegram.sendPhoto(camera.name, image, startedAt); log(`${camera.name}: snapshot sent to Telegram`); }
      })().catch(error => logError(`${camera.name}: snapshot notification failed`, error)).finally(() => {
        photoInProgress = false; telegram.endPhoto(); photos.delete(task);
      });
      photos.add(task);
    };
    let controller: MotionController;
    const recorder = new Recorder(camera, store, success => controller.closed(success));
    controller = new MotionController(camera, recorder, notify, error => logError(`${camera.name}: recorder error`, error));
    let lastMotion: boolean | null = null;
    const events = new CameraEvents(camera, motion => {
      if (shuttingDown) return;
      if (motion !== lastMotion) { lastMotion = motion; log(`${camera.name}: ${motion ? "MOTION START" : "MOTION END"}`); }
      controller.motion(motion);
    });
    controllers.push(controller); cameras.push(events);
    log(`${camera.name}: photo=${camera.photoTrigger}, video=${camera.videoEnabled ? camera.videoMode : "off"}, Telegram video=${camera.telegramVideo}, local=${camera.localVideo}, Drive=${camera.driveVideo}`);
  }
  const cleanupTimer = setInterval(() => {
    if (cleanupRunning || shuttingDown) return;
    cleanupRunning = true;
    void store.cleanup().catch(error => logError("Cleanup failed", error)).finally(() => { cleanupRunning = false; });
  }, config.cleanupIntervalMinutes * 60_000);
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; shuttingDown = true; clearInterval(cleanupTimer);
    log(`${signal}: shutting down; pending deliveries remain on disk`);
    for (const camera of cameras) camera.stop();
    await workers.stop(); await Promise.allSettled(controllers.map(c => c.stop())); await Promise.allSettled([...photos]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM")); process.on("SIGINT", () => void shutdown("SIGINT"));
  log(`Imou Notifi 2.0.1 starting: site=${config.siteId}, cameras=${cameras.length}`);
  workers.start(); for (const camera of cameras) camera.start();
}
process.on("unhandledRejection", error => { logError("Unhandled rejection", error); process.exitCode = 1; });
void main().catch(error => { logError("Startup failed", error); process.exit(1); });
