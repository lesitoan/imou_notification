# Bàn giao mới nhất — cả Debian và quê đã triển khai 2.0.1

Cập nhật **13/10/2026, khoảng 17:10 Asia/Ho_Chi_Minh**. Ubuntu ở quê đã được triển khai theo yêu cầu mới nhất; Debian giữ nguyên kết quả ở phần dưới.

- Quê: **100.79.114.23**, thư mục **/home/toandev/imou-snapshot-que**, service/container **imou-snapshot-que**. Compose dùng `.2.env`, image **lesitoan/imou-notifi:2.0.1** pin digest **sha256:f18a8d65b7ef7f57bf4036c29114ae7cfdd231d22741357500a787b27b37e7f9**.
- Hai camera **Bếp 192.168.1.3**, **Sân 192.168.1.4**: ảnh `motion_start`, video `fixed` **15s**, Telegram ảnh/video bật; local video/snapshot và Drive đều tắt. Nhóm **camera_1 -5568762006**, bot đã xác nhận là member bằng API đọc.
- Cấu hình migrate từ env hiệu lực container cũ để giữ credentials và nhóm. `.2.env` local đã đồng bộ từ server, không commit secrets.
- Module ONVIF `/app/dist/camera.js` của bản cũ và mới cùng SHA256 **c9c274a5d90958665a01c9557748596a32fa3abea9d06bda841bdf50a32ce706**. Không đổi cách bắt event ở quê.
- Cutover lúc **17:07:28**: app 2.0.1 khởi động, cả hai camera connected; nhận MOTION END từ cả hai. Container running/restart count0; RAM khoảng15.54MiB khi idle. Server có2.8GiB RAM khả dụng và40GiB đĩa trống lúc khảo sát.
- Video chỉ giữ tạm trong data volume cho queue, xóa khi delivery kết thúc; ảnh không archive. Không có file media/job ở thời điểm kiểm tra sau deploy. Queue tối đa20jobs/500MiB, cách gửi video5s, pending tối đa24h; ảnh được ưu tiên theo logic chung đã thống nhất.
- **Người dùng yêu cầu bỏ qua kiểm tra chuyển động vì đang ở xa. Chưa xác nhận ảnh/video thực tế và cleanup sau upload trên hai camera quê; không ghi live verification là PASS.** Có thể kiểm tra khi có sự kiện thật; chưa cần sửa source hoặc build lại.
- Backup quê **/home/toandev/imou-snapshot-que/rollback-20261013-100506**: Compose/env cũ, runtime.env private, image-id và rollback.compose.yaml. Image cũ được tag **lesitoan/imou-snapshot:rollback-pre-unified**. Rollback khi cần: `docker compose -p imou-snapshot-que -f /home/toandev/imou-snapshot-que/rollback-20261013-100506/rollback.compose.yaml up -d`. Không chạy hai bản đồng thời.

## Kết quả Debian trước đó

Cập nhật **13/10/2026, 16:56 Asia/Ho_Chi_Minh**. Người dùng đã yêu cầu tiếp tục. Đọc phần này trước; các phần dưới là lịch sử tạm dừng và bản2.0.0, không phải trạng thái hiện tại.

## Đã hoàn thành

- Source chung trên branch **codex/unify-camera-service**. Commit implementation8da580d; patch recorder **fad9e78**, tag local **v2.0.1**. Chưa push Git branch/tag lên remote; đã push Docker Hub theo yêu cầu.
- Sửa FFmpeg recorder từ `-rw_timeout` sang **`-timeout 15000000`**, đối chiếu help RTSP demuxer trong image.
- Final image Linux **12/12 test PASS**, gồm regression tham số RTSP và chuyển MPEG4→H264/giới hạn thời lượng/queue/retention/retry.
- Image **lesitoan/imou-notifi:2.0.1**, digest **sha256:f18a8d65b7ef7f57bf4036c29114ae7cfdd231d22741357500a787b27b37e7f9** đã push/pull và deploy Debian. Bản2.0.0 có lỗi recorder, không dùng deploy.
- Real camera diagnostic trong final published image PASS: fixed3.000s, snapshot và motion stop6.648s. Script không gửi Telegram/Drive, dùng data /tmp trong container --rm.
- Debian **100.71.168.118**, container/service **imou-recorder**, `/home/toandev/imou-recorder/compose.yaml`, env **.1.env**, image pin tag+digest nêu trên. Data cũ vẫn mount /data; secrets riêng /run/secrets.
- Camera Phòng **192.168.1.10**; migrate từ env hiệu lực container cũ, vì .env gốc trên disk stale .1.2. `.1.env` local đã đồng bộ camera .1.10/group mới.
- Profile Debian: PHOTO_TRIGGER=recording_start; motion END chờ10s, max đoạn300s; ảnh nhóm **camera_DN -5405309944**; Telegram video **false**; video/snapshot local **true**, retention3days; Drive **true**, remote gdrive:ASUS_Server_Backup/Imou_Recorder.
- Đã gỡ **chỉ cron Imou backup cũ**, dừng script/transfer Imou tương ứng, để worker mới thực hiện backup. Các cron/container khác giữ nguyên.
- Worker Drive đã backup nhiều ảnh/video legacy thành công. Backlog ban đầu846records được phục hồi; file cũ chỉ dọn sau giao xong, pending được bảo vệ.
- Có quota per-minute khi legacy backlog chạy nhanh. Đã chỉnh env **RCLONE_TPSLIMIT=0.5**, **RCLONE_TPSLIMIT_BURST=1**, restart nhận env; rclone log xác nhận limiter, các lượt backup sau đó thành công. Cấu hình này có trong .1.env, .2.env, .env.example và script migrate (defaults), README.
- Restart kiểm tra phục hồi826records, không phát lại Telegram; container running/restart count0, khoảng49MiB RAM tại lúc khảo sát.
- Người dùng xác nhận đi qua camera Phòng. Log production có START16:51:40, snapshot sent Telegram16:51:45; END16:52:10, video completed16:52:20, đúng post-delay10s. LượtSTART mới16:52:27 gửi ảnh16:52:33. Không thay đổi giải mã/thuật toán ONVIF.
- Clip đầu1971910bytes, ffprobe xác nhận **HEVC2304×1296,39.539s**. Bản lưu không âm thanh; nếu bật Telegram video sẽ tạo H264 khi cần, archive giữ nguyên.
- Snapshot mới đã backup Drive lúc16:53:51; video mới đã backup thành công lúc16:55:51. Metadata của hai job mới là drive=sent, attempts0; xem kết quả cuối tại docs/DEPLOYMENT_RECORD.md.

## Backup và rollback

Backup **/home/toandev/imou-recorder/rollback-20261013-161005** chứa Compose/env gốc, runtime.env hiệu lực, image-id.txt, crontab.txt, crontab-before-cutover.txt và rollback.compose.yaml. Image tag **lesitoan/imou-recorder:rollback-pre-unified**.

Rollback phải dùng **runtime.env**, không dùng .env stale. Lệnh rollback khi cần:

```sh
cd /home/toandev/imou-recorder
docker compose -p imou-recorder -f /home/toandev/imou-recorder/rollback-20261013-161005/rollback.compose.yaml up -d
crontab /home/toandev/imou-recorder/rollback-20261013-161005/crontab-before-cutover.txt
```

Không chạy app cũ/new đồng thời cùng camera. Nếu khôi phục cron cũ, bảo đảm worker Drive mới dừng để không backup trùng. File rclone config trong secrets ownerUID1000/mode600, thư mục700; có quyền ghi để refresh OAuth.

## Trạng thái quê sau triển khai

**Đã thay server Ubuntu ở quê sang2.0.1**, xem phần mới nhất đầu file. `.2.env` local/server đã đồng bộ profile hai camera .1.3/.1.4, group quê -5568762006, fixed15s, Telegram video true, local archive/Drive false và queue durable trên data volume.

Người dùng đã yêu cầu bỏ qua live motion verification. Khi có yêu cầu kiểm tra tiếp: quan sát hai clip fixed/overlap, gửi ảnh/video và cleanup temporary bằng sự kiện thật. Không tự đổi policy ảnh hoặc bật video Telegram Debian.

Các giới hạn: ảnh bypass queue; có thể retry video trùng nếu mất phản hồi; quota Telegram không được phối hợp giữa hai server; pending Drive giữ tối đa72h Debian. Archive/Drive backlog không thuộc budget queue Telegram500MiB, reserve đĩa256MiB. Drive retention không xóa bản remote. HTTP TPS limiter giảm tốc quá trình phục hồi file cũ; file mới được ưu tiên sau job hiện hành.

Xem **docs/DEPLOYMENT_RECORD.md** để biết kết quả cuối và digest. Review và deployment docs được cập nhật sau tag release; source app image vẫn tương ứngfad9e78.

---

# Lịch sử các lượt trước

# Trạng thái bàn giao mới nhất — ĐÃ TẠM DỪNG

Cập nhật: **13/10/2026, khoảng 16:18 (Asia/Ho_Chi_Minh)**. Người dùng yêu cầu tạm dừng và cập nhật review; không tiếp tục sửa/build/deploy trong lượt này.

**Đọc phần này trước. Các phần bên dưới là lịch sử bàn giao lúc 16:04, có trạng thái đã thay đổi.**

## Đã hoàn thành sau khi tiếp tục

1. Đọc review và kiểm tra working tree; giữ branch **codex/unify-camera-service**.
2. Sửa source:
   - Cleanup giữ busy lock trên mỗi job trong toàn bộ thao tác để worker không tranh file.
   - Snapshot archive ghi `.part` rồi rename; cleanup partial snapshot; lỗi archive không chặn gửi JPEG đã chụp.
   - Upload video H264 phù hợp vẫn có thể gửi khi đĩa thấp; chỉ chuyển mã yêu cầu đủ disk reserve + ngân sách file gửi.
   - Bắt lỗi stdin của recorder để tránh lỗi pipe làm app crash.
3. `npm test` source cuối: 10/10 PASS. Thêm `tests/media.test.mjs`; chạy final image Linux với RUN_MEDIA_TESTS=true: **11/11 PASS**, gồm chuyển MPEG4 sang H264, giới hạn thời lượng, giữ archive và phục hồi preparedFile.
4. Commit implementation: **8da580d** — `Unify camera service with configurable recording and durable delivery workers`.
5. Git tag local **v2.0.0** trỏ tới commit này. Chưa push Git branch/tag lên remote.
6. Build và push thành công **lesitoan/imou-notifi:2.0.0**:
   - Manifest digest **sha256:f65e9ff3eddb0e048600e8b66c4392f4426beaae733d4d379c0e43144f59e0b1**.
   - Image ID **sha256:b5e8c759fe4876aef1c43162a272befab1473bbc88a8695b04d6a8b5f2ae85c1**.
   - Debian đã pull cùng digest.
7. SSH Debian qua Tailscale thành công.
8. Backup tại **/home/toandev/imou-recorder/rollback-20261013-161005**: Compose gốc, .env gốc, crontab, image-id.txt và runtime.env hiệu lực. Image cũ tag **lesitoan/imou-recorder:rollback-pre-unified**.
9. Phát hiện **.env trên đĩa stale (.1.2)** nhưng container đang chạy **camera .1.10/Phòng**. Đã trích chỉ các key ứng dụng từ docker inspect vào runtime.env private, rồi migrate sang `.1.env` server. Không dùng .env stale để deploy hoặc rollback.
10. Đã tạo rollback.compose.yaml trong backup folder: pin image rollback, env runtime.env và data path tuyệt đối. `.rollback-path` trong thư mục deployment trỏ backup folder.
11. Đã chép `migrate_env.py`, `compose.debian.yaml`, `camera-diagnostic.mjs` vào `/home/toandev/imou-recorder`.
12. Đã tạo **secrets/rclone.conf** từ config host, file600/thư mục700, owner toandev UID1000. `rclone listremotes` thấy gdrive:.
13. Telegram read-only: bot imou_notifi_bot là member nhóm **camera_DN -5405309944**; token hiệu lực của container đọc được nhóm.
14. Đã tải `.1.env` server về `.1.env` local: host hiện **192.168.1.10**, tên Phòng, group mới, profile motion/local3days/Drive. Secrets không được commit.
15. Tạo `docs/DEPLOYMENT_RECORD.md` ghi commit/tag/digest và bước chuẩn bị; file này chưa commit tại lúc dừng.

## Lỗi quan trọng vừa phát hiện — CHƯA SỬA

**Chẩn đoán recorder với camera thật trong image 2.0.0 FAILED:**

```text
Phòng: recording started (fixed, limit 3s)
Phòng: recording failed: FFmpeg video exited 1: Option rw_timeout not found.
Diagnostic exit: 1
```

Log server: `/home/toandev/imou-recorder/camera-diagnostic.log`.

Lỗi nằm ở tham số **`-rw_timeout 15000000` trong src/recorder.ts**, xảy ra với FFmpeg/RTSP thực tế trong image. Kiểm tra trước đó tới localhost port đóng chỉ trả Connection refused và không chứng minh option hợp lệ khi RTSP kết nối thành công.

**11/11 test vẫn PASS vì suite không kiểm tra Recorder với RTSP thật. Không xem bản 2.0.0 đã push là sẵn sàng deploy.** Cần kiểm tra help của RTSP demuxer trong đúng image, sửa tham số timeout theo version FFmpeg, thêm kiểm tra recorder thực tế rồi rebuild/push bản sửa. Không âm thầm ghi đè release hiện có; chọn version patch phù hợp (ví dụ 2.0.1) và đồng bộ package/Compose/env/docs/tag sau khi sửa.

Chẩn đoán thất bại ngay ở fixed3s; **chưa chạy qua snapshot và motion stop**. Không có ảnh/video nào được script này gửi Telegram hay Drive. Container diagnostic dùng --rm và data tạm trong /tmp, không đụng archive production.

## Trạng thái server tại lúc tạm dừng

- **CHƯA CUTOVER.** Container `imou-recorder` vẫn chạy image cũ **lesitoan/imou-recorder:latest**.
- Compose production `/home/toandev/imou-recorder/compose.yaml` **chưa thay**.
- Env production `.env` **chưa thay**; `.1.env` mới được chuẩn bị riêng.
- Cron backup Imou cũ **chưa gỡ/dừng**. Chưa dừng process backup đang chạy.
- New worker Drive **chưa chạy/kiểm tra backup thành công**. Backup cũ đã thấy rateLimitExceeded/duplicate object trước đó.
- New image đã pull nhưng chỉ được chạy bằng script diagnostic, chưa chạy app production.
- Không thay đổi deployment Ubuntu ở quê.
- .2.env local đã chuẩn bị video15s nhưng APP_IMAGE vẫn2.0.0, cần đổi sang bản sửa đã kiểm tra trước triển khai.
- Source implementation đã commit 8da580d; review hiện tại được sửa sau commit; deployment record untracked. Không reset mất tài liệu.

## Việc phải làm tiếp khi người dùng yêu cầu tiếp tục

1. Đọc trạng thái mới nhất này; xác nhận server vẫn chạy bản cũ.
2. Kiểm tra FFmpeg RTSP demuxer help trong image để sửa rw_timeout, không đoán tham số từ bản FFmpeg khác.
3. Chạy camera-diagnostic.mjs thành công cả fixed3s, snapshot và motion stop; bổ sung kiểm tra Recorder để bắt lỗi tương tự.
4. Review lại source và suite; giữ thuật toán ảnh đã chốt.
5. Tạo bản patch đã sửa, commit/tag/build/push và lưu digest mới; đồng bộ `.1.env`, `.2.env`, Compose, README, deployment record. Tag v2.0.0 local và image2.0.0 hiện phản ánh bản có lỗi recorder; không dùng để cutover.
6. Dùng `.1.env` hiệu lực đã migrate (.1.10), validate quyền data/secrets và rclone trong final image. `.env` gốc stale không dùng làm căn cứ camera.
7. Backup/rollback hiện đã có. Nếu thay trạng thái trước cutover thì bổ sung backup runtime/crontab mới.
8. Cutover Debian trước: giữ tên container/data, dừng app cũ graceful, thay Compose, tạm gỡ đúng cron Imou và kết thúc/wait process backup cũ để không tranh quota; giữ các cron/container khác.
9. Xác nhận ONVIF, ảnh nhóm mới, recording hoàn tất/MP4 playable, retention và Drive backed up. Chưa có xác nhận gửi thật tới nhóm mới trong app mới.
10. Restart/queue/rollback kiểm tra theo checklist lịch sử; báo người dùng kết quả Debian. Quê chưa deploy trong lượt này.

Không cần xin lại quyền cho các bước triển khai người dùng đã cho phép khi họ yêu cầu tiếp tục. Hiện tại phải giữ tạm dừng theo yêu cầu mới nhất.

---

# Lịch sử bàn giao trước khi tiếp tục (16:04)

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
