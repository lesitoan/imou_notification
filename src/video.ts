import { stat, statfs, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { MediaJob } from "./storage.js";
import { runProcess } from "./process.js";

export async function prepareVideo(job: MediaJob, settings: AppConfig, signal?: AbortSignal): Promise<string> {
  if (job.preparedFile && (await stat(job.preparedFile).catch(() => null))?.size) return job.preparedFile;
  const probe = JSON.parse(await runProcess("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type:format=duration", "-of", "json", job.file], 30_000, signal));
  const video = probe.streams?.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const duration = Number(probe.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error("Video metadata is invalid");
  if (video.codec_name === "h264" && job.bytes <= settings.telegram.videoMaxBytes && duration <= settings.telegram.videoMaxSeconds + 1) return job.file;
  const disk = await statfs(settings.preparedPath);
  if (disk.bavail * disk.bsize <= settings.minFreeBytes + settings.telegram.videoMaxBytes) throw new Error("Insufficient disk space for video conversion");
  const output = path.join(settings.preparedPath, `${job.id}.mp4`), partial = `${output}.part`;
  try {
    await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", job.file,
    "-map", "0:v:0", "-an", "-t", String(settings.telegram.videoMaxSeconds),
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2", "-r", "15",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "1500k", "-bufsize", "3000k",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", partial], 180_000, signal);
  if ((await stat(partial)).size > settings.telegram.videoMaxBytes) throw new Error("Prepared video exceeds TELEGRAM_VIDEO_MAX_BYTES");
    await rename(partial, output); job.preparedFile = output;
    return output;
  } finally {
    await unlink(partial).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
