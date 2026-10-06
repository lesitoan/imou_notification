import { spawn } from "node:child_process";
import { config, type CameraConfig } from "./config.js";

const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

export function captureSnapshot(camera: CameraConfig): Promise<Buffer> {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-rtsp_transport", "tcp",
    "-i", camera.rtspUrl,
    "-frames:v", "1",
    "-q:v", "2",
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "pipe:1",
  ];

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Snapshot timed out"));
    }, config.snapshotTimeoutSeconds * 1000);

    function finish(error?: Error, image?: Buffer): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(image!);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_SNAPSHOT_BYTES) {
        child.kill("SIGKILL");
        finish(new Error("Snapshot exceeded 10 MiB"));
        return;
      }
      chunks.push(chunk);
    });

    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code !== 0 || bytes === 0) {
        finish(new Error(`FFmpeg snapshot failed (code=${code ?? "null"})`));
        return;
      }
      finish(undefined, Buffer.concat(chunks, bytes));
    });
  });
}
