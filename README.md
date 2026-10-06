# Imou Motion Snapshot

One service watches two cameras for ONVIF motion events. Each motion start captures one JPEG frame from that camera's RTSP stream and sends it to Telegram. It does not record video or save images to disk.

## Configuration

- `.1.env` holds the existing Debian recorder settings. `compose.debian.yaml` uses the published recorder image and this file. The running Debian deployment is independent of this branch.
- `.2.env` holds both countryside cameras and the Telegram destination. `compose.yaml` uses this file with the versioned snapshot image on Ubuntu.

Copy `.env.example` to `.2.env` if you do not have the local settings already. Fill `CAMERA_1_*` for the kitchen camera and `CAMERA_2_*` for the yard camera. `CAMERA_*_PASSWORD` is the ONVIF password; the password embedded in `CAMERA_*_RTSP_URL` may be different. The two cameras share `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Set a distinct `CAMERA_*_NAME` so notifications identify the camera.

All real `.env` files are ignored by Git and excluded from Docker build context.

## Build and publish the image

```bash
docker build --platform linux/amd64 -t lesitoan/imou-snapshot:1.0.0 .
docker push lesitoan/imou-snapshot:1.0.0
```

## Run on Ubuntu

```bash
docker compose pull
docker compose up -d
docker compose logs -f imou-snapshot-que
```

The service requires access to both cameras on ports 80 (ONVIF) and 554 (RTSP), plus outbound HTTPS to Telegram. Each camera reconnects independently if its ONVIF connection drops. Snapshots are held in memory only while they are sent.
