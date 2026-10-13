# Kế hoạch dùng chung source cho Debian và Ubuntu ở quê

## 1. Phạm vi và căn cứ

Đối chiếu source local ngày 13/10/2026:

- `main`, commit `3010737`: recorder một camera cho Debian.
- `feature/que-snapshot-2cams`, commit `efd03ec`: snapshot hai camera ở quê.
- `.1.env`: cấu hình Debian, lưu local 3 ngày, quay thêm 10 giây sau khi hết chuyển động; đích Telegram hiện là chat riêng.
- `.2.env`: camera Bếp và Sân; đích Telegram hiện là nhóm.

Đây là phân tích hai branch và file triển khai trong repository. Chưa đối chiếu image, cron hoặc cấu hình đang chạy trên hai server trong lần phân tích này. Image Debian đang dùng tag `latest`, nên cần xác nhận digest và source thực tế trước khi thay deployment.

## 2. Các khác biệt đã xác nhận

| Nội dung | Debian / main | Ubuntu ở quê / feature/que-snapshot-2cams |
|---|---|---|
| Image trong Compose | `lesitoan/imou-recorder:latest` | `lesitoan/imou-snapshot:1.0.0` |
| Camera | Một camera, biến `CAMERA_*` | Đúng hai camera, biến `CAMERA_1_*`, `CAMERA_2_*` |
| ONVIF | Một instance | Instance và kết nối lại riêng cho mỗi camera |
| Điều kiện gửi ảnh | Bắt đầu phiên ghi hình mới | Chuyển động đổi từ false sang true; bỏ lần trùng; không gửi thêm nếu lần gửi trước còn đang xử lý |
| Chuyển động trở lại lúc đang chờ dừng | Tiếp tục video cũ, không gửi ảnh mới | Có thể gửi ảnh mới nếu lần gửi trước đã xong |
| Quay video | START bắt đầu; END lên lịch dừng sau 10 giây; START trong lúc chờ hủy dừng | Chưa có |
| Giới hạn thời gian video | Chưa có giới hạn tối đa | Chưa có video |
| Định dạng video | MP4, copy luồng video, không âm thanh | — |
| Snapshot | Tạo JPEG trên ổ đĩa | JPEG trong RAM, tối đa 10 MiB, timeout 20 giây |
| Snapshot lỗi | Gửi thông báo chữ nếu đã bắt đầu recorder | Log lỗi, không gửi ảnh |
| Telegram video | Chưa có | Chưa có |
| Lưu local | Video và ảnh; `RETENTION_DAYS=3` | Không lưu lâu dài |
| Cleanup | Định kỳ, tránh file video đang ghi | Chưa có |
| Backup Drive | Script rclone riêng | Không bật trong Compose |
| Volume | `./data:/data` | Chưa có data volume |

`deploy/backup_imou.sh` có trên cả hai branch nhưng chạy riêng với ứng dụng. Script ghi cứng thư mục nguồn, remote Drive và lock file. Script copy cả thư mục data, có retry và `--min-age 2m`; ghi chú nói lịch 5 phút nhưng cron không nằm trong repository. Cleanup local không kiểm tra file đã backup thành công hay chưa. Source hiện tại không có chính sách xóa dữ liệu cũ trên Drive.

## 3. Thiết kế source chung

Một branch triển khai dự kiến `codex/unify-camera-service`, xuất phát từ bản hai camera và đưa các module ghi hình/cleanup của main trở lại. Sau khi hoàn tất, một source chính và một image có version phục vụ cả hai server.

Các module:

1. **Config:** đọc env, kiểm tra boolean/số/mode; tạo danh sách camera theo `CAMERA_COUNT`. Hỗ trợ biến camera cũ của Debian trong giai đoạn chuyển đổi, đồng thời chuyển `.1.env` sang tên đánh số.
2. **ONVIF:** dùng implementation hiện tại của bản ở quê; phát START/END riêng từng camera. Giữ cách giải mã sự kiện đang dùng.
3. **Snapshot:** dùng chung bộ chụp ảnh; điều kiện kích hoạt được chọn bằng `PHOTO_TRIGGER=motion_start|recording_start`. Giữ bộ nhớ `lastMotion` và chặn ảnh trùng đang xử lý như bản ở quê. Chọn lưu ảnh local bằng env.
4. **Recorder:** trạng thái riêng từng camera, có hai mode `fixed` và `motion`.
5. **Telegram:** ảnh đi trực tiếp theo luồng hiện tại; video đi qua queue riêng. Đích chat riêng hoặc nhóm đều lấy từ `TELEGRAM_CHAT_ID`.
6. **Video queue:** một worker mỗi server, lưu metadata và file trên data volume. Upload đọc file theo từng phần. Quay và chụp ảnh không chờ queue upload.
7. **Local storage/cleanup:** quản lý file theo camera/ngày; phân biệt file đang ghi, file chờ giao và file lưu theo retention.
8. **Drive:** khi bật, worker gọi rclone để gửi file đã hoàn tất; remote, chu kỳ, loại file và retry lấy từ env. File xác thực rclone nằm trên server và được cung cấp qua volume, không đưa vào image hay Git.

Luồng ảnh của hai bản có khác biệt thực tế, nên `PHOTO_TRIGGER` là cần thiết. Dùng một điều kiện duy nhất cho cả hai sẽ làm thay đổi số ảnh trên Debian hoặc ở quê.

### Hai mode video

- `fixed`: START quay 15 giây; START khác trong clip không tạo video trùng và không kéo dài clip. END không cắt ngắn clip. Khi clip đã kết thúc, lần START mới có thể quay clip mới. Nếu camera giữ trạng thái chuyển động true liên tục, không tự tạo thêm clip định kỳ.
- `motion`: giữ cách quay của Debian; END bắt đầu đếm thời gian quay thêm, START trong thời gian này hủy dừng. Thêm giới hạn tối đa cấu hình được để tránh quay vô hạn khi mất END. Giới hạn này tạo một đoạn mới nếu chuyển động vẫn tiếp diễn, giữ cùng phiên chuyển động để không tạo thêm thông báo ảnh.

Bật/tắt quay, gửi Telegram, lưu local và gửi Drive là các lựa chọn riêng. Ví dụ Debian có thể quay và lưu Drive nhưng không gửi video Telegram; ở quê có thể quay clip gửi Telegram rồi xóa, không lưu archive.

### Queue và ưu tiên ảnh

- Mỗi job chứa metadata/đường dẫn, không chứa toàn bộ video trong RAM. File đang ghi có dấu hiệu chưa hoàn tất; chỉ tạo job sau khi FFmpeg đóng file thành công.
- Một worker upload video; lưu job qua thao tác ghi/đổi tên file để phục hồi sau restart. Các file này phải nằm trên volume.
- Giãn lượt gửi video, retry có thời gian chờ, tôn trọng `retry_after` khi Telegram trả 429.
- Không bắt đầu upload video mới khi có ảnh đang gửi; theo dõi lượt ảnh để nhường hạn mức cho ảnh. Ảnh mới vẫn gửi trực tiếp nếu video đã upload; ưu tiên này không hủy một upload đang chạy.
- Giới hạn cả số job, tổng dung lượng và tuổi job. Khi đầy, không nhận thêm job Telegram video và ghi log rõ ràng; ảnh tiếp tục hoạt động. Nếu bật archive, video vẫn được lưu theo chính sách archive.
- Khi mất phản hồi sau upload, retry có thể tạo video Telegram trùng; không hứa bảo đảm gửi đúng một lần.

### Vòng đời file và Drive

- File đang ghi không được gửi Drive hoặc xóa. Sau khi kết thúc mới đánh dấu hoàn tất và tạo các công việc Telegram/Drive.
- Nếu không lưu local lâu dài, giữ file cho tới khi các đích được bật xử lý xong, rồi xóa.
- Nếu bật lưu local, giữ tới hạn retention. File còn chờ Telegram hoặc Drive được bảo vệ theo cấu hình; tuổi chờ và ngân sách đĩa ngăn tăng dung lượng vô hạn. Hết giới hạn phải log trạng thái thất bại trước khi dọn file.
- Dùng dấu hoàn tất thay vì chỉ dựa vào mtime/min-age để quyết định file có thể upload.
- Backup Drive và upload Telegram không xóa file của nhau. Upload Drive là copy; retention local không tự xóa bản trên Drive.
- Khi chuyển sang worker Drive của source chung, gỡ lịch backup cũ sau khi xác nhận worker mới hoạt động để tránh chạy trùng.

## 4. Env đề xuất

Giữ `.1.env` cho Debian và `.2.env` cho ở quê. Các khóa sau là đề xuất cho source chung, chưa có hiệu lực trong code hiện tại.

| Khóa | Ý nghĩa |
|---|---|
| `SITE_ID` | Phân biệt site trong log và đường dẫn |
| `CAMERA_COUNT` | Số camera; đọc `CAMERA_1_*` tới `CAMERA_N_*` |
| `TELEGRAM_PHOTO_ENABLED` | Bật gửi ảnh |
| `PHOTO_TRIGGER` | `motion_start` hoặc `recording_start` |
| `PHOTO_FAILURE_ACTION` | `log` hoặc `text`, giữ cách xử lý lỗi ảnh của từng bản |
| `VIDEO_ENABLED` | Bật quay video |
| `VIDEO_MODE` | `fixed` hoặc `motion` |
| `VIDEO_DURATION_SECONDS` | Độ dài clip fixed |
| `VIDEO_POST_DELAY_SECONDS` | Quay thêm sau END trong mode motion |
| `VIDEO_MAX_DURATION_SECONDS` | Độ dài tối đa mỗi đoạn trong mode motion |
| `TELEGRAM_VIDEO_ENABLED` | Bật gửi video đã quay qua queue |
| `VIDEO_SEND_INTERVAL_SECONDS` | Khoảng chờ tối thiểu giữa lượt gửi video |
| `VIDEO_QUEUE_MAX_SIZE`, `VIDEO_QUEUE_MAX_BYTES` | Ngân sách queue Telegram |
| `VIDEO_PENDING_MAX_AGE_HOURS` | Thời gian giữ file chờ giao tối đa |
| `LOCAL_VIDEO_ENABLED`, `LOCAL_SNAPSHOT_ENABLED` | Lưu video/ảnh lâu dài trên server |
| `LOCAL_RETENTION_DAYS` | Thời gian lưu local |
| `CLEANUP_INTERVAL_MINUTES` | Chu kỳ cleanup |
| `PROTECT_PENDING_DELIVERIES` | Bảo vệ file còn chờ giao trước cleanup theo retention |
| `DRIVE_UPLOAD_ENABLED` | Bật backup Drive |
| `DRIVE_REMOTE` | Remote rclone và thư mục đích riêng site |
| `DRIVE_UPLOAD_VIDEOS`, `DRIVE_UPLOAD_SNAPSHOTS` | Loại file gửi Drive |
| `DRIVE_UPLOAD_INTERVAL_SECONDS` | Chu kỳ worker Drive |
| `DRIVE_RCLONE_CONFIG` | Đường dẫn file cấu hình rclone trong container |

Các cờ photo/video/archive có thể có override `CAMERA_N_*`; nếu không đặt thì kế thừa cấu hình chung server. Không sao chép bí mật vào ví dụ.

### Profile Debian: giữ ghi hình và lưu trữ, chuyển ảnh vào nhóm

```env
SITE_ID=debian
CAMERA_COUNT=1
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
CLEANUP_INTERVAL_MINUTES=60
PROTECT_PENDING_DELIVERIES=true
VIDEO_PENDING_MAX_AGE_HOURS=72

DRIVE_UPLOAD_ENABLED=true
DRIVE_UPLOAD_VIDEOS=true
DRIVE_UPLOAD_SNAPSHOTS=true
DRIVE_UPLOAD_INTERVAL_SECONDS=300
DRIVE_REMOTE=gdrive:ASUS_Server_Backup/Imou_Recorder
DRIVE_RCLONE_CONFIG=/run/secrets/rclone.conf
TELEGRAM_CHAT_ID=-5405309944
```

Giới hạn 300 giây là đề xuất mới, cấu hình lại được; trước đây Debian chưa có giới hạn. Gửi video Telegram trên Debian mặc định tắt, có thể bật bằng env. Nếu bật với video motion dài, cần xử lý giới hạn dung lượng/codec trước upload: tạo bản clip ngắn hoặc chuyển mã bản gửi từ file đã ghi, giữ nguyên bản archive. Không âm thầm gửi video quá giới hạn.

### Profile ở quê: giữ thuật toán ảnh, bổ sung clip 15 giây

```env
SITE_ID=que
CAMERA_COUNT=2
TELEGRAM_PHOTO_ENABLED=true
PHOTO_TRIGGER=motion_start
PHOTO_FAILURE_ACTION=log

VIDEO_ENABLED=true
VIDEO_MODE=fixed
VIDEO_DURATION_SECONDS=15
TELEGRAM_VIDEO_ENABLED=true
VIDEO_SEND_INTERVAL_SECONDS=5
VIDEO_QUEUE_MAX_SIZE=20
VIDEO_QUEUE_MAX_BYTES=524288000
VIDEO_PENDING_MAX_AGE_HOURS=24

LOCAL_VIDEO_ENABLED=false
LOCAL_SNAPSHOT_ENABLED=false
PROTECT_PENDING_DELIVERIES=true
DRIVE_UPLOAD_ENABLED=false
TELEGRAM_CHAT_ID=<ID_NHOM_QUE_HIEN_TAI>
```

Ở quê vẫn cần data volume để chứa file video/job tạm. Khi `VIDEO_ENABLED=false`, giữ chế độ snapshot đang dùng. `VIDEO_QUEUE_MAX_BYTES` và tuổi chờ ở trên là mức đề xuất, điều chỉnh sau khi kiểm tra dung lượng ổ đĩa và kích thước clip thực tế.

## 5. Build và triển khai

- Một Dockerfile và một image có version, ví dụ `lesitoan/imou-notifi:2.0.0`; hai server dùng cùng tag/digest.
- Một Compose chung; chọn env bằng `--env-file .1.env` hoặc `--env-file .2.env`. Compose lấy đường dẫn env ứng dụng và data volume từ cấu hình từng server.
- Image gồm Node.js, FFmpeg và rclone để bật/tắt backup chỉ qua cấu hình; một process ứng dụng điều phối các worker.
- Giữ các đường dẫn data cũ của Debian khi chuyển đổi; không di chuyển/xóa các video hiện có.
- Đã nhận ID nhóm Debian `camera_DN`: `-5405309944`, và cập nhật `.1.env` local. Khi triển khai cần áp dụng giá trị này trên server. Chuyển chat riêng sang nhóm chỉ cần bot có mặt trong nhóm và thay `TELEGRAM_CHAT_ID`; không cần thuật toán gửi riêng cho nhóm.
- Mount volume đủ quyền ghi cho user `node`; kiểm tra file rclone và quyền truy cập trước khi bật Drive.
- Xác minh camera dùng codec nào trước khi chọn cách tạo video Telegram. Stream copy giảm CPU; nếu codec không phù hợp thì chỉ chuyển mã bản cần gửi.
- Theo yêu cầu triển khai mới: Debian trước, xác nhận quay/local/Drive và nhóm Telegram. Profile ở quê được chuẩn bị sẵn cho lượt triển khai sau.
- Mỗi server có thể rollback image cũ bằng tag/digest cùng env/Compose đã lưu. Chỉ dừng cron backup cũ khi worker mới đã được kiểm tra.

## 6. Kiểm tra trước khi hoàn thành

1. Cùng một build đọc được profile một camera và hai camera; validate cấu hình sai ngay lúc khởi động.
2. Timeline snapshot ở quê giữ kết quả hiện tại: START lặp, START/END gần nhau và ảnh đang gửi không sinh ảnh trùng; video lỗi không chặn ảnh.
3. Timeline Debian: START, END, START trong 10 giây chờ tiếp tục cùng phiên và không thêm ảnh; giới hạn đoạn dài hoạt động đúng.
4. Fixed 15 giây: START ở giây 0 và giây 5 chỉ tạo một clip; hai camera quay đồng thời được.
5. Upload video có queue, giãn lượt, retry/429, file streaming; ảnh không bị đưa vào queue video.
6. Restart lúc đang quay/chờ gửi: xử lý file chưa hoàn tất, phục hồi job; không hứa không trùng khi upload mất phản hồi.
7. Queue đầy, quá tuổi, gần đầy đĩa: log và hành vi rõ ràng; cleanup không xóa file đang ghi/chờ xử lý ngoài chính sách.
8. Drive bật/tắt đúng env; chỉ upload file hoàn tất; lỗi Drive không chặn ảnh hoặc Telegram video.
9. Local retention 3 ngày trên Debian và xóa tạm sau gửi ở quê hoạt động độc lập với retention Drive.
10. Xác nhận việc gửi thật vào nhóm sau khi được người dùng cho phép; xem log không lộ token hay mật khẩu RTSP.

Các trường hợp trên là kế hoạch kiểm tra cho implementation sau. Lần phân tích này chưa sửa source, env thật hoặc deployment.

## 7. Implementation 2.0.0

Đã triển khai source chung trên branch codex/unify-camera-service, cấu hình .1.env/.2.env và migration giữ credentials. README mô tả các khóa đã có hiệu lực. Bộ kiểm tra Node bao gồm config, hai mode motion, durable queue, retention, streaming và retry. Rclone config nằm ngoài data tại /run/secrets/rclone.conf.

