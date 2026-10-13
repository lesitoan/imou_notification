// Run inside the image with a real camera env. Does not send Telegram or Drive.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './dist/config.js';
import { MediaStore } from './dist/storage.js';
import { Recorder } from './dist/recorder.js';
import { captureSnapshot } from './dist/snapshot.js';
import { runProcess } from './dist/process.js';

const root = await mkdtemp('/tmp/imou-diagnostic-');
for (const mode of ['fixed', 'motion']) {
  const settings = loadConfig({...process.env, DATA_PATH:root, RECORDING_PATH:root+'/recordings', SNAPSHOT_PATH:root+'/snapshots',
    VIDEO_ENABLED:'true', VIDEO_MODE:mode, VIDEO_DURATION_SECONDS:'3', VIDEO_MAX_DURATION_SECONDS:'20',
    TELEGRAM_PHOTO_ENABLED:'false', TELEGRAM_VIDEO_ENABLED:'false', DRIVE_UPLOAD_ENABLED:'false', LOCAL_VIDEO_ENABLED:'true', LOCAL_SNAPSHOT_ENABLED:'false', MIN_FREE_DISK_BYTES:'0'});
  const store = new MediaStore(settings); await store.initialize();
  let resolveClosed; const closed = new Promise(resolve => {resolveClosed=resolve;});
  const recorder = new Recorder(settings.cameras[0], store, resolveClosed);
  await recorder.start(Date.now());
  if (mode==='motion') {await delay(7000); await recorder.stop();}
  const timeout = setTimeout(()=>{void recorder.stop();},30000);
  const success = await closed; clearTimeout(timeout); assert.equal(success,true);
  const job = [...store.jobs.values()].sort((a,b)=>b.startedAt-a.startedAt)[0];
  const probe = JSON.parse(await runProcess('ffprobe',['-v','error','-show_entries','stream=codec_name:format=duration','-of','json',job.file],30000));
  assert.ok(Number(probe.format.duration)>0); if(mode==='fixed') assert.ok(Number(probe.format.duration)<5);
  console.log(JSON.stringify({mode,bytes:job.bytes,codec:probe.streams[0].codec_name,duration:probe.format.duration}));
  if(mode==='fixed') {const jpeg=await captureSnapshot(settings.cameras[0]); assert.ok(jpeg.length>100); await writeFile(root+'/snapshot.jpg',jpeg); console.log('Snapshot capture passed; no notification sent');}
}
