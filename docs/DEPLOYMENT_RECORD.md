# Deployment records

## Release 2.0.0 — 13/10/2026

- Branch: codex/unify-camera-service
- Source commit: 8da580d; Git tag: v2.0.0
- Docker Hub: lesitoan/imou-notifi:2.0.0
- Manifest digest: sha256:f65e9ff3eddb0e048600e8b66c4392f4426beaae733d4d379c0e43144f59e0b1
- Final local image ID: sha256:b5e8c759fe4876aef1c43162a272befab1473bbc88a8695b04d6a8b5f2ae85c1
- Linux validation: 11/11 tests passed, including real FFmpeg H264 conversion and duration limit.
- Debian backup: /home/toandev/imou-recorder/rollback-20261013-161005
- Existing image rollback tag: lesitoan/imou-recorder:rollback-pre-unified
- Runtime env was migrated from the running container, because disk .env was stale (camera .1.2 instead of actual .1.10).
- Bot read-only preflight: member of camera_DN (-5405309944), actual runtime token can read the group.

Deployment verification is appended below after cutover.

## Paused — 13/10/2026, approximately 16:18

User requested pausing and updating the handoff. No production cutover occurred. Old Debian container, Compose and backup cron remain active.

The release 2.0.0 image was pushed/pulled, but the real RTSP camera diagnostic FAILED with `Option rw_timeout not found` in Recorder FFmpeg input options. The Linux synthetic conversion suite passed 11/11, but did not cover a real RTSP Recorder. Do not deploy this release before fixing and verifying Recorder; publish a suitable patch version after testing.

Server log: /home/toandev/imou-recorder/camera-diagnostic.log. Fixed recording failed; snapshot and motion-stop stages were not reached. Diagnostic sends no notifications/backups and uses temporary storage.

Latest source commit: 8da580d, local tag v2.0.0. .1.env local/server now uses actual camera 192.168.1.10 migrated from effective container env. Rollback Compose uses runtime.env, because original disk .env was stale. See latest section of HANDOFF_REVIEW_2026-10-13.md for completed work and next tasks.

## Patch 2.0.1 — verified recorder

RTSP FFmpeg timeout corrected to `-timeout 15000000`, confirmed against installed demuxer help. Linux suite passed 12/12, including RTSP option regression.

Real camera diagnostic on Debian with the patched recorder module and the same FFmpeg runtime passed: fixed 3.049s/272663 bytes (HEVC); snapshot capture passed; motion stop produced 6.598s/1132930 bytes (HEVC). No Telegram/Drive messages were sent by diagnostic. Production cutover follows publication of the patch.

### Published patch 2.0.1

- Source commit: fad9e78; local Git tag v2.0.1.
- Hub image: lesitoan/imou-notifi:2.0.1.
- Manifest digest: sha256:f18a8d65b7ef7f57bf4036c29114ae7cfdd231d22741357500a787b27b37e7f9.
- Local image ID: sha256:e97759a6c13c0e131078ebc3161bda7e1f7a3891f39c34afc6ee756f359134f7.
- Debian pulled the matching digest; .1.env local/server pins the tag and digest.
- Preflight final image: data write permissions and rclone config/remote validated.

### Debian cutover — 13/10/2026, 16:43

Cutover exited 0. Container imou-recorder now runs 2.0.1 pinned to the published digest, with existing data volume, local retention 3 days, motion post-delay 10s/max segment300s, Telegram photos directed to camera_DN and Telegram video disabled.

Initial startup recovered 846 media records, zero Telegram video backlog; ONVIF connected to 192.168.1.10. Worker successfully backed up snapshots and videos to Drive. Only old Imou backup cron was removed, and its matching transfer/script processes were stopped. Other cron entries/containers were retained. Old image, effective env and crontab remain in rollback backup.

### Drive throttle and restart verification

After migration the large legacy backlog briefly hit Google Drive project queries-per-minute quota. Added env-only `RCLONE_TPSLIMIT=0.5`, `RCLONE_TPSLIMIT_BURST=1`; rclone logged the active limiter. Restart recovered 826 records and no Telegram replay. Subsequent video and snapshot backups succeeded; container remained running with restart count0. Retention removed old files only after their deliveries completed, while pending files remained protected.

Final production config keeps photo trigger recording_start, motion post-delay10s/max300s, local video/snapshot3days, Drive enabled and Telegram video disabled. Photos target group camera_DN. Countryside deployment is unchanged; local .2.env is ready for version2.0.1 and two fixed15s cameras.

### Live camera event verification

User confirmed walking past the Debian camera. Production logs recorded motion START at 16:51:40, photo sent successfully at16:51:45; END16:52:10 stopped recording at16:52:20 (10-second post-delay). Completed clip was1971910bytes. A new session START16:52:27 sent another photo at16:52:33. No ONVIF/source algorithm change was needed; events arrived during continued observation.

The final published image itself also passed real camera diagnostics (not just a bind-mounted candidate): fixed3.000s/270098bytes HEVC, snapshot passed, motion stop6.648s/663606bytes; exit0.

### Final result — 13/10/2026, 16:56

Production video from the first live event was successfully backed up at16:55:51. Metadata confirmed the new snapshot and video `drive=sent`, both with driveAttempts0. The clip remained local according to retention3days. Second photo was already sent to Telegram and its Drive copy remained pending behind the current job.

A motion END16:55:32 followed by START16:55:35 resumed the active session inside the10s stop delay; no additional photo was emitted, matching the preserved Debian policy. Deployment succeeded. Remaining legacy backups continue in the durable worker; no follow-up automation was created.

Countryside Ubuntu is unchanged. The next user-authorized deployment can use the same2.0.1 image with .2.env.

## Countryside cutover — 13/10/2026, 17:07

Deployed Ubuntu **100.79.114.23** at `/home/toandev/imou-snapshot-que`, retaining service/container/project `imou-snapshot-que`. Image `lesitoan/imou-notifi:2.0.1` is pinned to digest `sha256:f18a8d65b7ef7f57bf4036c29114ae7cfdd231d22741357500a787b27b37e7f9`.

Effective old container env was backed up and migrated; camera credentials and Telegram countryside group were preserved. New `.2.env` was downloaded to the local workspace without displaying or committing secrets. Backup `/home/toandev/imou-snapshot-que/rollback-20261013-100506` contains old Compose/env, effective runtime.env, image-id, and absolute rollback Compose. Old image tag: `lesitoan/imou-snapshot:rollback-pre-unified`.

Profile: Bếp `192.168.1.3`, Sân `192.168.1.4`; photo `motion_start`, video fixed15s; Telegram photos/videos enabled; local video/snapshot archive disabled; Drive disabled including both destinations. Bot read-only membership check confirmed `imou_notifi_bot` is a member of group `camera_1` (`-5568762006`). The old and new compiled ONVIF camera modules have identical SHA256 `c9c274a5d90958665a01c9557748596a32fa3abea9d06bda841bdf50a32ce706`.

Startup at17:07:28 connected both cameras and received MOTION END from both. Container running, restart count0; idle memory15.54MiB at inspection. Host had2.8GiB available RAM and40GiB free disk. New data directory had no media/job files after startup. Videos will use temporary durable queue storage and be deleted after terminal delivery; there is no local archive. Queue20jobs/500MiB, send interval5s, pending max24h. Photos keep their existing direct delivery priority.

**Live motion/photo/video delivery verification was skipped at the user's explicit request because they are away. Actual 15s video delivery and post-upload cleanup on the countryside cameras are not yet verified.** Deployment/configuration and ONVIF connectivity are confirmed. No Debian changes or source/image rebuild were performed in this countryside deployment.
