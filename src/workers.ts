import { access } from "node:fs/promises";
import { MediaStore } from "./storage.js";
import { TelegramClient, TelegramError } from "./telegram.js";
import { prepareVideo } from "./video.js";
import { runProcess } from "./process.js";
import { log, logError } from "./logger.js";

export class DeliveryWorkers {
  private abort = new AbortController();
  private timers = new Set<NodeJS.Timeout>();
  private running = new Set<Promise<void>>();
  private nextDriveSweep = 0;
  constructor(readonly store: MediaStore, readonly telegram: TelegramClient) {}
  async validate(): Promise<void> {
    if (this.store.settings.drive.enabled) {
      await access(this.store.settings.drive.configPath);
      const remotes = await runProcess("rclone", ["listremotes", "--config", this.store.settings.drive.configPath], 15_000);
      const expected = this.store.settings.drive.remote.split(":", 1)[0] + ":";
      if (!remotes.split(/\r?\n/).includes(expected)) throw new Error("DRIVE_REMOTE is not configured in rclone");
    }
  }
  start(): void {
    const schedule = (work: () => Promise<void>) => {
      const tick = () => {
        if (this.abort.signal.aborted) return;
        const task = work().catch(error => logError("Delivery worker failed", error)).finally(() => {
          this.running.delete(task);
          if (!this.abort.signal.aborted) {
            const timer = setTimeout(() => { this.timers.delete(timer); tick(); }, 1000);
            this.timers.add(timer);
          }
        });
        this.running.add(task);
      };
      tick();
    };
    schedule(() => this.videoStep()); schedule(() => this.driveStep());
  }
  async stop(): Promise<void> {
    this.abort.abort(); for (const timer of this.timers) clearTimeout(timer); await Promise.allSettled([...this.running]);
  }
  async videoStep(): Promise<void> {
    if (!this.telegram.canSendVideo()) return;
    const now = Date.now();
    const job = this.store.pendingVideos().find(j => !this.store.busy.has(j.id) && j.telegramNextAt <= now && this.store.settings.cameras.find(c => c.id === j.cameraId)?.telegramVideo);
    if (!job) return;
    this.store.busy.add(job.id);
    try {
      const file = await prepareVideo(job, this.store.settings, this.abort.signal);
      await this.store.persist(job);
      if (!this.telegram.canSendVideo()) return;
      await this.telegram.sendVideo(job.cameraName, file, job.startedAt, this.abort.signal);
      job.telegram = "sent"; await this.store.persist(job);
      log(`${job.cameraName}: video sent to Telegram`);
    } catch (error) {
      if (this.abort.signal.aborted) return;
      job.telegramAttempts++;
      const permanent = error instanceof TelegramError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      if (permanent || job.telegramAttempts >= this.store.settings.queue.maxAttempts) job.telegram = "failed";
      const wait = error instanceof TelegramError && error.retryAfter > 0 ? error.retryAfter : Math.min(300, 5 * 2 ** Math.min(job.telegramAttempts, 6));
      job.telegramNextAt = Date.now() + wait * 1000;
      await this.store.persist(job); logError(`${job.cameraName}: video delivery ${job.telegram}, attempt ${job.telegramAttempts}`, error);
    } finally { this.store.busy.delete(job.id); }
    await this.store.cleanup();
  }
  async driveStep(): Promise<void> {
    const settings = this.store.settings.drive;
    if (!settings.enabled || this.telegram.photosInProgress > 0 || Date.now() < this.nextDriveSweep) return;
    // Prioritize new camera files so migration of old archives cannot delay new backups.
    const job = [...this.store.jobs.values()].filter(j => j.drive === "pending" && !this.store.busy.has(j.id) && j.driveNextAt <= Date.now()).sort((a, b) => Number(Boolean(a.legacy)) - Number(Boolean(b.legacy)) || a.startedAt - b.startedAt)[0];
    if (!job) { this.nextDriveSweep = Date.now() + settings.intervalSeconds * 1000; return; }
    this.store.busy.add(job.id);
    try {
      const remote = `${settings.remote}/${job.remotePath}`;
      await runProcess("rclone", ["copyto", job.file, remote, "--config", settings.configPath, "--transfers", "1", "--checkers", "2",
        "--bwlimit", settings.bandwidth, "--contimeout", "15s", "--timeout", "1m", "--retries", "3", "--low-level-retries", "5",
        "--drive-pacer-min-sleep", "1s", "--drive-pacer-burst", "5", "--log-level", "ERROR"], settings.timeoutSeconds * 1000, this.abort.signal);
      job.drive = "sent"; await this.store.persist(job); log(`${job.cameraName}: ${job.kind} backed up to Drive`);
    } catch (error) {
      if (this.abort.signal.aborted) return;
      job.driveAttempts++; job.driveNextAt = Date.now() + Math.min(3600, 60 * 2 ** Math.min(job.driveAttempts, 6)) * 1000;
      await this.store.persist(job); logError(`${job.cameraName}: Drive upload deferred`, error);
    } finally { this.store.busy.delete(job.id); }
    await this.store.cleanup();
  }
}
