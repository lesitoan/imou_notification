import { CameraEvents } from "./camera.js";
import { runCleanup } from "./cleanup.js";
import { config } from "./config.js";
import { log, logError } from "./logger.js";
import { Recorder } from "./recorder.js";
import { sendMotionNotification } from "./telegram.js";

type State = "IDLE" | "RECORDING" | "WAITING_STOP";

const recorder = new Recorder();
let state: State = "IDLE";
let lastMotion: boolean | null = null;
let stopTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function startEvent(): Promise<void> {
  try {
    await recorder.start();
    state = "RECORDING";
  } catch (error) {
    state = "IDLE";
    logError("Could not start recording", error);
    return;
  }

  let snapshotPath: string | undefined;
  try {
    snapshotPath = await recorder.snapshot();
  } catch (error) {
    logError("Snapshot failed", error);
  }
  void sendMotionNotification(snapshotPath);
}

function scheduleStop(): void {
  if (stopTimer) clearTimeout(stopTimer);
  state = "WAITING_STOP";
  stopTimer = setTimeout(() => {
    stopTimer = null;
    void recorder.stop().finally(() => {
      state = "IDLE";
      lastMotion = false;
    });
  }, config.recording.postDelaySeconds * 1000);
  log(`Recording stop scheduled in ${config.recording.postDelaySeconds}s`);
}

function onMotionChanged(motion: boolean): void {
  if (motion === lastMotion) return;
  lastMotion = motion;
  log(motion ? "MOTION START" : "MOTION END");

  if (motion && state === "IDLE") {
    void startEvent();
    return;
  }
  if (!motion && state === "RECORDING") {
    scheduleStop();
    return;
  }
  if (motion && state === "WAITING_STOP") {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    state = "RECORDING";
    log("Motion resumed; pending stop cancelled");
  }
}

const camera = new CameraEvents(onMotionChanged);
const cleanupInterval = setInterval(
  () => void runCleanup(recorder.activePath),
  config.retention.cleanupIntervalMinutes * 60 * 1000,
);

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received; shutting down`);
  if (stopTimer) clearTimeout(stopTimer);
  clearInterval(cleanupInterval);
  camera.stop();
  await recorder.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => logError("Uncaught exception", error));
process.on("unhandledRejection", (error) => logError("Unhandled rejection", error));

log("Imou Motion Recorder starting");
camera.start();
void runCleanup(recorder.activePath);
