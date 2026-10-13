import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../dist/config.js';
import { MotionController } from '../dist/motion.js';
import { MediaStore } from '../dist/storage.js';
import { TelegramClient, TelegramError } from '../dist/telegram.js';
import { DeliveryWorkers } from '../dist/workers.js';

const environment = {
  CAMERA_COUNT: '1', CAMERA_1_HOST: '192.0.2.1', CAMERA_1_USERNAME: 'admin', CAMERA_1_PASSWORD: 'test',
  CAMERA_1_RTSP_URL: 'rtsp://admin:test@192.0.2.1:554/stream', CAMERA_1_NAME: 'Test',
  TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_CHAT_ID: '-123', MIN_FREE_DISK_BYTES: '0',
};
const settings = overrides => loadConfig({ ...environment, ...overrides });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(overrides = {}) {
  const config = settings({ VIDEO_ENABLED: 'true', ...overrides }), starts = [], photos = [];
  let now = 0, next = 0; const timers = new Map();
  let controller;
  const clock = { now: () => now, later: (fn, ms) => { timers.set(++next, { fn, at: now + ms }); return next; }, cancel: id => timers.delete(id) };
  const backend = { start: async at => { starts.push(at); }, stop: async () => { controller.closed(true); } };
  controller = new MotionController(config.cameras[0], backend, () => photos.push(now), error => { throw error; }, clock);
  const advance = async ms => {
    const target = now + ms;
    while (true) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].fn(); await settle();
    }
    now = target; await settle();
  };
  return { controller, starts, photos, advance };
}
test('config supports variable camera count, legacy profile and strict flags', () => {
  assert.equal(settings({ VIDEO_ENABLED: 'false' }).cameras[0].videoEnabled, false);
  assert.throws(() => settings({ VIDEO_ENABLED: 'yes' }), /true or false/);
  assert.throws(() => settings({ CAMERA_COUNT: '1.5' }), /integer/);
  assert.throws(() => settings({ VIDEO_ENABLED: 'false', TELEGRAM_VIDEO_ENABLED: 'true' }), /require VIDEO/);
  const legacy = loadConfig({ CAMERA_HOST: '192.0.2.1', CAMERA_USERNAME: 'admin', CAMERA_PASSWORD: 'test', CAMERA_RTSP_URL: 'rtsp://192.0.2.1/stream', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_CHAT_ID: '1' });
  assert.equal(legacy.cameras[0].photoTrigger, 'recording_start'); assert.equal(legacy.cameras[0].videoMode, 'motion');
  const two = settings({ CAMERA_COUNT: '2', CAMERA_2_HOST: '192.0.2.2', CAMERA_2_USERNAME: 'admin', CAMERA_2_PASSWORD: 'test', CAMERA_2_RTSP_URL: 'rtsp://192.0.2.2/stream' });
  assert.equal(two.cameras.length, 2);
});
test('fixed video merges starts during recording and leaves photo triggers independent', async () => {
  const f = fixture({ VIDEO_MODE: 'fixed', PHOTO_TRIGGER: 'motion_start' });
  f.controller.motion(true); await settle(); await f.advance(4000);
  f.controller.motion(false); await f.advance(1000); f.controller.motion(true); await settle();
  assert.equal(f.starts.length, 1); assert.deepEqual(f.photos, [0, 5000]);
  await f.advance(10000); f.controller.closed(true); await settle();
  assert.equal(f.starts.length, 1); // No periodic recording from a sticky true state.
  f.controller.motion(false); f.controller.motion(true); await settle(); assert.equal(f.starts.length, 2);
  await f.controller.stop();
});
test('motion mode stops ten seconds after END, cancels on resume and sends one photo per session', async () => {
  const f = fixture({ VIDEO_MODE: 'motion', PHOTO_TRIGGER: 'recording_start', VIDEO_POST_DELAY_SECONDS: '10' });
  f.controller.motion(true); await settle(); await f.advance(3000); f.controller.motion(false);
  await f.advance(2000); f.controller.motion(true); await f.advance(20000);
  assert.equal(f.starts.length, 1); assert.equal(f.photos.length, 1);
  f.controller.motion(false); await f.advance(9999); assert.equal(f.starts.length, 1);
  await f.advance(1); f.controller.motion(true); await settle(); assert.equal(f.starts.length, 2); assert.equal(f.photos.length, 2);
  await f.controller.stop();
});
test('motion segment rollover retains session and an END during async start is handled', async () => {
  const f = fixture({ VIDEO_MODE: 'motion', PHOTO_TRIGGER: 'recording_start' });
  f.controller.motion(true); f.controller.motion(false); await settle();
  await f.advance(10000); f.controller.motion(true); await settle();
  assert.equal(f.photos.length, 2); f.controller.closed(true); await settle();
  assert.equal(f.starts.length, 3); assert.equal(f.photos.length, 2); await f.controller.stop();
});
async function storeFixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'imou-notifi-test-'));
  const config = settings({ DATA_PATH: root, VIDEO_ENABLED: 'true', TELEGRAM_VIDEO_ENABLED: 'true', ...overrides });
  const store = new MediaStore(config); await store.initialize(); return { store, config, root };
}
test('durable queue recovers jobs, applies count/bytes limits and protects pending files', async () => {
  const { store, config } = await storeFixture({ VIDEO_QUEUE_MAX_SIZE: '1', LOCAL_RETENTION_DAYS: '1' });
  const file = await store.allocate(config.cameras[0], 'video'); await writeFile(file, Buffer.alloc(32));
  const job = await store.register(config.cameras[0], 'video', file, Date.now());
  job.completedAt = Date.now() - 3 * 86400000; await store.persist(job); await store.cleanup(); await access(file);
  const restored = new MediaStore(config); await restored.initialize(); assert.equal(restored.pendingVideos().length, 1);
  const second = await restored.allocate(config.cameras[0], 'video'); await writeFile(second, Buffer.alloc(32));
  const rejected = await restored.register(config.cameras[0], 'video', second, Date.now()); assert.equal(rejected.telegram, 'failed');
  await restored.cleanup(); await assert.rejects(access(second));
  const loaded = restored.jobs.get(job.id); loaded.telegram = 'sent'; await restored.persist(loaded); await restored.cleanup(); await assert.rejects(access(file));
});
test('queue age expires with explicit failed state while local retention is independent', async () => {
  const { store, config } = await storeFixture({ LOCAL_VIDEO_ENABLED: 'true', LOCAL_RETENTION_DAYS: '3', VIDEO_PENDING_MAX_AGE_HOURS: '1' });
  const file = await store.allocate(config.cameras[0], 'video'); await writeFile(file, Buffer.alloc(10));
  const job = await store.register(config.cameras[0], 'video', file, Date.now()); job.createdAt -= 7200000;
  await store.persist(job); await store.cleanup(); assert.equal(job.telegram, 'failed'); await access(file);
});
test('orphan completed clips recover but legacy archives are not replayed on Telegram', async () => {
  const { store, config } = await storeFixture();
  const file = await store.allocate(config.cameras[0], 'video'); await writeFile(file, Buffer.alloc(10));
  const legacy = path.join(config.recordingPath, 'old.mp4'); await writeFile(legacy, Buffer.alloc(10));
  const restored = new MediaStore(config); await restored.initialize();
  assert.equal(restored.pendingVideos().length, 1);
  assert.equal([...restored.jobs.values()].find(j => j.file === legacy).telegram, 'disabled');
});
test('Telegram upload streams file chunks and photo priority does not delay photos', async () => {
  const { config, root } = await storeFixture();
  const file = path.join(root, 'upload.mp4'); await writeFile(file, Buffer.alloc(256 * 1024, 1));
  let streamedBytes = 0, largest = 0, declared = 0;
  const client = new TelegramClient(config, async (_url, request) => {
    declared = Number(request.headers['Content-Length']);
    for await (const chunk of request.body) { streamedBytes += chunk.length; largest = Math.max(largest, chunk.length); }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  client.beginPhoto(); assert.equal(client.canSendVideo(), false); client.endPhoto(); assert.equal(client.canSendVideo(), true);
  await client.sendVideo('Test', file, Date.now()); assert.equal(streamedBytes, declared); assert.ok(largest <= 64 * 1024);
  assert.equal(client.canSendVideo(), false);
});
test('Telegram 429 honors retry_after and defers further video work', async () => {
  const config = settings();
  const client = new TelegramClient(config, async () => new Response(JSON.stringify({ ok: false, parameters: { retry_after: 23 }, description: 'Too Many Requests' }), { status: 429 }));
  await assert.rejects(client.sendPhoto('Test', Buffer.from('jpeg')), error => error instanceof TelegramError && error.retryAfter === 23);
  assert.equal(client.canSendVideo(), false);
});
test('Drive disabled does not start rclone or mark a pending job delivered', async () => {
  const { store, config } = await storeFixture();
  const workers = new DeliveryWorkers(store, new TelegramClient(config)); await workers.validate(); await workers.driveStep(); await workers.stop();
});
