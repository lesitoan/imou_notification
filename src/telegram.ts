import { config } from "./config.js";

function caption(cameraName: string, date: Date): string {
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
  return `🚨 Phát hiện chuyển động\n\n📷 Camera: ${cameraName}\n🕐 ${timestamp}`;
}

export async function sendMotionNotification(cameraName: string, image: Buffer): Promise<void> {
  const form = new FormData();
  form.set("chat_id", config.telegram.chatId);
  form.set("caption", caption(cameraName, new Date()));
  form.set("photo", new Blob([Uint8Array.from(image)], { type: "image/jpeg" }), "snapshot.jpg");

  const response = await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Telegram sendPhoto failed (${response.status}): ${details.slice(0, 300)}`);
  }
}
