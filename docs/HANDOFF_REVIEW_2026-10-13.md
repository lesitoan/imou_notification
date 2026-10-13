# Bàn giao Imou Notifi — source chung, Docker và triển khai Debian

Cập nhật: **13/10/2026, 16:04 (Asia/Ho_Chi_Minh)**.
Workspace: `D:\CODE\imou_notifi`.

## 1. Trạng thái tại thời điểm chuyển tài khoản

- Branch đang checkout: **`codex/unify-camera-service`**, xuất phát từ `feature/que-snapshot-2cams`.
- HEAD hiện tại: **`efd03ec`**. Toàn bộ implementation mới đang ở working tree, **chưa commit**. Không reset/clean/checkout làm mất thay đổi.
- Source chung và hai profile env đã viết; package version **2.0.0**.
- Docker Desktop đã khởi động lại sau lỗi engine HTTP 500; engine đã build thành công.
- Có image local **`lesitoan/imou-notifi:2.0.0`**, ID `sha256:ebb9e00dfe170576c39d4bdf0d8df611564fdcf96d6a1d40d977271b68e4dabd`.
- **Image local chưa chứa vài sửa cuối** trong `src/video.ts`, `src/storage.ts`, `src/workers.ts`, `src/index.ts`; bắt buộc build lại trước khi push.
- **Chưa push Docker Hub. Chưa triển khai server mới.** Debian vẫn chạy `lesitoan/imou-recorder:latest`; cron backup cũ vẫn còn.
- Lần cuối `npm test` đạt **10/10** sau sửa cleanup file chuyển mã, trước khi thêm field legacy và ưu tiên Drive cho file mới. Cần chạy lại cho trạng thái source cuối.
- Không thay đổi deployment Ubuntu ở quê trong lượt này.

## 2. Yêu cầu và các quyết định đã được người dùng chốt

Người dùng đã cho phép: tạo branch mới, sửa code dùng chung, build Docker, push lên namespace **lesitoan**, SSH cấu hình/triển khai **Debian trước**. Sau đó mới tiếp tục server Ubuntu ở quê.

Một source/image cho hai nơi, khác env `.1.env` và `.2.env`. Giữ thuật toán gửi ảnh của từng nơi; bổ sung quay/gửi video và cờ true/false. Ảnh gửi trực tiếp và được ưu tiên hơn video. Queue video không dùng Redis/BullMQ/RabbitMQ: dùng worker Node, metadata và video lưu trên disk volume để phục hồi khi restart; upload streaming, không giữ cả video trong RAM.

| Chức năng | Debian `.1.env` | Ở quê `.2.env` |
|---|---|---|
| Camera | 1 camera Phòng | Bếp 192.168.1.3, Sân 192.168.1.4 |
| Ảnh | Bắt đầu phiên ghi hình | False → true, bỏ START trùng; bỏ khi ảnh trước đang xử lý |
| Video | Motion: START quay, END chờ 10s, START hủy chờ | Fixed: 15s từ START, không prebuffer |
| START mới trong clip | Tiếp tục cùng phiên | Không tạo clip trùng/không kéo dài clip |
| Giới hạn đoạn | 300s; còn motion thì đoạn mới cùng phiên, không thêm ảnh | 15s, không quay định kỳ nếu motion cứ true |
| Video Telegram | **false**; người dùng có thể bật env | **true** |
| Ảnh/video local | true, retention 3 ngày | false, video chỉ là file tạm tới khi giao xong |
| Drive | true, ảnh và video | false |
| Nhóm Telegram | camera_DN **-5405309944** | camera_1 **-5568762006** |

Queue Telegram: tối đa 20 job/500 MiB, giãn lượt 5s, 10 lần thử, tuổi job 72h Debian/24h quê. Tôn trọng 429 retry_after; ảnh không đưa vào queue. File archive không bị mất chỉ vì queue Telegram đầy. File chờ giao được bảo vệ trước retention tới giới hạn tuổi job. Retry khi mất phản hồi có thể tạo tin Telegram trùng.

## 3. Source đã thay đổi

### Module mới

- `src/motion.ts`: MotionController, hai mode fixed/motion, trạng thái riêng từng camera; session ảnh Debian giữ qua rollover; clock/backend có thể giả lập trong kiểm tra.
- `src/recorder.ts`: FFmpeg RTSP TCP, copy video/no audio, MP4 faststart; file `.part` tới khi hoàn tất; dừng bằng q, watchdog và giới hạn thời gian; register file hoàn tất vào MediaStore.
- `src/storage.ts`: MediaStore, metadata JSON ghi qua temporary + rename; phục hồi job và orphan file hoàn tất; queue count/bytes; reserve đĩa; retention; busy/active protection; cleanup partial. File legacy Debian không phát lại Telegram.
- `src/process.ts`: helper chạy subprocess có timeout, abort và giới hạn output.
- `src/video.ts`: ffprobe kiểm tra codec/thời lượng/size; dùng nguyên H.264 hợp lệ; nếu cần tạo bản Telegram H.264 tối đa 60s, fit 1280x720/15fps; archive nguyên bản; xóa partial khi chuyển mã lỗi.
- `src/workers.ts`: một worker Telegram video và một worker Drive; retry/backoff/429; Drive rclone copyto chỉ file hoàn tất, băng thông 2M; validate remote/config. Sửa cuối ưu tiên file mới trước legacy khi backup để backlog migration không chặn dữ liệu mới.

### Module/config đã sửa

- `src/config.ts`: loadConfig, CAMERA_COUNT 1..32, CAMERA_N_*, tương thích biến CAMERA_* cũ; validate true/false/mode/URL; cờ photo/video/local/Drive độc lập và override theo camera.
- `src/index.ts`: điều phối camera/controller/photo/store/workers và graceful shutdown. Photo vẫn đi thẳng Telegram; không chờ worker video.
- `src/telegram.ts`: TelegramClient, ảnh giữ luồng trực tiếp; video multipart từ createReadStream 64 KiB; theo dõi lượt ảnh/gửi để nhường quota; retry_after truyền về worker.
- `src/logger.ts`: che mật khẩu RTSP và bot token trong lỗi/log.
- `src/camera.ts`, `src/snapshot.ts`: giữ implementation bản ở quê, ONVIF kết nối riêng; snapshot timeout 20s/10 MiB.
- Dockerfile: Node 22 bookworm slim + FFmpeg/rclone/CA; chạy user node UID 1000; DATA_PATH=/data.
- compose.yaml: image 2.0.0; APP_ENV_FILE/APP_CONTAINER_NAME/APP_DATA_DIR/APP_SECRETS_DIR; volume data và secrets riêng; grace 60s.
- compose.debian.yaml: compatibility service imou-recorder, image chung, `.1.env`, data/secrets.
- package.json/package-lock.json: tên imou-notifi, version 2.0.0, script test.
- .dockerignore/.gitignore: loại env thật, data, secrets; tests/docs/deploy không vào image.
- .env.example và README.md: đã cập nhật source chung, profile, queue, retention, Drive, lệnh chạy.
- docs/UNIFIED_SOURCE_PLAN.md: giữ phân tích branch trước implementation; bổ sung trạng thái implementation và đổi thứ tự Debian trước. Một số câu ở các phần lịch sử nói “chưa sửa source” là trạng thái tại lúc viết plan, không phải trạng thái hiện tại.
- deploy/migrate_env.py: chuyển env cũ sang profile đánh số; giữ credentials; set nhóm Debian mới; không in credentials.
- tests/environment.mjs + tests/service.test.mjs: 10 bài kiểm tra dùng env giả, không gửi Telegram thật.

Env thật `.1.env`, `.2.env` bị Git ignore; không commit/upload vào Docker context.

## 4. Các kiểm tra đã làm và giới hạn

- `npm run typecheck`: PASS cho implementation đầu.
- `npm test`: 10/10 PASS (config, fixed overlap/ảnh, motion stop/resume/session, rollover/END khi async start, durable queue/restart/limits, expiry/local retention, orphan recovery/legacy, multipart streaming/ưu tiên ảnh, Telegram429, Drive-off).
- Sandbox Windows chặn rename file temp (EPERM), chạy lại với quyền ngoài sandbox đã PASS. Không cần sửa source vì lỗi sandbox này.
- Docker build Linux amd64: PASS, gồm FFmpeg 5.1.9 và rclone từ Debian bookworm.
- FFmpeg trong image với `-rtsp_transport tcp -rw_timeout 15000000` tới `rtsp://127.0.0.1:1/stream`: trả Connection refused bình thường, không báo option không hợp lệ. Đây chỉ là kiểm tra tham số, **chưa chứng minh recorder quay/stop được từ camera thật**.
- Chưa chạy bộ test bên trong final image Linux; chưa kiểm tra thực tế chuyển mã, recorder fixed/motion và shutdown.
- Chưa kiểm tra gửi ảnh vào nhóm mới hoặc Drive worker bằng deployment mới.
- SSH Debian hoạt động qua Tailscale. Session PTY cũ ID 14645 là trạng thái tạm của lượt trước; tài khoản mới nên SSH lại.

## 5. Debian đã khảo sát (read-only)

### Kết nối

- Tailscale IP: **100.71.168.118**.
- User: **toandev**. Mật khẩu do người dùng cung cấp trong chat trước; không ghi mật khẩu vào file review.
- SSH thường qua mạng Tailscale, không cần public IP.
- Host: debian, UID/GID toandev = 1000; có nhóm docker.

### Deployment hiện tại

- Thư mục `/home/toandev/imou-recorder`.
- Compose `/home/toandev/imou-recorder/compose.yaml`.
- Env thật trên server: `/home/toandev/imou-recorder/.env`.
- Container/service/project: **imou-recorder**.
- Image **lesitoan/imou-recorder:latest**, ID `sha256:7b11480581295b04368fc7b81ba23651706a62ba2ea02d6fb161471dfb7db966`.
- Container running từ `2026-10-10T02:50:15.140768061Z`.
- Bind `/home/toandev/imou-recorder/data:/data`.
- Recording/snapshot `/data/recordings`, `/data/snapshots`.
- Camera thực tế trên server: **192.168.1.10**, tên Phòng.
- Telegram cũ: chat riêng `1843357134`; cần chuyển nhóm **-5405309944**.
- Retention hiện tại 3 ngày; post-delay 10s; cleanup 60 phút.
- Runtime dist/index.js cũ SHA256 `3b3424a2d1b58c9cb7f37ab96d3de69aeecd22e9e3c67c9dd51020c9abfb144b`, code recorder CommonJS kiểu main.
- Khoảng 830 file / 6.4 GiB trong data; có file từ tháng 9 và nhiều ngày >3 ngày. Cần kiểm tra cleanup migration có bảo vệ đúng file đang chờ Drive.
- Disk host ~457G, free ~399G; toàn bộ file media khảo sát owner toandev.
- Không đụng các container khác: bluetooth-dashboard, cloudflared, tailscale, portainer.

### Drive cũ

- Host rclone `/usr/bin/rclone`; remote **gdrive:**.
- Config OAuth `/home/toandev/.config/rclone/rclone.conf`.
- Script `/home/toandev/backups/scripts/backup_imou.sh`.
- Source `/home/toandev/imou-recorder/data`.
- Remote **gdrive:ASUS_Server_Backup/Imou_Recorder**.
- Lock `/home/toandev/backups/imou/backup.lock`.
- Cron đang tồn tại:

```cron
*/5 * * * * /home/toandev/backups/scripts/backup_imou.sh >> /home/toandev/backups/logs/imou-backup.log 2>&1
```

Tại khoảng 16:02 có process backup/rclone đang chạy. Log báo **rateLimitExceeded** và Duplicate object found. Không coi backup cũ là đã hoàn tất thành công. Cần dừng lịch cũ đúng lúc cutover và xử lý process đang chạy để không tranh quota với worker mới; giữ backup crontab để rollback. Không xóa các cron không liên quan.

Secrets mới phải ở `/home/toandev/imou-recorder/secrets/rclone.conf`, mount `/run/secrets`, **ngoài data**. Owner UID/GID1000, file600, thư mục700, volume cho phép ghi để refresh OAuth. Không in nội dung token/config.

## 6. Điểm cần lưu ý trước triển khai

1. **`.1.env` local chưa khớp camera thật**: CAMERA_1_HOST hiện `192.168.1.2`, trong khi server dùng `192.168.1.10`. Không chép thẳng `.1.env` local lên server. Dùng script migrate từ `.env` thật trên Debian để giữ đúng host/RTSP/ONVIF/token, sau đó đối chiếu/cập nhật profile local một cách không lộ credentials.
2. `.2.env` local đúng hai host .1.3/.1.4 và group quê; đã chuyển sang profile video15s. Chưa deploy quê.
3. Source mới hơn image local. Các thay đổi cuối phải kiểm tra và rebuild, rồi mới push. Chưa tạo Git release tag.
4. Drive migration có backlog legacy. Code đã thêm ưu tiên media mới; cần xác nhận retry/rate-limit bằng thực tế. Queue Telegram được giới hạn 500MiB, nhưng archive/Drive và bản chuyển mã dùng thêm disk; MIN_FREE_DISK_BYTES là reserve, không phải quota toàn data.
5. Recorder và chuyển mã chưa được kiểm tra với camera thật trong image mới. Chạy chẩn đoán tách biệt, không chạy hai app cùng gửi ảnh trong một nhóm.
6. Giữ thuật toán ảnh. Nếu chỉnh thêm, tránh thay trigger, suppression hoặc thời điểm gửi ảnh. Có thể review việc lỗi lưu archive hiện đi vào catch snapshot và text fallback thay vì gửi JPEG đã chụp; chưa đổi hành vi này.
7. FFmpeg shutdown phải ra MP4 hợp lệ, không gửi .part; restart queue không phát lại legacy. Validate rclone config trước đổi app.
8. Worker Telegram gửi theo nhóm trên từng server; không điều phối quota toàn bot giữa hai server. Hai nhóm khác nhau và số event thấp theo người dùng; ảnh vẫn không rate-limit mới.

## 7. Task tiếp theo — thực hiện theo thứ tự

### A. Hoàn thiện/review source và kiểm tra cuối

- [ ] Đọc file này, README, source, git diff và plan; giữ mọi thay đổi working tree.
- [ ] Rerun typecheck/test cho source cuối (field legacy + Drive priority chưa qua lượt test cuối).
- [ ] Kiểm tra FFmpeg thật: clip fixed, motion END/post-delay, stop/shutdown, codec bản gửi Telegram; queue/retry/cleanup Linux. Có thể dùng RTSP thử/synthetic hoặc camera trên server bằng tiến trình chẩn đoán không gửi Telegram.
- [ ] Review lỗi archive có ảnh hưởng photo, disk reserve, cleanup file chuyển mã, recover metadata/file orphan và shutdown.
- [ ] Đồng bộ tài liệu nếu thay quyết định; đừng đổi thuật toán photo người dùng đã chốt.
- [ ] Commit implementation trên codex/unify-camera-service, giữ bí mật ngoài Git. Dùng `git -c safe.directory=D:/CODE/imou_notifi ...` nếu bị ownership restriction.

### B. Build và push

- [ ] Build lại final image:

```powershell
docker build --platform linux/amd64 -t lesitoan/imou-notifi:2.0.0 .
```

- [ ] Chạy kiểm tra final Linux image; xác nhận Node/FFmpeg/rclone và cấu hình cả hai profile.
- [ ] Push `docker push lesitoan/imou-notifi:2.0.0` bằng login hiện có nếu hợp lệ. Chưa xác nhận quyền push/login Docker Hub.
- [ ] Lưu digest đã push, commit/release tag 2.0.0 phù hợp. Không ghi đè latest khi không cần.

### C. Backup và chuẩn bị Debian

- [ ] SSH qua `ssh toandev@100.71.168.118`; xem lại trạng thái container/camera/backup hiện tại.
- [ ] Backup Compose/.env/crontab vào thư mục timestamp mode700; pin/tag image cũ để rollback. Giữ data path.
- [ ] Upload deploy/migrate_env.py và Compose/source chẩn đoán cần thiết qua scp (không gửi secrets qua log).
- [ ] Tạo `.1.env` **từ `.env` thật trên server** bằng `python3 migrate_env.py .env .1.env --site debian`.
- [ ] Xác nhận camera vẫn .1.10, nhóm -5405309944, video motion10post300max, Telegram-video false, local3days, Drive true.
- [ ] Chuẩn bị secrets/rclone.conf từ config host, quyền đúng UID1000; validate remote.
- [ ] Pull image đã push (ưu tiên pin digest ghi nhận), kiểm tra Compose config nhưng không in resolved credentials.
- [ ] Kiểm tra bot thuộc nhóm bằng getMe/getChat/getChatMember read-only, giữ token bí mật.

### D. Cutover và xác nhận

- [ ] Dừng app cũ graceful; chuyển Compose giữ tên imou-recorder và bind data cũ.
- [ ] Tạm gỡ đúng cron backup Imou và kết thúc/wait process backup cũ khi cần để không cạnh tranh quota; crontab đầy đủ đã backup.
- [ ] Khởi động app mới từ `.1.env`; không chạy app cũ/mới đồng thời nhận sự kiện và gửi Telegram.
- [ ] Theo dõi ONVIF connected, START/END, ảnh nhóm mới, recording completed, retention và Drive backed up.
- [ ] Xác nhận file video playable/duration đúng; worker mới backup được ít nhất một file; kiểm tra log không lộ mật khẩu/token.
- [ ] Kiểm tra restart không mất job và no stale partial delivery; tránh restart liên tục làm phát ảnh init dư.
- [ ] Nếu thất bại, rollback Compose/env/image và cron từ backup, giữ data hiện có.
- [ ] Ghi report cuối commit/tag/digest và trạng thái Debian. Báo người dùng hoàn thành Debian; quê triển khai lượt sau theo yêu cầu.

## 8. Hướng dẫn mở lại task sau khi chuyển tài khoản

Có thể dùng prompt:

> Đọc docs/HANDOFF_REVIEW_2026-10-13.md trong D:\CODE\imou_notifi. Tiếp tục implementation source chung trên branch codex/unify-camera-service, giữ thuật toán ảnh đã chốt. Kiểm tra/rebuild/push lesitoan/imou-notifi:2.0.0 rồi deploy Debian 100.71.168.118 trước, giữ data/local3days/Drive và đổi nhóm camera_DN -5405309944. Source đang chưa commit, image local cũ hơn source; không reset. Dùng env thật trên server để migrate camera .1.10. Tài khoản SSH do tôi cung cấp trong chat hoặc tôi sẽ nhập khi cần.

Thông tin bí mật vẫn ở env local/server và lịch sử chat; file này chỉ ghi thông tin vận hành cần cho bàn giao.

### Tiếp tục ngày 13/10/2026

Source đã sửa lỗi cleanup tranh file với worker, ghi snapshot qua .part rồi rename, và lỗi archive không chặn ảnh Telegram. Upload file H264 có sẵn vẫn được phép khi disk thấp; chỉ chuyển mã yêu cầu reserve + ngân sách file gửi. Đã chạy 11/11 bài kiểm tra trong image Linux, gồm FFmpeg chuyển MPEG4 sang H264 và giới hạn thời lượng. Image local cuối: b5e8c759fe4876aef1c43162a272befab1473bbc88a8695b04d6a8b5f2ae85c1.

**Phát hiện env stale:** `.env` trên Debian chứa camera .1.2, khác env container hiện chạy .1.10. Khi migrate phải lấy env hiệu lực từ docker inspect, chỉ lấy keys camera/Telegram/recording/snapshot/retention/cleanup/TZ vào file private `runtime.env` trong rollback folder, rồi migrate file này. Đã thực hiện bước đó, `.1.env` server giữ .1.10/Phòng. Bot getChatMember xác nhận member nhóm camera_DN. Rollback cũng phải dùng runtime.env thay vì .env stale.

Backup đã tạo tại `/home/toandev/imou-recorder/rollback-20261013-161005`; image cũ được tag `lesitoan/imou-recorder:rollback-pre-unified`. Tiến trình push/deploy đang tiếp tục; report cuối ghi trạng thái chính thức.
