import { readFile } from "node:fs/promises";
import { config } from "./config.js";
import { log, logError } from "./logger.js";

function caption(date: Date): string {
  const timestamp = new Intl.DateTimeFormat("vi-VN", {
    timeZone: process.env.TZ || "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `🚨 Phát hiện chuyển động\n\n📷 Camera: ${config.camera.name}\n🕐 ${timestamp}`;
}

async function telegramRequest(method: string, body: URLSearchParams | FormData): Promise<void> {
  if (!config.telegram.token || !config.telegram.chatId) {
    log("Telegram is not configured; notification skipped");
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Telegram ${method} failed (${response.status}): ${details.slice(0, 300)}`);
  }
}

export async function sendMotionNotification(snapshotPath?: string): Promise<void> {
  try {
    const text = caption(new Date());
    if (snapshotPath) {
      const form = new FormData();
      form.set("chat_id", config.telegram.chatId);
      form.set("caption", text);
      const image = await readFile(snapshotPath);
      form.set("photo", new Blob([image], { type: "image/jpeg" }), "snapshot.jpg");
      await telegramRequest("sendPhoto", form);
    } else {
      const body = new URLSearchParams({ chat_id: config.telegram.chatId, text });
      await telegramRequest("sendMessage", body);
    }
    log("Telegram notification sent");
  } catch (error) {
    logError("Telegram notification failed", error);
  }
}
