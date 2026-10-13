import { spawn, type ChildProcess } from "node:child_process";
import { rename, stat } from "node:fs/promises";
import type { CameraConfig } from "./config.js";
import { MediaStore } from "./storage.js";
import { log, logError } from "./logger.js";

export function recordingArgs(camera: CameraConfig, partial: string): string[] {
  const duration = camera.videoMode === "fixed" ? camera.durationSeconds : camera.maxDurationSeconds;
  return ["-hide_banner", "-loglevel", "warning", "-rtsp_transport", "tcp", "-timeout", "15000000",
    "-i", camera.rtspUrl, "-map", "0:v:0", "-c:v", "copy", "-an", "-t", String(duration), "-movflags", "+faststart", "-f", "mp4", partial];
}

export class Recorder {
  private child: ChildProcess | null = null;
  private finished: Promise<void> = Promise.resolve();
  constructor(private camera: CameraConfig, private store: MediaStore, private onClosed: (success: boolean) => void) {}
  async start(startedAt: number): Promise<void> {
    if (this.child) throw new Error("Recording already active");
    const output = await this.store.allocate(this.camera, "video", startedAt), partial = `${output}.part`;
    const duration = this.camera.videoMode === "fixed" ? this.camera.durationSeconds : this.camera.maxDurationSeconds;
    const child = spawn("ffmpeg", recordingArgs(this.camera, partial), { stdio: ["pipe", "ignore", "pipe"] });
    this.child = child; this.store.activePaths.add(partial);
    let stderr = "", forceTimer: NodeJS.Timeout | undefined;
    const watchdog = setTimeout(() => child.kill("SIGKILL"), (duration + 45) * 1000);
    child.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
    child.stdin?.on("error", error => logError(`${this.camera.name}: recorder input closed`, error));
    this.finished = new Promise(resolve => {
      child.once("close", code => {
        void (async () => {
          clearTimeout(watchdog); if (forceTimer) clearTimeout(forceTimer);
          this.child = null; this.store.activePaths.delete(partial);
          let success = false;
          try {
            const info = await stat(partial).catch(() => null);
            if (code !== 0 || !info?.size) throw new Error(`FFmpeg video exited ${code}: ${stderr}`);
            await rename(partial, output);
            await this.store.register(this.camera, "video", output, startedAt);
            success = true; log(`${this.camera.name}: video completed (${info.size} bytes): ${output}`);
          } catch (error) {
            logError(`${this.camera.name}: recording failed`, error);
            await this.store.removeFile(partial).catch(error => logError("Partial cleanup failed", error));
          }
          this.onClosed(success); resolve();
        })().catch(error => { logError("Recording finalization failed", error); this.onClosed(false); resolve(); });
      });
    });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    // Register the stop watchdog on the child so repeated stop calls share the same timer.
    child.on("stop-request", () => {
      if (forceTimer) return;
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 12_000);
      if (child.stdin?.writable) child.stdin.write("q\n"); else child.kill("SIGINT");
    });
    log(`${this.camera.name}: recording started (${this.camera.videoMode}, limit ${duration}s)`);
  }
  async stop(): Promise<void> {
    this.child?.emit("stop-request"); await this.finished;
  }
}
