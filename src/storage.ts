import { mkdir, readFile, readdir, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig, CameraConfig } from "./config.js";
import { log, logError } from "./logger.js";

export type Delivery = "pending" | "sent" | "disabled" | "failed";
export type MediaJob = {
  id: string; kind: "video" | "snapshot"; cameraId: string; cameraName: string; file: string; remotePath: string;
  startedAt: number; completedAt: number; createdAt: number; bytes: number; retainLocal: boolean;
  telegram: Delivery; drive: Delivery; telegramAttempts: number; driveAttempts: number; telegramNextAt: number; driveNextAt: number;
  preparedFile?: string;
  legacy?: boolean;
};

export class MediaStore {
  readonly jobs = new Map<string, MediaJob>();
  readonly busy = new Set<string>();
  readonly activePaths = new Set<string>();
  private writes = new Map<string, Promise<void>>();
  private cleaning: Promise<void> | null = null;
  constructor(readonly settings: AppConfig) {}

  private contains(root: string, file: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(file));
    return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
  }
  private owns(file: string): boolean {
    return [this.settings.recordingPath, this.settings.snapshotPath, this.settings.preparedPath].some(root => this.contains(root, file));
  }
  async removeFile(file: string): Promise<void> {
    if (!this.owns(file)) throw new Error("Refusing to delete media outside configured storage roots");
    await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  async initialize(): Promise<void> {
    for (const root of [this.settings.dataPath, this.settings.recordingPath, this.settings.snapshotPath, this.settings.statePath, this.settings.preparedPath]) await mkdir(root, { recursive: true });
    for (const name of await readdir(this.settings.statePath)) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(this.settings.statePath, name);
      try {
        const job: MediaJob = JSON.parse(await readFile(file, "utf8"));
        if (!/^[a-f0-9-]{36}$/.test(job.id) || name !== `${job.id}.json` || !this.owns(job.file) || (job.preparedFile && !this.contains(this.settings.preparedPath, job.preparedFile)) || !["video", "snapshot"].includes(job.kind)) throw new Error("Invalid job metadata");
        this.jobs.set(job.id, job);
      } catch (error) { logError(`Cannot load media job ${name}`, error); throw new Error("Invalid media state; repair before starting"); }
    }
    await this.recoverExisting();
    log(`Media store ready: ${this.jobs.size} records, ${this.pendingVideos().length} Telegram videos pending`);
  }
  async persist(job: MediaJob): Promise<void> {
    const previous = this.writes.get(job.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const file = path.join(this.settings.statePath, `${job.id}.json`), temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
      await rename(temporary, file);
    });
    this.writes.set(job.id, next);
    try { await next; } finally { if (this.writes.get(job.id) === next) this.writes.delete(job.id); }
  }
  async hasSpace(): Promise<boolean> {
    if (this.settings.minFreeBytes === 0) return true;
    const disk = await statfs(this.settings.dataPath);
    return disk.bavail * disk.bsize > this.settings.minFreeBytes;
  }
  async allocate(camera: CameraConfig, kind: "video" | "snapshot", timestamp = Date.now()): Promise<string> {
    if (!await this.hasSpace()) throw new Error("Disk free space below MIN_FREE_DISK_BYTES");
    const date = new Date(timestamp);
    const folder = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TZ || "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const root = kind === "video" ? this.settings.recordingPath : this.settings.snapshotPath;
    const directory = path.join(root, folder, camera.id);
    await mkdir(directory, { recursive: true });
    return path.join(directory, `${date.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.${kind === "video" ? "mp4" : "jpg"}`);
  }
  pendingVideos(): MediaJob[] {
    return [...this.jobs.values()].filter(job => job.telegram === "pending").sort((a, b) => a.startedAt - b.startedAt);
  }
  async register(camera: CameraConfig, kind: "video" | "snapshot", file: string, startedAt: number, options: { recovered?: boolean; legacy?: boolean } = {}): Promise<MediaJob> {
    const info = await stat(file), now = Date.now();
    const telegramRequested = kind === "video" && camera.telegramVideo && !options.legacy;
    const pending = this.pendingVideos();
    const fits = pending.length < this.settings.queue.maxSize && pending.reduce((sum, job) => sum + job.bytes, 0) + info.size <= this.settings.queue.maxBytes;
    const root = kind === "video" ? this.settings.recordingPath : this.settings.snapshotPath;
    const job: MediaJob = {
      id: randomUUID(), kind, cameraId: camera.id, cameraName: camera.name, file,
      remotePath: `${kind === "video" ? "recordings" : "snapshots"}/${path.relative(root, file).split(path.sep).join("/")}`,
      startedAt, completedAt: info.mtimeMs, createdAt: now, bytes: info.size,
      retainLocal: Boolean(options.legacy) || (kind === "video" ? camera.localVideo : camera.localSnapshot),
      telegram: telegramRequested ? (fits ? "pending" : "failed") : "disabled",
      drive: (kind === "video" ? camera.driveVideo : camera.driveSnapshot) ? "pending" : "disabled",
      telegramAttempts: 0, driveAttempts: 0, telegramNextAt: 0, driveNextAt: 0,
      legacy: Boolean(options.legacy),
    };
    this.jobs.set(job.id, job);
    await this.persist(job);
    if (telegramRequested && !fits) log(`${camera.name}: video queue full; Telegram video not queued (${info.size} bytes)`);
    if (options.recovered) log(`${camera.name}: recovered completed ${kind}: ${file}`);
    return job;
  }
  private async recoverExisting(): Promise<void> {
    const known = new Set([...this.jobs.values()].map(job => path.resolve(job.file)));
    for (const [root, kind] of [[this.settings.recordingPath, "video"], [this.settings.snapshotPath, "snapshot"]] as const) {
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) { await visit(file); continue; }
          if (!entry.isFile() || !entry.name.endsWith(kind === "video" ? ".mp4" : ".jpg") || known.has(path.resolve(file))) continue;
          const camera = this.settings.cameras.find(c => file.split(path.sep).includes(c.id)) ?? this.settings.cameras[0];
          const legacy = !file.split(path.sep).includes(camera.id);
          const info = await stat(file);
          if (info.size > 0) await this.register(camera, kind, file, info.mtimeMs, { recovered: true, legacy });
        }
      };
      await visit(root);
    }
  }
  async cleanup(now = Date.now()): Promise<void> {
    if (this.cleaning) return this.cleaning;
    const task = this.cleanupRecords(now);
    this.cleaning = task;
    try { await task; } finally { this.cleaning = null; }
  }
  private async cleanupRecords(now: number): Promise<void> {
    for (const job of [...this.jobs.values()]) {
      if (this.busy.has(job.id) || this.writes.has(job.id) || this.activePaths.has(job.file)) continue;
      this.busy.add(job.id);
      try {
      const pending = job.telegram === "pending" || job.drive === "pending";
      if (pending && now - job.createdAt >= this.settings.pendingMaxAgeHours * 3_600_000) {
        if (job.telegram === "pending") job.telegram = "failed";
        if (job.drive === "pending") job.drive = "failed";
        log(`${job.cameraName}: pending deliveries expired for ${job.file}`);
        await this.persist(job);
      }
      if (job.telegram !== "pending" && job.preparedFile) {
        await this.removeFile(job.preparedFile); delete job.preparedFile; await this.persist(job);
      }
      const stillPending = job.telegram === "pending" || job.drive === "pending";
      const old = now - job.completedAt >= this.settings.retentionDays * 86_400_000;
      if (stillPending && this.settings.protectPending) continue;
      if ((job.retainLocal && !old) || (!job.retainLocal && stillPending)) continue;
      if (stillPending) log(`${job.cameraName}: retention removed a pending file (PROTECT_PENDING_DELIVERIES=false)`);
      await this.removeFile(job.file);
      if (job.preparedFile) await this.removeFile(job.preparedFile);
      await unlink(path.join(this.settings.statePath, `${job.id}.json`)).catch(error => { if (error.code !== "ENOENT") throw error; });
      this.jobs.delete(job.id);
      } finally { this.busy.delete(job.id); }
    }
    // Crashed FFmpeg partials are never delivered; remove only stale, inactive partials.
    const prune = async (root: string): Promise<void> => {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) await prune(file);
        else if (entry.isFile() && entry.name.endsWith(".part") && !this.activePaths.has(file) && now - (await stat(file)).mtimeMs > 3_600_000) await this.removeFile(file);
      }
    };
    await prune(this.settings.recordingPath);
    await prune(this.settings.snapshotPath);
    await prune(this.settings.preparedPath);
  }
}
