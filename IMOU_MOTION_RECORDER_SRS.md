# SRS --- Imou Motion Recorder

## 1. Tổng quan

### 1.1. Mục tiêu

Xây dựng một service Node.js/TypeScript chạy 24/7 trên Debian để:

-   Nhận sự kiện Motion Detection từ camera Imou A32EP-L qua ONVIF.
-   Khi có chuyển động, ghi video RTSP xuống ổ cứng server.
-   Chụp snapshot và gửi cảnh báo qua Telegram.
-   Khi hết chuyển động, tiếp tục ghi thêm một khoảng thời gian ngắn rồi
    dừng.
-   Chỉ lưu recording và snapshot trong 3 ngày; dữ liệu cũ được tự động
    xóa.
-   Không chạy AI trên server.
-   Không re-encode video để giảm tải CPU.

### 1.2. Thiết bị hiện tại

-   Camera: Imou A32EP-L
-   Camera LAN IP hiện tại: `192.168.1.2`
-   Server: ASUS K43E
-   OS: Debian
-   CPU: Intel Core i3-2330M, 2 cores / 4 threads
-   RAM: 6 GB DDR3
-   Storage: 500 GB
-   GPU: Intel HD Graphics 3000

> IP, username, password và token phải được cấu hình qua biến môi
> trường, không hard-code trong source code.

------------------------------------------------------------------------

## 2. Kiến trúc

``` text
                Imou A32EP-L
                     |
          +----------+----------+
          |                     |
        ONVIF                  RTSP
          |                     |
    Motion Event                |
          |                     |
          v                     |
     Node.js Service            |
       /         \              |
      /           \             |
 Telegram       FFmpeg <--------+
                   |
                   v
               HDD/SSD
```

Camera chịu trách nhiệm Motion Detection. Debian không thực hiện
AI/object detection.

------------------------------------------------------------------------

## 3. Luồng hoạt động chính

### 3.1. Bắt đầu sự kiện

Khi ONVIF chuyển trạng thái:

``` text
IsMotion: false -> true
```

service phải:

1.  Tạo một motion event mới.
2.  Bắt đầu ghi RTSP bằng FFmpeg.
3.  Chụp một snapshot.
4.  Gửi cảnh báo và snapshot qua Telegram.
5.  Chuyển state sang `RECORDING`.

### 3.2. Kết thúc sự kiện

Khi ONVIF chuyển:

``` text
IsMotion: true -> false
```

service không dừng recording ngay mà:

1.  Chuyển state sang `WAITING_STOP`.
2.  Bắt đầu timer, mặc định 10 giây.
3.  Nếu motion xuất hiện lại trong thời gian này:
    -   Hủy timer.
    -   Tiếp tục recording hiện tại.
4.  Nếu hết timer mà không có motion mới:
    -   Dừng FFmpeg.
    -   Hoàn thành file recording.
    -   Chuyển state về `IDLE`.

------------------------------------------------------------------------

## 4. Functional Requirements

### FR-01 --- Kết nối camera

Service phải kết nối camera qua ONVIF.

Thông tin kết nối được lấy từ environment:

``` env
CAMERA_HOST=192.168.1.2
CAMERA_PORT=80
CAMERA_USERNAME=admin
CAMERA_PASSWORD=
```

Nếu mất kết nối:

``` text
Camera offline
     |
     v
Log error
     |
Wait 10 seconds
     |
Reconnect
```

Service không được crash chỉ vì camera offline.

------------------------------------------------------------------------

### FR-02 --- Nhận Motion Event

Service subscribe/poll ONVIF events và quan tâm đến:

``` text
IsMotion=true
IsMotion=false
```

Service phải lưu state hiện tại và chỉ xử lý khi state thay đổi.

  State trước    Event     Hành động
  -------------- --------- ---------------------------------
  IDLE           `true`    Start event
  RECORDING      `true`    Ignore
  RECORDING      `false`   Schedule stop
  WAITING_STOP   `true`    Cancel stop, tiếp tục recording
  WAITING_STOP   `false`   Ignore
  IDLE           `false`   Ignore

Không được tạo nhiều notification hoặc nhiều recording cho các message
`IsMotion=true` lặp lại trong cùng một event.

------------------------------------------------------------------------

### FR-03 --- Recording

Khi bắt đầu event, service spawn FFmpeg để đọc RTSP.

RTSP hiện tại:

``` text
rtsp://<username>:<password>@192.168.1.2:554/cam/realmonitor?channel=1&subtype=0
```

Credential phải được tạo từ environment, không hard-code.

FFmpeg phải ưu tiên stream copy:

``` text
RTSP H.264/H.265
      |
      v
    FFmpeg
      |
    -c copy
      |
      v
     Disk
```

Không sử dụng `libx264`, `libx265` hoặc transcoding nếu không cần thiết.

Ví dụ argument:

``` text
-rtsp_transport tcp
-i <RTSP_URL>
-map 0:v:0
-c:v copy
-an
<OUTPUT>
```

Audio không bắt buộc. Bản đầu có thể sử dụng `-an`.

------------------------------------------------------------------------

### FR-04 --- Cấu trúc recording

Recording được tổ chức theo ngày:

``` text
recordings/
└── 2026-09-24/
    ├── 2026-09-24_15-30-21.mp4
    ├── 2026-09-24_17-42-08.mp4
    └── 2026-09-24_22-15-51.mp4
```

Tên file phải tránh collision.

------------------------------------------------------------------------

### FR-05 --- Post-motion delay

Khi nhận `IsMotion=false`, không dừng recording ngay.

Default:

``` env
RECORDING_POST_DELAY_SECONDS=10
```

Ví dụ:

``` text
15:30:15 Motion=true
         START RECORD

15:31:02 Motion=false
         wait 10s

15:31:07 Motion=true
         cancel stop
         continue SAME FILE
```

Nếu không có motion mới:

``` text
15:31:02 Motion=false
15:31:12 timeout
         STOP RECORD
```

------------------------------------------------------------------------

### FR-06 --- Snapshot

Khi một event mới bắt đầu, lấy một frame từ RTSP bằng FFmpeg.

Ví dụ:

``` text
ffmpeg
-rtsp_transport tcp
-i <RTSP_URL>
-frames:v 1
<snapshot-path>
```

Snapshot lưu tại:

``` text
snapshots/
└── 2026-09-24/
    └── 2026-09-24_15-30-21.jpg
```

------------------------------------------------------------------------

### FR-07 --- Telegram

Khi bắt đầu event, gửi một thông báo:

``` text
🚨 Phát hiện chuyển động

📷 Camera: Phòng
🕐 24/09/2026 15:30:21
```

Kèm snapshot nếu snapshot thành công.

Environment:

``` env
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Telegram là chức năng phụ.

Nếu Telegram API lỗi:

``` text
Telegram failed
      |
      v
Log error
      |
      v
Recording vẫn tiếp tục
```

Không được dừng recording vì Telegram thất bại.

------------------------------------------------------------------------

### FR-08 --- Retention

Chỉ lưu recording và snapshot trong:

``` env
RETENTION_DAYS=3
```

Cleanup mặc định chạy mỗi 60 phút:

``` env
CLEANUP_INTERVAL_MINUTES=60
```

Service phải xóa:

-   Recording cũ hơn 3 ngày.
-   Snapshot cũ hơn 3 ngày.

Không được xóa file đang được FFmpeg ghi.

Không cần database cho retention.

------------------------------------------------------------------------

### FR-09 --- Reconnection

Nếu ONVIF mất kết nối:

``` env
CAMERA_RECONNECT_SECONDS=10
```

Service phải tự reconnect.

Ví dụ log:

``` text
[2026-09-24 15:30:01] Camera connected
[2026-09-24 15:45:13] Camera disconnected
[2026-09-24 15:45:23] Reconnecting...
[2026-09-24 15:45:24] Camera connected
```

------------------------------------------------------------------------

### FR-10 --- Graceful Shutdown

Khi nhận:

``` text
SIGTERM
SIGINT
```

service phải:

1.  Hủy timer đang chạy.
2.  Dừng FFmpeg đúng cách.
3.  Đóng recording.
4.  Đóng ONVIF connection/subscription nếu cần.
5.  Exit.

Không dùng `kill -9` FFmpeg trừ trường hợp bất khả kháng.

------------------------------------------------------------------------

## 5. State Machine

``` text
                    +----------+
                    |   IDLE   |
                    +----+-----+
                         |
                   Motion=true
                         |
                         v
                  +-------------+
                  |  RECORDING  |
                  +------+------+
                         |
                   Motion=false
                         |
                         v
                +----------------+
                |  WAITING_STOP  |
                |      10s       |
                +-------+--------+
                       / \
                      /   \
           Motion=true     Timeout
                |             |
                v             v
           RECORDING         IDLE
```

Pseudo-code:

``` ts
function onMotionChanged(motion: boolean) {
  if (motion && state === "IDLE") {
    startEvent();
    state = "RECORDING";
    return;
  }

  if (!motion && state === "RECORDING") {
    scheduleStop();
    state = "WAITING_STOP";
    return;
  }

  if (motion && state === "WAITING_STOP") {
    cancelStop();
    state = "RECORDING";
  }
}
```

------------------------------------------------------------------------

## 6. Non-Functional Requirements

### NFR-01 --- Hiệu năng

Service phải phù hợp với ASUS K43E / i3-2330M / 6 GB RAM.

Do đó:

-   Không AI.
-   Không transcoding.
-   Không xử lý video frame-by-frame.
-   FFmpeg ưu tiên stream copy.
-   Không chạy framework backend nặng nếu không cần.

### NFR-02 --- Độ ổn định

Service phải có khả năng chạy 24/7.

Các lỗi sau không được làm toàn bộ service crash:

-   Camera mất mạng.
-   Telegram timeout.
-   Snapshot thất bại.
-   RTSP tạm thời unavailable.

### NFR-03 --- Bảo mật

Không commit:

-   Camera password.
-   Telegram bot token.
-   Telegram chat ID nếu muốn giữ private.

`.env` phải nằm trong `.gitignore`.

Không log password/token.

------------------------------------------------------------------------

## 7. Công nghệ

Sử dụng:

-   Node.js
-   TypeScript
-   ONVIF npm library
-   FFmpeg
-   Telegram Bot API
-   systemd

Không sử dụng ở phiên bản đầu:

-   NestJS
-   PostgreSQL
-   Redis
-   Docker
-   Frigate
-   AI
-   Web UI

------------------------------------------------------------------------

## 8. Project Structure

Giữ project nhỏ:

``` text
imou-recorder/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── camera.ts
│   ├── recorder.ts
│   ├── telegram.ts
│   └── cleanup.ts
│
├── recordings/
├── snapshots/
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

Không over-engineer hoặc tạo abstraction không cần thiết.

------------------------------------------------------------------------

## 9. Environment Variables

`.env.example`:

``` env
# Camera
CAMERA_HOST=192.168.1.2
CAMERA_PORT=80
CAMERA_USERNAME=admin
CAMERA_PASSWORD=

CAMERA_RTSP_PORT=554
CAMERA_RTSP_SUBTYPE=0

# Recording
RECORDING_PATH=./recordings
SNAPSHOT_PATH=./snapshots
RECORDING_POST_DELAY_SECONDS=10

# Retention
RETENTION_DAYS=3
CLEANUP_INTERVAL_MINUTES=60

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Reconnection
CAMERA_RECONNECT_SECONDS=10
```

------------------------------------------------------------------------

## 10. Logging

Log tối thiểu:

``` text
[2026-09-24 15:30:01] Camera connected

[2026-09-24 15:31:15] MOTION START
[2026-09-24 15:31:15] Recording started
[2026-09-24 15:31:16] Telegram sent

[2026-09-24 15:32:02] MOTION END
[2026-09-24 15:32:12] Recording stopped

[2026-09-24 16:00:00] Cleanup: deleted 3 old files
```

Không log credential.

------------------------------------------------------------------------

## 11. systemd

Service cuối cùng phải có khả năng chạy bằng:

``` bash
sudo systemctl start imou-recorder
sudo systemctl stop imou-recorder
sudo systemctl restart imou-recorder
sudo systemctl status imou-recorder
```

Và tự khởi động cùng Debian.

Yêu cầu:

``` text
Restart=always
```

hoặc cơ chế restart tương đương phù hợp.

------------------------------------------------------------------------

## 12. Error Handling

### ONVIF lỗi

-   Log.
-   Retry sau `CAMERA_RECONNECT_SECONDS`.
-   Không exit process.

### RTSP/FFmpeg lỗi

-   Log exit code.
-   Reset recording state hợp lý.
-   Không để zombie FFmpeg process.
-   Cho phép event tiếp theo thử recording lại.

### Snapshot lỗi

-   Vẫn gửi Telegram text nếu có thể.
-   Recording không bị ảnh hưởng.

### Telegram lỗi

-   Log.
-   Không retry vô hạn.
-   Recording không bị ảnh hưởng.

### Cleanup lỗi

-   Log file không xóa được.
-   Tiếp tục xử lý các file khác.

------------------------------------------------------------------------

## 13. Definition of Done

### Test 1 --- Motion recording

``` text
Start service
     ↓
Connect camera
     ↓
Người/chuyển động xuất hiện
     ↓
ONVIF IsMotion=true
     ↓
Recording bắt đầu
     ↓
Snapshot được tạo
     ↓
Telegram nhận notification
```

### Test 2 --- Motion end

``` text
IsMotion=false
     ↓
Wait 10 seconds
     ↓
FFmpeg stops
     ↓
MP4 được đóng
     ↓
VLC mở được file
```

### Test 3 --- Motion quay lại

``` text
IsMotion=false
     ↓
Wait 5 seconds
     ↓
IsMotion=true
```

Kết quả:

-   Stop timer bị cancel.
-   FFmpeg không restart.
-   Tiếp tục cùng recording file.
-   Không gửi notification mới cho cùng event.

### Test 4 --- Camera offline

-   Tắt camera/network.
-   Node service không crash.
-   Service retry.
-   Camera online lại thì tự reconnect.

### Test 5 --- Telegram failure

-   Telegram API/token không hoạt động.
-   Recording vẫn được tạo bình thường.

### Test 6 --- Retention

File recording/snapshot cũ hơn 3 ngày phải được tự động xóa.

------------------------------------------------------------------------

## 14. Ưu tiên triển khai

Agent nên triển khai theo thứ tự:

``` text
1. ONVIF connection
       ↓
2. Print Motion true/false
       ↓
3. State machine
       ↓
4. FFmpeg recording
       ↓
5. Post-motion delay
       ↓
6. Snapshot
       ↓
7. Telegram
       ↓
8. Retention cleanup
       ↓
9. Reconnect/error handling
       ↓
10. systemd deployment
```

Không triển khai Telegram hoặc recording trước khi xác nhận Node.js nhận
chính xác `IsMotion=true/false` từ A32EP-L.

------------------------------------------------------------------------

## 15. Nguyên tắc triển khai

Ưu tiên:

> Simple, reliable, low-resource.

Không thêm database, message queue, framework hoặc AI nếu chưa có yêu
cầu mới.

Camera chịu trách nhiệm phát hiện chuyển động. Node.js chịu trách nhiệm
orchestration. FFmpeg chịu trách nhiệm recording.

Mục tiêu cuối cùng:

``` text
Motion
  ↓
ONVIF
  ↓
Node.js
  ├── Telegram
  ├── Snapshot
  └── FFmpeg → recording
                    ↓
              delete after 3 days
```
