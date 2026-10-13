# Imou Notifi

**ONVIF camera motion notifications for Telegram, with snapshots, video clips, and optional storage.**

**Documentation version: 2.0.1** · Docker image: [lesitoan/imou-notifi](https://hub.docker.com/r/lesitoan/imou-notifi)

Imou Notifi is a Node.js service that receives ONVIF events, captures snapshots, and records video from RTSP streams. It supports multiple cameras, a persistent video delivery queue, local retention, and Google Drive backups. All behavior is configured through environment variables.

Deploy with Docker to use the bundled FFmpeg and rclone tools, or run directly from source.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Telegram Setup](#telegram-setup)
- [Motion Handling](#motion-handling)
- [Configuration Reference](#configuration-reference)
- [Usage](#usage)
- [Google Drive Setup](#google-drive-setup)
- [Queue and File Lifecycle](#queue-and-file-lifecycle)
- [Operations and Updates](#operations-and-updates)
- [Troubleshooting](#troubleshooting)
- [Running and Building from Source](#running-and-building-from-source)

## Features

| Feature | Behavior |
|---|---|
| Multiple cameras | Supports 1–32 cameras, each with independent motion state and recording sessions. |
| Motion events | Receives ONVIF START/END events and reconnects after connection errors. |
| Telegram snapshots | Captures JPEG snapshots over RTSP and sends them directly with the camera name and detection time. |
| Fixed video clips | Records a clip starting at detection, such as 15 seconds, without a pre-event buffer. |
| Motion recording | Records from START, waits after END, then stops. Splits recordings at the maximum segment duration. |
| Video queue | Sends videos sequentially, retries with backoff, and restores pending jobs after restarts. |
| Snapshot priority | Sends snapshots directly; the video worker waits while snapshots are being processed. |
| Local storage | Independently enables snapshot and video retention, with automatic cleanup. |
| Google Drive | Independently enables snapshot and video uploads through rclone, with retries. |
| Per-camera settings | Overrides supported global options using the `CAMERA_N_` prefix. |

Original recordings are **MP4 files using the camera's video codec, without audio**. Telegram delivery may create a smaller H.264 copy without changing the original archive.

The service does not provide a web interface, continuous 24/7 recording, or image-based person recognition. Motion detection is performed by the camera.

## Requirements

- Docker Engine with Docker Compose, or Docker Desktop using Linux containers.
- The published 2.0.1 image targets **Linux amd64/x86_64**. ARM hosts require a compatible image or a build from source.
- A camera supporting ONVIF events and RTSP. The service has been used with Imou cameras; other devices require event compatibility checks.
- Motion detection enabled on the camera. Notifications in the manufacturer's app do not necessarily mean the camera emits ONVIF events.
- Network access from the host/container to the camera's ONVIF and RTSP ports. VPN connections require a route to the camera network.
- Internet access to Telegram and, when enabled, Google Drive.
- Disk space for temporary video files, even when local retention is disabled. H.265/HEVC to H.264 conversion uses additional CPU and disk space; resource usage depends on the streams and event frequency.

When cameras are accessed through a VPN or another network, configure routing and firewall rules for both ONVIF and RTSP.

Install Docker using the official instructions for [Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Debian](https://docs.docker.com/engine/install/debian/), or [Docker Desktop](https://docs.docker.com/desktop/). Commands below use a Linux shell; Windows users can use WSL.

```sh
docker --version
docker compose version
```

Docker commands assume the current user has permission to access Docker. Otherwise, use `sudo docker ...` or configure access as described in the installation documentation.

## Quick Start

**Node.js, FFmpeg, and rclone do not need to be installed on the host when using the Docker image.** The image includes these tools. You only need a Compose file, an environment file, and storage directories.

### 1. Create the project directory

```sh
mkdir -p imou-notifi
cd imou-notifi
mkdir -p data secrets
sudo chown -R 1000:1000 data secrets
sudo chmod 700 data secrets
```

The container runs as **UID/GID 1000** and requires write access to `data`. Apply equivalent permissions if you change `APP_DATA_DIR`.

### 2. Create compose.yaml

Use the repository's `compose.yaml`, or create the following file when deploying only the published image:

```yaml
services:
  imou-notifi:
    image: ${APP_IMAGE:-lesitoan/imou-notifi:2.0.1}
    container_name: ${APP_CONTAINER_NAME:-imou-notifi}
    restart: unless-stopped
    init: true
    stop_grace_period: 60s
    env_file:
      - ${APP_ENV_FILE:-.env}
    environment:
      TZ: Asia/Ho_Chi_Minh
      DATA_PATH: /data
      RECORDING_PATH: /data/recordings
      SNAPSHOT_PATH: /data/snapshots
    volumes:
      - ${APP_DATA_DIR:-./data}:/data
      - ${APP_SECRETS_DIR:-./secrets}:/run/secrets
```

No inbound container ports are required. The service connects to cameras and delivery services through outbound connections.

### 3. Configure the camera and Telegram

Create `.env` alongside `compose.yaml`. When using the repository, copy the complete template:

```sh
cp .env.example .env
```

The following minimal configuration sends snapshots and 15-second videos from one camera to Telegram:

```dotenv
SITE_ID=camera-site
CAMERA_COUNT=1
CAMERA_1_HOST=192.168.1.100
CAMERA_1_PORT=80
CAMERA_1_USERNAME=admin
CAMERA_1_PASSWORD=YOUR_ONVIF_PASSWORD
CAMERA_1_RTSP_URL=rtsp://admin:YOUR_RTSP_PASSWORD@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0
CAMERA_1_NAME=Camera 01

TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_CHAT_ID
TELEGRAM_PHOTO_ENABLED=true
PHOTO_TRIGGER=motion_start

VIDEO_ENABLED=true
VIDEO_MODE=fixed
VIDEO_DURATION_SECONDS=15
TELEGRAM_VIDEO_ENABLED=true

LOCAL_VIDEO_ENABLED=false
LOCAL_SNAPSHOT_ENABLED=false
DRIVE_UPLOAD_ENABLED=false
VIDEO_PENDING_MAX_AGE_HOURS=24
TZ=Asia/Ho_Chi_Minh
```

Replace all `YOUR_*` values and the camera address before starting. Unspecified variables use the defaults in the [configuration reference](#configuration-reference). `.env.example` lists the available standard settings.

```sh
chmod 600 .env
```

**Camera credentials:** ONVIF and RTSP passwords may differ. The example RTSP path is for Imou/Dahua cameras; use the stream path provided by your device. The URL hostname must match `CAMERA_1_HOST`.

**Environment format:** save files as UTF-8 and use `true`/`false` for booleans. Empty values use defaults unless the field is required. Percent-encode special characters such as `@`, `#`, and `%` in RTSP URL credentials; keep the ONVIF password unchanged. Use single quotes for environment values containing `$` or `#`, for example `CAMERA_1_PASSWORD='your$secret#value'`.

The `.env` file contains credentials and is excluded from Git. Add any custom environment filename to `.gitignore`.

### 4. Pull and start

```sh
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f --tail=100
```

Startup logs include `Imou Notifi 2.0.1 starting` and `connected; waiting for ONVIF events` for each camera. Depending on enabled features, motion events produce `MOTION START`, `snapshot sent to Telegram`, `recording started`, `video completed`, and `video sent to Telegram` messages.

Compose automatically reads `.env` in the project directory. To use another configuration file, set `APP_ENV_FILE` in that file and run `docker compose --env-file <config.env> ...`. The `--env-file` option provides Compose variables; `APP_ENV_FILE` selects the file passed into the container.

## Telegram Setup

### Create a bot and configure the destination

1. Open [@BotFather](https://t.me/BotFather), send `/newbot`, and choose a name and username.
2. Set the issued token as `TELEGRAM_BOT_TOKEN`.
3. For a group, add the bot and allow it to send messages, photos, and videos.
4. For a private chat, open the bot and send `/start` first.

Privacy mode does not need to be disabled to send notifications. The bot must have the permissions required by the group's settings.

One bot can be used by multiple instances with different groups. Each instance uses **one token and one chat ID** for all its cameras. Per-camera chat IDs and forum topic configuration are not supported.

## Motion Handling

### Snapshots

- `motion_start`: captures a snapshot when motion becomes active. Repeated START events do not create new snapshots. A new snapshot is skipped if the previous snapshot for the same camera is still being processed.
- `recording_start`: captures a snapshot when a recording session begins. A START during the stop delay in `motion` mode continues the existing session without another snapshot.
- Snapshots are sent directly, outside the video queue, and do not have persistent retries. Delivery errors are logged.
- `PHOTO_FAILURE_ACTION=text` sends a text fallback only when **snapshot capture fails**. It does not handle Telegram photo upload failures.

### Fixed video clips

A START begins a clip of `VIDEO_DURATION_SECONDS`. END does not stop it early. Another START during the clip does not extend it or create an overlapping clip. Snapshots continue to follow their separate policy.

For example, START at second 0, END at second 3, and START at second 5 produce one clip covering approximately seconds 0–15. After that clip closes, recording does not restart just because motion remains `true`; a new END→START transition is required.

### Motion recording

A START begins recording. END starts the `VIDEO_POST_DELAY_SECONDS` timer. A START during this delay cancels the stop and continues the clip. Otherwise, recording stops when the delay expires.

With a 10-second delay, START at second 0 and END at second 20 stop recording around second 30. A START at second 25 continues recording. At `VIDEO_MAX_DURATION_SECONDS`, the segment closes and a new segment starts if motion is still active, within the same session. Segment rotation does not emit another `recording_start` snapshot.

Actual durations may vary slightly due to RTSP startup, timestamps, keyframes, or connection failures. There is no pre-event buffer: recording begins after the event is received and the stream opens.

## Configuration Reference

**Defaults below are application defaults when a variable is omitted**, using the current `CAMERA_N_*` format. The Quick Start explicitly enables video and Telegram video, and sets a 24-hour pending-job lifetime, overriding those defaults. Time units are indicated by variable names; sizes are in bytes unless stated otherwise.

### Site and cameras

`N` is the camera index from 1 to `CAMERA_COUNT`, for example `CAMERA_1_HOST`.

| Variable | Default | Description |
|---|---|---|
| `SITE_ID` | `camera-site` | Site label used in configuration and logs. Allows ASCII letters, digits, `_`, and `-`. Does not select a Telegram group. |
| `CAMERA_COUNT` | 2 when `CAMERA_2_HOST` exists; otherwise 1 | Integer from 1 to 32. Explicit configuration is recommended. |
| `CAMERA_N_HOST` | Required | Reachable camera IP or hostname; must match the RTSP URL hostname. |
| `CAMERA_N_PORT` | `80` | ONVIF port, separate from the RTSP port. |
| `CAMERA_N_USERNAME` | Required | ONVIF username. |
| `CAMERA_N_PASSWORD` | Required | ONVIF password. |
| `CAMERA_N_RTSP_URL` | Required | Complete RTSP URL, including credentials and stream path. |
| `CAMERA_N_NAME` | `Camera N` | Camera name used in Telegram messages and logs; supports Unicode. |
| `CAMERA_RECONNECT_SECONDS` | `10` | Delay before reconnecting to ONVIF after an error. |
| `SNAPSHOT_TIMEOUT_SECONDS` | `20` | Timeout for capturing a snapshot through FFmpeg. |

### Telegram and snapshots

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Required for Telegram delivery | BotFather token. Optional when all cameras disable Telegram snapshots and videos. |
| `TELEGRAM_CHAT_ID` | Required for Telegram delivery | Destination group or chat ID, shared by all cameras in the instance. |
| `TELEGRAM_PHOTO_ENABLED` | `true` | Enables Telegram snapshots. Disabling it does not disable local or Drive snapshot storage. |
| `PHOTO_TRIGGER` | `motion_start` | `motion_start` or `recording_start`; see [Motion Handling](#motion-handling). |
| `PHOTO_FAILURE_ACTION` | `log` | `log`: log capture failures. `text`: send a text fallback when Telegram snapshots are enabled. |

### Video and Telegram queue

| Variable | Default | Description |
|---|---|---|
| `VIDEO_ENABLED` | `false` | Enables recording. Required for any Telegram/local/Drive video destination or `recording_start` snapshots. |
| `VIDEO_MODE` | `fixed` | `fixed`: fixed duration; `motion`: START/END with a stop delay. |
| `VIDEO_DURATION_SECONDS` | `15` | Clip duration in `fixed` mode. Does not control `motion` mode. |
| `VIDEO_POST_DELAY_SECONDS` | `10` | Delay after END in `motion` mode. A START during the delay cancels the stop. |
| `VIDEO_MAX_DURATION_SECONDS` | `300` | Maximum duration of each `motion` segment, not the entire session. |
| `TELEGRAM_VIDEO_ENABLED` | `false` | Queues completed videos for Telegram delivery. |
| `VIDEO_SEND_INTERVAL_SECONDS` | `5` | Minimum wait after the latest Telegram request before starting a video upload. Counts snapshot/text/video requests in this instance; does not delay snapshots. |
| `VIDEO_QUEUE_MAX_SIZE` | `20` | Maximum pending Telegram videos across all cameras. |
| `VIDEO_QUEUE_MAX_BYTES` | `524288000` | Maximum total size of pending original videos, 500MiB. Excludes archives and transcoded copies. |
| `VIDEO_PENDING_MAX_AGE_HOURS` | `72` | Maximum pending-job age since registration. Applies to Telegram and Drive, including Drive snapshots. Quick Start uses 24 hours. |
| `VIDEO_UPLOAD_MAX_ATTEMPTS` | `10` | Maximum failed Telegram video attempts before marking the job failed. Permanent errors may stop earlier. Does not limit Drive retries. |
| `TELEGRAM_VIDEO_MAX_BYTES` | `50331648` | Maximum upload size, 48MiB. Larger files are transcoded; exceeding the limit afterward causes an error/retry. |
| `TELEGRAM_VIDEO_MAX_SECONDS` | `60` | Duration limit for the Telegram copy. Long clips use the beginning of the recording; the archive remains unchanged. |
| `TELEGRAM_VIDEO_UPLOAD_TIMEOUT_SECONDS` | `180` | Upload request timeout, excluding total queue and transcoding time. |

### Local storage, cleanup, and paths

| Variable | Default | Description |
|---|---|---|
| `LOCAL_VIDEO_ENABLED` | `false` | Retains original videos after delivery according to retention. When false, files are kept only as needed for delivery. |
| `LOCAL_SNAPSHOT_ENABLED` | `false` | Retains snapshots. When both local and Drive snapshot storage are disabled, snapshots are processed in RAM for delivery. |
| `LOCAL_RETENTION_DAYS` | `3` | Archive retention measured from file completion. Does not delete Drive files. |
| `CLEANUP_INTERVAL_MINUTES` | `60` | Periodic cleanup interval. Cleanup also runs at startup and after delivery work. |
| `PROTECT_PENDING_DELIVERIES` | `true` | Protects pending files beyond retention until delivery terminates or the job expires. When false, retention may delete pending files. |
| `MIN_FREE_DISK_BYTES` | `268435456` | Free-space reserve of 256MiB. Blocks new file allocation below the threshold. `0` disables that check; transcoding still needs room for its output. |
| `DATA_PATH` | `./data` when running from source | Application data directory. The image and Compose use `/data`. Job metadata lives in `state`; transcoded copies live in `telegram-video` within this directory. |
| `RECORDING_PATH` | `DATA_PATH/recordings` | Recording directory. Compose sets `/data/recordings`. |
| `SNAPSHOT_PATH` | `DATA_PATH/snapshots` | Snapshot directory. Compose sets `/data/snapshots`. |
| `TZ` | Captions/folders fall back to `Asia/Ho_Chi_Minh` | Time zone for captions and date folders. ISO logs use UTC. Compose sets `Asia/Ho_Chi_Minh`. |

The Compose `environment` section **overrides environment-file values** for `DATA_PATH`, `RECORDING_PATH`, `SNAPSHOT_PATH`, and `TZ`. To change those values under Compose, edit that section and adjust mounts as needed. Changing the storage location on the **host** usually only requires `APP_DATA_DIR`.

### Google Drive and rclone

| Variable | Default | Description |
|---|---|---|
| `DRIVE_UPLOAD_ENABLED` | `false` | Global Drive switch. When false, no uploads occur even if destination flags are true. |
| `DRIVE_UPLOAD_VIDEOS` | `true` | Uploads original videos when Drive is enabled. Requires recording to be enabled. |
| `DRIVE_UPLOAD_SNAPSHOTS` | `true` | Saves snapshots for upload when Drive is enabled. |
| `DRIVE_REMOTE` | Required when Drive is enabled | Destination such as `gdrive:Camera_Backup`; the remote name must exist in the rclone configuration. |
| `DRIVE_RCLONE_CONFIG` | Required when Drive is enabled | Configuration path **inside the container**, usually `/run/secrets/rclone.conf`. |
| `DRIVE_UPLOAD_INTERVAL_SECONDS` | `300` | Wait before scanning again when no job is ready. A backlog is processed without a 300-second delay between files. |
| `DRIVE_UPLOAD_BWLIMIT` | `2M` | rclone bandwidth limit, approximately 2MiB/s, not 2Mbit/s. |
| `DRIVE_UPLOAD_TIMEOUT_SECONDS` | `300` | Timeout for uploading one job, including rclone's internal retries. |
| `RCLONE_TPSLIMIT` | Not set by application code; template uses `0.5` | Inherited rclone variable limiting HTTP transaction rate, not files per second. |
| `RCLONE_TPSLIMIT_BURST` | Not set by application code; template uses `1` | Burst size for the rclone transaction limiter. |

Drive delivery retries with backoff and prioritizes new files over legacy files. Pending jobs also expire according to the configured maximum age. See rclone's [bandwidth limit](https://rclone.org/docs/#bwlimit-bandwidth-spec), [TPS limit](https://rclone.org/docs/#tpslimit-float), and [environment variables](https://rclone.org/docs/#environment-variables).

### Docker Compose

`APP_*` variables configure Compose rather than camera behavior.

| Variable | Compose default | Description |
|---|---|---|
| `APP_IMAGE` | `lesitoan/imou-notifi:2.0.1` | Image and tag; may include a pinned digest. |
| `APP_ENV_FILE` | `.env` | Environment file passed into the container. Match the file selected with `--env-file` when using a custom file. |
| `APP_CONTAINER_NAME` | `imou-notifi` | Container name; must be unique for multiple instances on one host. |
| `APP_DATA_DIR` | `./data` | Host directory mounted at `/data`, preserving jobs and archives across container recreation. |
| `APP_SECRETS_DIR` | `./secrets` | Host directory mounted at `/run/secrets`, containing the rclone configuration. |

### Per-camera overrides

`CAMERA_N_<VARIABLE>` takes precedence over its global value. Only the following settings support this prefix:

| Category | Variables supporting CAMERA_N_ |
|---|---|
| Snapshots | `TELEGRAM_PHOTO_ENABLED`, `PHOTO_TRIGGER`, `PHOTO_FAILURE_ACTION` |
| Video | `VIDEO_ENABLED`, `VIDEO_MODE`, `VIDEO_DURATION_SECONDS`, `VIDEO_POST_DELAY_SECONDS`, `VIDEO_MAX_DURATION_SECONDS`, `TELEGRAM_VIDEO_ENABLED` |
| Storage destinations | `LOCAL_VIDEO_ENABLED`, `LOCAL_SNAPSHOT_ENABLED`, `DRIVE_UPLOAD_VIDEOS`, `DRIVE_UPLOAD_SNAPSHOTS` |

For example, configure the second camera to send snapshots without recording:

```dotenv
CAMERA_2_VIDEO_ENABLED=false
CAMERA_2_TELEGRAM_VIDEO_ENABLED=false
CAMERA_2_LOCAL_VIDEO_ENABLED=false
CAMERA_2_DRIVE_UPLOAD_VIDEOS=false
CAMERA_2_PHOTO_TRIGGER=motion_start
```

Token/chat ID, the global Drive switch, queue settings, retention, paths, reconnect timing, and snapshot timeout do not support per-camera overrides. Global values must remain valid even when a camera overrides them.

### Legacy compatibility

The application accepts `CAMERA_HOST`, `CAMERA_PORT`, `CAMERA_USERNAME`, `CAMERA_PASSWORD`, `CAMERA_RTSP_URL`, and `CAMERA_NAME` for the first camera **when CAMERA_1_HOST is absent**. Legacy defaults differ: video, local snapshots, and local video are enabled; snapshot trigger is `recording_start`, fallback is `text`, and video mode is `motion`.

`RECORDING_POST_DELAY_SECONDS` is a fallback for `VIDEO_POST_DELAY_SECONDS`; `RETENTION_DAYS` is a fallback for `LOCAL_RETENTION_DAYS`. New installations should use the current names and an explicit camera count.

## Usage

Apply these settings to an environment file with camera and Telegram credentials already configured. Update or remove conflicting per-camera overrides.

### Snapshots only

```dotenv
TELEGRAM_PHOTO_ENABLED=true
PHOTO_TRIGGER=motion_start
VIDEO_ENABLED=false
TELEGRAM_VIDEO_ENABLED=false
LOCAL_VIDEO_ENABLED=false
LOCAL_SNAPSHOT_ENABLED=false
DRIVE_UPLOAD_ENABLED=false
DRIVE_UPLOAD_VIDEOS=false
DRIVE_UPLOAD_SNAPSHOTS=false
```

### Snapshots and 15-second videos without archives

```dotenv
TELEGRAM_PHOTO_ENABLED=true
PHOTO_TRIGGER=motion_start
VIDEO_ENABLED=true
VIDEO_MODE=fixed
VIDEO_DURATION_SECONDS=15
TELEGRAM_VIDEO_ENABLED=true
LOCAL_VIDEO_ENABLED=false
LOCAL_SNAPSHOT_ENABLED=false
DRIVE_UPLOAD_ENABLED=false
VIDEO_PENDING_MAX_AGE_HOURS=24
```

### Snapshots, motion recording, three-day retention, and Drive

```dotenv
TELEGRAM_PHOTO_ENABLED=true
PHOTO_TRIGGER=recording_start
PHOTO_FAILURE_ACTION=text
VIDEO_ENABLED=true
VIDEO_MODE=motion
VIDEO_POST_DELAY_SECONDS=10
VIDEO_MAX_DURATION_SECONDS=300
TELEGRAM_VIDEO_ENABLED=false
LOCAL_VIDEO_ENABLED=true
LOCAL_SNAPSHOT_ENABLED=true
LOCAL_RETENTION_DAYS=3
DRIVE_UPLOAD_ENABLED=true
DRIVE_UPLOAD_VIDEOS=true
DRIVE_UPLOAD_SNAPSHOTS=true
DRIVE_REMOTE=gdrive:Camera_Backup
DRIVE_RCLONE_CONFIG=/run/secrets/rclone.conf
VIDEO_PENDING_MAX_AGE_HOURS=72
```

### Adding cameras

Increase `CAMERA_COUNT` and add connection settings for each camera, using consecutive indices starting at 1:

```dotenv
CAMERA_COUNT=2
CAMERA_2_HOST=192.168.1.101
CAMERA_2_PORT=80
CAMERA_2_USERNAME=admin
CAMERA_2_PASSWORD=YOUR_ONVIF_PASSWORD
CAMERA_2_RTSP_URL=rtsp://admin:YOUR_RTSP_PASSWORD@192.168.1.101:554/cam/realmonitor?channel=1&subtype=0
CAMERA_2_NAME=Camera 02
```

New cameras inherit global settings. Use [per-camera overrides](#per-camera-overrides) to select recording modes or destinations independently. Apply changes with `docker compose up -d`.

### Multiple instances

Each instance uses its own configuration, data directory, and Telegram destination. Instances may share a bot with different `TELEGRAM_CHAT_ID` values. Create a deployment directory and `.env` for each instance.

On the same host, use separate deployment directories or Compose projects, unique container names, and separate data directories. Multiple instances monitoring the same camera can produce duplicate notifications. Use separate Drive destinations to avoid path collisions.

## Google Drive Setup

### 1. Create a remote

Install [rclone](https://rclone.org/install/) on a machine with a browser, then run:

```sh
rclone config
```

Create a remote named `gdrive`, select Google Drive, and complete OAuth authentication. For a headless server, follow the authorization procedure using another machine in the [rclone Drive documentation](https://rclone.org/drive/). The Docker image includes rclone for uploads; this step prepares an authenticated configuration.

```sh
rclone config file
```

This command shows the configuration file location.

### 2. Copy the configuration to the server

Copy the authenticated configuration to `secrets/rclone.conf` in the deployment directory, then set permissions:

```sh
sudo chown 1000:1000 secrets secrets/rclone.conf
sudo chmod 700 secrets
sudo chmod 600 secrets/rclone.conf
```

The secrets mount must be writable so rclone can refresh OAuth tokens. Do not mount it read-only or place the configuration in the media backup directory.

### 3. Enable and verify uploads

```dotenv
DRIVE_UPLOAD_ENABLED=true
DRIVE_UPLOAD_VIDEOS=true
DRIVE_UPLOAD_SNAPSHOTS=true
DRIVE_REMOTE=gdrive:Camera_Backup
DRIVE_RCLONE_CONFIG=/run/secrets/rclone.conf
RCLONE_TPSLIMIT=0.5
RCLONE_TPSLIMIT_BURST=1
```

Video uploads require `VIDEO_ENABLED=true`. Local retention may be disabled; files are still kept temporarily until delivery terminates.

```sh
docker compose up -d
docker compose exec imou-notifi rclone listremotes --config /run/secrets/rclone.conf
docker compose exec imou-notifi rclone lsd gdrive: --config /run/secrets/rclone.conf
```

`listremotes` should include `gdrive:`. `lsd` checks read access and may return an empty list when no folders exist. Files are copied to `DRIVE_REMOTE/recordings/...` or `DRIVE_REMOTE/snapshots/...`. The application does not sync or delete remote files and does not enforce retention on Drive.

If another task backs up the same media directory, adjust it to avoid duplicate uploads alongside the Drive worker.

## Queue and File Lifecycle

### Video delivery queue

The queue runs within Node.js and persists its state on the **data volume**. Redis or a message broker is not required. Job records are loaded into RAM; JSON metadata and video content are stored on disk. Uploads read 64KiB chunks instead of loading entire videos into memory. Snapshots use separate buffers with a 10MiB capture limit per image.

One worker sends videos sequentially. Temporary failures retry with backoff; HTTP 429 uses `retry_after`, while permanent 4xx errors usually terminate a job early. If Telegram receives a file but the response is lost, a retry may produce a duplicate. Delivery is not guaranteed to be exactly once.

Snapshots bypass the queue. The worker waits while snapshots are being processed, observes the configured send interval, and tracks recent requests. An upload already in progress is not canceled when a new snapshot arrives. Instances do not share their request counters.

The [Telegram Bot FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this) describes chat and group rate limits. Because snapshots are sent directly, the video queue cannot guarantee that the entire group stays below those limits during snapshot bursts or when multiple applications send messages.

### File lifecycle

```text
data/
├── recordings/<date>/camera-N/   original videos
├── snapshots/<date>/camera-N/    snapshots when local/Drive storage is enabled
├── state/                       JSON job metadata
└── telegram-video/              temporary H.264 copies when needed
```

1. Active recordings use the `.part` extension and are not uploaded.
2. Successful recordings are renamed to `.mp4` and registered with their delivery destinations.
3. When the codec, duration, or size requires conversion, the application creates an H.264 copy at up to 720p/15fps without audio. Long clips use the beginning of the recording. The default 48MiB limit is below the 50MB limit documented for [Bot API sendVideo](https://core.telegram.org/bots/api#sendvideo).
4. With local retention disabled, files and metadata are deleted when all destinations are sent, disabled, or failed, including permanent failures and expired jobs. **Disabling local retention still requires temporary video files on disk.**
5. With local retention enabled, original files remain until retention expires. Transcoded copies are cleaned up separately after delivery.
6. Pending files are protected when configured, but jobs still expire at their maximum age. Cleanup runs periodically and after delivery work rather than at an exact expiration second.

When the Telegram queue reaches its limits, new videos are excluded from Telegram delivery and a message is logged. Local and Drive destinations follow their own settings. The queue budget covers pending original videos, not the entire archive; transcoding uses additional disk space.

Restarts restore jobs from the data volume, but unfinished `.part` clips cannot be recovered after power loss or forced termination. Inactive partial files older than one hour are removed during cleanup. Do not edit or delete `data/state` while the application is running.

## Operations and Updates

### Common commands

```sh
# Status and logs
docker compose ps
docker compose logs -f --tail=100

# Apply updated environment values
docker compose up -d

# Restart with the container's existing environment
docker compose restart

# Stop and start
docker compose stop
docker compose up -d

# Remove containers and networks; bind-mounted data remains on the host
docker compose down
```

`restart` does not reload environment values. Use `up -d` after changing configuration. Keep the project name consistent when using `-p`.

### Upgrades and rollback

1. Back up configuration and any data you need to keep. Record the current image version.
2. Set `APP_IMAGE` to the desired tag and review the changes before upgrading.
3. Pull and recreate the container:

```sh
docker compose pull
docker compose up -d
docker compose logs --tail=100
```

To pin release 2.0.1 exactly:

```dotenv
APP_IMAGE=lesitoan/imou-notifi:2.0.1@sha256:f18a8d65b7ef7f57bf4036c29114ae7cfdd231d22741357500a787b27b37e7f9
```

For rollback, restore the saved Compose/environment configuration and the previous image. Do not run both versions against the same camera simultaneously. Release 2.0.1 fixes the RTSP timeout issue in 2.0.0; use a release containing this fix.

## Troubleshooting

| Symptom | What to check |
|---|---|
| `Missing ...` or container exits | Fill required values and ensure `APP_ENV_FILE` matches the selected `--env-file`. |
| Invalid configuration values | Use `true`/`false`, valid modes, and numeric time/size values ≥1. The disk reserve may be 0. |
| `video destinations require VIDEO_ENABLED=true` | Enable recording or disable every video destination, including camera overrides. Drive video defaults to enabled when the global Drive switch is on. |
| `recording_start requires video` | Enable recording or select `motion_start` snapshots. |
| ONVIF connection or time query failure | Check IP, port, credentials, routing, firewall rules, and ONVIF support. |
| Connected but no START events | Check motion detection and ONVIF event support. Manufacturer-app notifications may use a different mechanism. |
| START received but capture/recording fails | Check RTSP URL, password, stream path, URL encoding, and the camera's connection limit. |
| No new fixed clip while motion stays true | A new END→START transition is required after the previous clip closes. |
| Telegram 401 | Invalid or revoked token. |
| Telegram 403 or chat not found | Bot blocked/not added, insufficient permissions, or incorrect/changed chat ID. |
| Telegram 429 | Allow video retries; reduce traffic or increase the video interval. Snapshots do not retry through the queue. |
| Pending jobs or slow transcoding | Check logs, network access, CPU load from H.265 conversion, and free space. The queue may be yielding to snapshots. |
| `Insufficient disk space` | Increase available space. Transcoding needs the reserve plus the upload-size budget. |
| Permission denied under `/data` | Check mount paths and host directory ownership for UID/GID 1000. |
| Drive startup failure | Check configuration, remote name, permissions, and paths inside the container. |
| Drive quota or OAuth errors | Check transaction limits, tokens, and quotas. The worker retries; reauthorize revoked credentials. |
| Old values after editing env | Use `up -d`; check camera overrides and the Compose `environment` section. |
| `Invalid media state; repair before starting` | Stop the service, back up data, and inspect invalid metadata before repairing it. Do not discard a queue containing needed videos. |

Redact tokens, passwords, and OAuth credentials before sharing logs or configuration. Full `docker compose config` and `docker inspect` output may contain secrets.

## Running and Building from Source

This section requires a source checkout. It is not needed when using the published Docker image.

### Run directly

Install Node.js 22, npm, FFmpeg/ffprobe in `PATH`, and rclone if Drive is enabled.

```sh
npm ci
cp .env.example .env
```

Configure `.env` with host paths: `DATA_PATH=./data`, `RECORDING_PATH=./data/recordings`, and `SNAPSHOT_PATH=./data/snapshots`. Drive configuration must also use a host path. `APP_*` settings apply only to Compose.

```sh
npm run build
npm start
# Development mode:
npm run dev
```

### Build a custom image

```sh
docker build --platform linux/amd64 -t my-imou-notifi:2.0.1 .
```

Set `APP_IMAGE=my-imou-notifi:2.0.1` and run `docker compose up -d` using the locally built image. You can tag and push it to your own Docker Hub namespace.

Development checks:

```sh
npm run typecheck
npm test
```

The suite uses fake configuration and does not send real notifications. Device connectivity and live events require separate verification. Environment files, media, and secrets are excluded from Git and the build context by the project's ignore rules.
