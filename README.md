# Imou Motion Recorder

Small Node.js service that listens for ONVIF motion events, records the RTSP stream without transcoding, creates a snapshot, and sends a Telegram notification.

## Run with Docker Compose

```bash
cp .env.example .env
# Fill camera and Telegram credentials in .env
mkdir -p data/recordings data/snapshots
docker compose up -d
docker compose logs -f
```

Recordings and snapshots are stored under `./data` and removed automatically after the configured retention period.
