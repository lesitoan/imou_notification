"""Migrate a site env without printing credentials. Run locally or on a server."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("destination")
parser.add_argument("--site", choices=["debian", "que"], required=True)
args = parser.parse_args()
values = {}
for line in Path(args.source).read_text(encoding="utf-8-sig").splitlines():
    if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip()
if args.site == "debian":
    for suffix in ["HOST", "PORT", "USERNAME", "PASSWORD", "RTSP_URL", "NAME"]:
        legacy = "CAMERA_" + suffix
        if legacy in values:
            values["CAMERA_1_" + suffix] = values.pop(legacy)
    profile = dict(SITE_ID="debian", CAMERA_COUNT="1", PHOTO_TRIGGER="recording_start", PHOTO_FAILURE_ACTION="text",
                   VIDEO_MODE="motion", VIDEO_POST_DELAY_SECONDS=values.get("RECORDING_POST_DELAY_SECONDS", "10"), VIDEO_MAX_DURATION_SECONDS="300",
                   TELEGRAM_VIDEO_ENABLED="false", LOCAL_VIDEO_ENABLED="true", LOCAL_SNAPSHOT_ENABLED="true",
                   LOCAL_RETENTION_DAYS=values.get("RETENTION_DAYS", "3"), DRIVE_UPLOAD_ENABLED="true",
                   DRIVE_REMOTE="gdrive:ASUS_Server_Backup/Imou_Recorder", DRIVE_UPLOAD_VIDEOS="true", DRIVE_UPLOAD_SNAPSHOTS="true",
                   DRIVE_UPLOAD_INTERVAL_SECONDS="300", DRIVE_RCLONE_CONFIG="/run/secrets/rclone.conf", TELEGRAM_CHAT_ID="-5405309944",
                   APP_CONTAINER_NAME="imou-recorder")
else:
    profile = dict(SITE_ID="que", CAMERA_COUNT="2", PHOTO_TRIGGER="motion_start", PHOTO_FAILURE_ACTION="log", VIDEO_MODE="fixed",
                   VIDEO_DURATION_SECONDS="15", TELEGRAM_VIDEO_ENABLED="true", LOCAL_VIDEO_ENABLED="false", LOCAL_SNAPSHOT_ENABLED="false",
                   DRIVE_UPLOAD_ENABLED="false", APP_CONTAINER_NAME="imou-snapshot-que")
values.update(profile)
values.setdefault("RCLONE_TPSLIMIT", "0.5")
values.setdefault("RCLONE_TPSLIMIT_BURST", "1")
values.update(VIDEO_ENABLED="true", TELEGRAM_PHOTO_ENABLED="true", VIDEO_SEND_INTERVAL_SECONDS="5", VIDEO_QUEUE_MAX_SIZE="20",
              VIDEO_QUEUE_MAX_BYTES="524288000", VIDEO_PENDING_MAX_AGE_HOURS="72" if args.site == "debian" else "24",
              PROTECT_PENDING_DELIVERIES="true", TELEGRAM_VIDEO_MAX_SECONDS="60", MIN_FREE_DISK_BYTES="268435456",
              DATA_PATH="/data", RECORDING_PATH="/data/recordings", SNAPSHOT_PATH="/data/snapshots", APP_DATA_DIR="./data",
              APP_SECRETS_DIR="./secrets", APP_ENV_FILE=Path(args.destination).name, APP_IMAGE="lesitoan/imou-notifi:2.0.1")
output = Path(args.destination)
output.write_text("# Unified Imou Notifi profile: " + args.site + "\n" + "\n".join(f"{key}={value}" for key, value in values.items()) + "\n", encoding="utf-8")
output.chmod(0o600)
print(f"Migrated {args.site} profile to {output.name}; credentials preserved, not displayed")
