import type { CameraConfig } from "./config.js";

export interface RecordingBackend {
  start(startedAt: number): Promise<void>;
  stop(): Promise<void>;
}
export interface Clock {
  now(): number;
  later(callback: () => void, milliseconds: number): unknown;
  cancel(timer: unknown): void;
}
const clock: Clock = { now: Date.now, later: (callback, milliseconds) => setTimeout(callback, milliseconds), cancel: timer => clearTimeout(timer as NodeJS.Timeout) };

export class MotionController {
  private lastMotion: boolean | null = null;
  private state: "idle" | "starting" | "recording" | "stopping" = "idle";
  private timer: unknown = null;
  private session = false;
  private stopped = false;
  private startTask: Promise<void> = Promise.resolve();
  constructor(private camera: CameraConfig, private backend: RecordingBackend,
    private onPhoto: () => void, private onError: (error: unknown) => void, private time: Clock = clock) {}

  motion(value: boolean): void {
    if (this.stopped || value === this.lastMotion) return;
    this.lastMotion = value;
    if (value && this.camera.photoTrigger === "motion_start") this.onPhoto();
    if (!this.camera.videoEnabled) return;
    if (value) {
      this.clearTimer();
      if (this.state === "idle") this.begin();
    } else if (this.state === "recording" && this.camera.videoMode === "motion") this.scheduleStop();
  }
  private begin(): void {
    this.state = "starting";
    const newSession = !this.session;
    this.startTask = (async () => {
      try {
        await this.backend.start(this.time.now());
        if (this.state !== "starting") return;
        this.state = "recording"; this.session = true;
        if (newSession && !this.stopped && this.camera.photoTrigger === "recording_start") this.onPhoto();
        if (!this.lastMotion && this.camera.videoMode === "motion") this.scheduleStop();
      } catch (error) { this.state = "idle"; this.session = false; this.onError(error); }
    })();
  }
  private clearTimer(): void { if (this.timer !== null) this.time.cancel(this.timer); this.timer = null; }
  private scheduleStop(): void {
    this.clearTimer();
    this.timer = this.time.later(() => {
      this.timer = null; this.state = "stopping"; this.session = false;
      void this.backend.stop().catch(this.onError);
    }, this.camera.postDelaySeconds * 1000);
  }
  closed(success: boolean): void {
    this.clearTimer(); this.state = "idle";
    if (!success) this.session = false;
    if (this.stopped) return;
    if (success && this.camera.videoMode === "motion" && this.lastMotion) this.begin();
    else this.session = false;
  }
  async stop(): Promise<void> {
    this.stopped = true; this.clearTimer();
    await this.startTask; await this.backend.stop();
  }
}
