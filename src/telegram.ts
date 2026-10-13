import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";

export class TelegramError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter = 0) { super(message); }
}
export class TelegramClient {
  photosInProgress = 0;
  private sends: number[] = [];
  private videoBlockedUntil = 0;
  constructor(private settings: AppConfig, private fetcher: typeof fetch = fetch) {}
  beginPhoto(): void { this.photosInProgress++; }
  endPhoto(): void { this.photosInProgress--; }
  canSendVideo(now = Date.now()): boolean {
    this.sends = this.sends.filter(sent => now - sent < 60_000);
    const last = this.sends[this.sends.length - 1] ?? 0;
    return this.photosInProgress === 0 && now >= this.videoBlockedUntil && this.sends.length < 18 && now - last >= this.settings.queue.intervalSeconds * 1000;
  }
  deferVideos(seconds: number): void { this.videoBlockedUntil = Math.max(this.videoBlockedUntil, Date.now() + seconds * 1000); }
  caption(cameraName: string, startedAt: number): string {
    const timestamp = new Intl.DateTimeFormat("vi-VN", { timeZone: process.env.TZ || "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(startedAt));
    return `🚨 Phát hiện chuyển động\n\n📷 Camera: ${cameraName}\n🕐 ${timestamp}`;
  }
  private async request(method: string, body: BodyInit, timeout: number, headers?: Record<string, string>, signal?: AbortSignal): Promise<void> {
    const signals = [AbortSignal.timeout(timeout)]; if (signal) signals.push(signal);
    this.sends = this.sends.filter(sent => Date.now() - sent < 60_000); this.sends.push(Date.now());
    const response = await this.fetcher(`https://api.telegram.org/bot${this.settings.telegram.token}/${method}`, {
      method: "POST", body, headers, signal: AbortSignal.any(signals), duplex: "half",
    } as RequestInit);
    const data = await response.json() as { ok?: boolean; description?: string; parameters?: { retry_after?: number } };
    if (!response.ok || !data.ok) {
      const wait = Number(data.parameters?.retry_after) || 0;
      if (response.status === 429) this.deferVideos(wait || 60);
      throw new TelegramError(`Telegram ${method}: ${data.description ?? response.status}`, response.status, wait);
    }
  }
  async sendPhoto(name: string, image: Buffer, timestamp = Date.now()): Promise<void> {
    const form = new FormData(); form.set("chat_id", this.settings.telegram.chatId); form.set("caption", this.caption(name, timestamp));
    form.set("photo", new Blob([Uint8Array.from(image)], { type: "image/jpeg" }), "snapshot.jpg");
    await this.request("sendPhoto", form, 15_000);
  }
  async sendText(name: string, timestamp = Date.now()): Promise<void> {
    await this.request("sendMessage", new URLSearchParams({ chat_id: this.settings.telegram.chatId, text: this.caption(name, timestamp) }), 15_000);
  }
  async sendVideo(name: string, file: string, timestamp: number, signal?: AbortSignal): Promise<void> {
    const boundary = `imou-${randomUUID()}`;
    const fields: Record<string, string> = { chat_id: this.settings.telegram.chatId, caption: this.caption(name, timestamp), supports_streaming: "true" };
    let preamble = "";
    for (const [key, value] of Object.entries(fields)) preamble += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
    preamble += `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
    const header = Buffer.from(preamble), footer = Buffer.from(`\r\n--${boundary}--\r\n`), bytes = (await stat(file)).size;
    if (bytes > this.settings.telegram.videoMaxBytes) throw new Error("Video exceeds upload size limit");
    const stream = createReadStream(file, { highWaterMark: 64 * 1024 });
    const body = Readable.from((async function* () { yield header; for await (const chunk of stream) yield chunk; yield footer; })());
    try {
      await this.request("sendVideo", body as unknown as BodyInit, this.settings.telegram.uploadTimeoutSeconds * 1000,
        { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(header.length + bytes + footer.length) }, signal);
    } finally { body.destroy(); stream.destroy(); }
  }
}
