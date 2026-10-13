# Imou Notifi 2.0.1

Một source và một Docker image cho Debian và Ubuntu ở quê. Mỗi camera nhận ONVIF START/END riêng, chụp ảnh qua RTSP và có thể quay video, gửi Telegram, lưu local hoặc backup Google Drive theo env.

## Hai cấu hình

| Tùy chọn | `.1.env` Debian | `.2.env` ở quê |
|---|---|---|
| Số camera | 1 | 2: Bếp, Sân |
| Ảnh Telegram | Khi bắt đầu phiên ghi hình | Mỗi lần chuyển sang có chuyển động |
| Video | START quay; END chờ 10s; START hủy chờ | Clip cố định 15s từ START |
| Gửi video Telegram | Tắt, bật được bằng env | Bật |
| Lưu local | Ảnh/video 3 ngày | Chỉ giữ video tạm tới khi gửi xong |
| Backup Drive | Bật cho ảnh/video | Tắt |

`PHOTO_TRIGGER=recording_start` giữ hành vi ảnh Debian: chuyển động trở lại trong thời gian chờ dừng không gửi ảnh mới. `motion_start` giữ hành vi ở quê: bỏ START lặp và không chụp thêm khi ảnh trước đang xử lý. Ảnh gửi trực tiếp; video có queue riêng.

`VIDEO_MODE=fixed`: START trong clip không kéo dài hoặc tạo clip trùng. Clip kết thúc không tự quay lại khi motion vẫn true. `motion`: mỗi đoạn tối đa `VIDEO_MAX_DURATION_SECONDS=300`; nếu còn chuyển động sẽ tiếp tục đoạn mới trong cùng phiên, không gửi thêm ảnh.

## Cấu hình và chạy

Copy `.env.example`, điền thông tin camera/Telegram. Mật khẩu ONVIF và mật khẩu trong URL RTSP có thể khác nhau. Dùng `CAMERA_COUNT` và `CAMERA_N_*` để thêm camera. Các cờ photo/video/local/Drive, mode và thời lượng có thể override theo camera, ví dụ `CAMERA_2_TELEGRAM_VIDEO_ENABLED=false`.

```sh
docker compose --env-file .1.env pull
docker compose --env-file .1.env up -d
docker compose --env-file .1.env logs -f
# Ở quê: thay .1.env bằng .2.env
```

`APP_ENV_FILE` phải khớp file đang chọn; `APP_DATA_DIR` và `APP_SECRETS_DIR` chọn thư mục host. Container chạy UID/GID 1000; thư mục data cần quyền ghi. `compose.debian.yaml` là cấu hình tương thích tên service cũ, dùng `.1.env`.

Snapshot-only: `VIDEO_ENABLED=false`, `TELEGRAM_VIDEO_ENABLED=false`, `LOCAL_VIDEO_ENABLED=false`, `DRIVE_UPLOAD_VIDEOS=false`; dùng `PHOTO_TRIGGER=motion_start`. Drive hoàn toàn tắt nếu `DRIVE_UPLOAD_ENABLED=false`.

## Queue và lưu trữ

Queue lưu metadata JSON và video trên data volume; restart phục hồi job. Một worker upload video đọc từng đoạn 64 KiB. Ảnh bypass queue; worker không bắt đầu video khi ảnh đang xử lý, có khoảng chờ 5s và nhường hạn mức cho các lượt ảnh. Upload đã bắt đầu không bị hủy khi có ảnh mới. Telegram 429 dùng `retry_after`; lỗi khác retry có backoff. Mất phản hồi sau upload có thể tạo tin trùng khi retry.

Mặc định queue Telegram tối đa 20 clip/500 MiB, 10 lần thử. Vượt giới hạn: bỏ lượt video mới, ghi log; archive local/Drive vẫn theo cờ riêng. Video chờ tối đa 24h ở quê/72h Debian. Ngân sách queue tính file gốc; bản chuyển mã tạm và archive dùng thêm đĩa. Khi đĩa còn dưới 256 MiB, không nhận file media mới. Ảnh không lưu local vẫn chụp và gửi được.

File ghi dở có đuôi `.part`, không upload. Chỉ file hoàn tất được đăng ký job. `LOCAL_*_ENABLED=false` xóa file sau khi các đích hoàn tất/thất bại; `true` giữ tới `LOCAL_RETENTION_DAYS`. `PROTECT_PENDING_DELIVERIES=true` giữ file còn chờ trước khi hết tuổi job. Retention local không xóa Drive. File legacy Debian được giữ theo retention và backup Drive, không phát lại Telegram.

Telegram dùng MP4 H.264. Nếu file quá dài, lớn hoặc codec khác, tạo bản gửi tối đa `TELEGRAM_VIDEO_MAX_SECONDS` (mặc định 60s), chuyển H.264; giữ nguyên bản archive. Mặc định giới hạn bản gửi 48 MiB để chừa biên dưới [giới hạn Bot API](https://core.telegram.org/bots/api#sendvideo). Video giảm tốc gửi theo [Telegram Bot FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this); ảnh vẫn giữ luồng hiện tại nên cấu hình này không bảo đảm giới hạn toàn nhóm nếu ảnh dồn quá nhiều.

## Google Drive

Image có rclone. Khi bật Drive, đặt `DRIVE_REMOTE` và `DRIVE_RCLONE_CONFIG=/run/secrets/rclone.conf`. Copy file cấu hình đã xác thực vào `secrets/rclone.conf` trên server, owner UID 1000, mode 600; thư mục mode 700. Mount có quyền ghi để rclone cập nhật OAuth token. Không để secrets trong data được backup. Giới hạn băng thông mặc định 2M; worker chỉ copy file hoàn tất, không sync/xóa remote.

Khi migrate Debian, sao lưu Compose/env/crontab/image, tạo `.1.env` bằng `python3 migrate_env.py .env .1.env --site debian`; script giữ credentials và camera thật. Sau khi worker Drive xác nhận hoạt động, gỡ đúng cron backup Imou cũ để tránh chạy trùng.

## Build và kiểm tra

```sh
npm ci
npm run typecheck
npm test
docker build --platform linux/amd64 -t lesitoan/imou-notifi:2.0.1 .
docker push lesitoan/imou-notifi:2.0.1
```

Kiểm tra dùng camera/token giả, không gửi thông báo thật. Mọi env thật, data và secrets được loại khỏi Git và build context. Chi tiết quyết định tại `docs/UNIFIED_SOURCE_PLAN.md`.

### Giới hạn truy vấn Drive khi có backlog

Có thể thêm `RCLONE_TPSLIMIT=0.5` và `RCLONE_TPSLIMIT_BURST=1` vào env site. Rclone kế thừa hai biến này từ ứng dụng và giới hạn tối đa một giao dịch HTTP mỗi 2 giây, burst một giao dịch. Debian đang áp dụng để tránh dồn truy vấn khi phục hồi archive cũ. Đổi env cần `docker compose --env-file .1.env up -d` để container nhận cấu hình mới. Các worker vẫn ưu tiên file mới và retry khi Drive trả quota error. Tham khảo [rclone TPS limit](https://rclone.org/docs/#tpslimit-float) và [rclone environment variables](https://rclone.org/docs/#environment-variables).
