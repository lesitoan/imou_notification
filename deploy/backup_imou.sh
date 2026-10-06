#!/bin/bash
set -u

SOURCE_DIR="/home/toandev/imou-recorder/data"
REMOTE_DIR="gdrive:ASUS_Server_Backup/Imou_Recorder"
LOCK_FILE="/home/toandev/backups/imou/backup.lock"

mkdir -p "$(dirname "$LOCK_FILE")"

# Do not let two scheduled uploads overlap.
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

if [ ! -d "$SOURCE_DIR" ]; then
  echo "[$(date --iso-8601=seconds)] Source directory does not exist: $SOURCE_DIR"
  exit 1
fi

echo "[$(date --iso-8601=seconds)] Imou Drive backup started"

# min-age ensures an active recording is never uploaded. A completed file is
# copied 2-7 minutes after FFmpeg closes it because this job runs every 5 min.
status=1
for attempt in 1 2 3; do
  ionice -c 3 nice -n 19 rclone copy "$SOURCE_DIR" "$REMOTE_DIR" \
    --min-age 2m \
    --exclude '*.part' \
    --transfers 1 \
    --checkers 2 \
    --contimeout 15s \
    --timeout 1m \
    --retries 3 \
    --low-level-retries 5 \
    --drive-pacer-min-sleep 1s \
    --drive-pacer-burst 5 \
    --log-level INFO \
    --stats-one-line
  status=$?
  [ "$status" -eq 0 ] && break
  [ "$attempt" -eq 3 ] && break
  delay=$((attempt * 60))
  echo "[$(date --iso-8601=seconds)] Drive unavailable; retrying in ${delay}s"
  sleep "$delay"
done

echo "[$(date --iso-8601=seconds)] Imou Drive backup finished (status=$status)"
exit "$status"
