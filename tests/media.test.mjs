import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../dist/config.js';
import { MediaStore } from '../dist/storage.js';
import { prepareVideo } from '../dist/video.js';
import { runProcess } from '../dist/process.js';
import { recordingArgs } from '../dist/recorder.js';

test('Recorder uses the timeout supported by the installed RTSP demuxer', { skip: process.env.RUN_MEDIA_TESTS !== 'true' }, async () => {
  const help = await runProcess('ffmpeg', ['-hide_banner', '-h', 'demuxer=rtsp'], 15000);
  const args = recordingArgs({videoMode:'fixed',durationSeconds:15,rtspUrl:'rtsp://192.0.2.1/stream'}, '/tmp/test.mp4.part');
  assert.ok(args.includes('-timeout')); assert.ok(!args.includes('-rw_timeout'));
  assert.match(help, /-timeout\s+<int64>/);
  assert.equal(args[args.indexOf('-timeout')+1], '15000000');
  assert.equal(args[args.indexOf('-t')+1], '15');
  const motion = recordingArgs({videoMode:'motion',maxDurationSeconds:300,rtspUrl:'rtsp://192.0.2.1/stream'}, '/tmp/test.mp4.part');
  assert.equal(motion[motion.indexOf('-t')+1], '300');
});

test('FFmpeg real media conversion keeps archive and creates bounded H264 MP4', { skip: process.env.RUN_MEDIA_TESTS !== 'true' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'imou-media-'));
  const config = loadConfig({
    CAMERA_1_HOST:'192.0.2.1', CAMERA_1_USERNAME:'test', CAMERA_1_PASSWORD:'test', CAMERA_1_RTSP_URL:'rtsp://192.0.2.1/test',
    TELEGRAM_BOT_TOKEN:'test', TELEGRAM_CHAT_ID:'-123', DATA_PATH:root, VIDEO_ENABLED:'true',
    TELEGRAM_VIDEO_ENABLED:'true', LOCAL_VIDEO_ENABLED:'true', TELEGRAM_VIDEO_MAX_SECONDS:'2', MIN_FREE_DISK_BYTES:'0'
  });
  const store = new MediaStore(config); await store.initialize();
  const original = await store.allocate(config.cameras[0], 'video');
  await runProcess('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x240:rate=15','-t','4','-c:v','mpeg4', original], 30000);
  const job = await store.register(config.cameras[0],'video',original,Date.now());
  const originalSize = (await stat(original)).size;
  const sentFile = await prepareVideo(job,config);
  assert.notEqual(sentFile,original); assert.equal((await stat(original)).size,originalSize);
  const probe = JSON.parse(await runProcess('ffprobe',['-v','error','-show_entries','stream=codec_name:format=duration','-of','json',sentFile],30000));
  assert.equal(probe.streams[0].codec_name,'h264'); assert.ok(Number(probe.format.duration)<=2.2);
  const compatible = {...job, file:sentFile, preparedFile:undefined, bytes:(await stat(sentFile)).size};
  assert.equal(await prepareVideo(compatible,config),sentFile);
  await store.persist(job); const restored = new MediaStore(config); await restored.initialize();
  assert.equal(restored.jobs.get(job.id).preparedFile,sentFile);
  job.telegram='sent'; await store.persist(job); await store.cleanup();
  await access(original); await assert.rejects(access(sentFile));
});
