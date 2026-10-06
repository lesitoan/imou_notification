import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { log, logError } from "./logger.js";

function fileTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function dateFolder(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function uniquePath(root: string, extension: string): Promise<string> {
  const now = new Date();
  const directory = path.join(root, dateFolder(now));
  await mkdir(directory, { recursive: true });
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
  return path.join(directory, `${fileTimestamp(now)}-${suffix}.${extension}`);
}

export class Recorder {
  private process: ChildProcess | null = null;
  private outputPath: string | null = null;

  get activePath(): string | null {
    return this.outputPath;
  }

  get isRecording(): boolean {
    return this.process !== null;
  }

  async start(): Promise<string> {
    if (this.process) return this.outputPath!;

    const output = await uniquePath(config.recording.path, "mp4");
    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-rtsp_transport", "tcp",
      "-i", config.camera.rtspUrl,
      "-map", "0:v:0",
      "-c:v", "copy",
      "-an",
      "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
      output,
    ];

    const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    this.process = child;
    this.outputPath = output;

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) log(`FFmpeg: ${text}`);
    });

    child.once("error", (error) => {
      logError("FFmpeg spawn failed", error);
      if (this.process === child) {
        this.process = null;
        this.outputPath = null;
      }
    });

    child.once("exit", (code, signal) => {
      log(`Recording process exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
      if (this.process === child) {
        this.process = null;
        this.outputPath = null;
      }
    });

    log(`Recording started: ${output}`);
    return output;
  }

  async stop(timeoutMs = 12_000): Promise<void> {
    const child = this.process;
    if (!child) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        log("FFmpeg did not stop in time; sending SIGKILL");
        child.kill("SIGKILL");
        finish();
      }, timeoutMs);

      child.once("exit", finish);
      if (child.stdin?.writable) child.stdin.write("q\n");
      else child.kill("SIGINT");
    });

    if (this.process === child) {
      this.process = null;
      this.outputPath = null;
    }
    log("Recording stopped");
  }

  async snapshot(): Promise<string> {
    const output = await uniquePath(config.recording.snapshotPath, "jpg");
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-rtsp_transport", "tcp",
      "-i", config.camera.rtspUrl,
      "-frames:v", "1",
      "-q:v", "2",
      "-y",
      output,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Snapshot FFmpeg exited with code ${code}: ${stderr.trim()}`));
      });
    });

    log(`Snapshot created: ${output}`);
    return output;
  }
}
