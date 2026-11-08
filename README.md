# Green School — hướng dẫn chạy

Cập nhật: **07/11/2026**. Các lệnh bên dưới dùng **PowerShell trên Windows**, chạy tại thư mục project.

## Partner vừa clone repo: chạy nhanh

Mở terminal tại thư mục vừa clone. Máy cần Node.js 22.9+, Python 3.12 có lệnh `py` và g++ C++17 trong PATH. Các lệnh `setup:*` bên dưới dành cho Windows.

**Chưa có phần cứng, chạy mô phỏng ngay:**

```powershell
npm.cmd run setup:sim
npm.cmd run simulate:esp
```

**Muốn chạy camera/model và backend:**

```powershell
npm.cmd ci
npm.cmd run setup:camera
```

`setup:camera` tạo `.venv`, cài dependency Python và kiểm tra checksum model có sẵn trong repo; chỉ tải khi thiếu file. Sau đó làm mục 5 để cấu hình khóa và chạy hai cửa sổ backend/camera. Kiểm thử Firebase local ở mục 4 cần thêm JDK21.

Repo giữ source, model ONNX, cấu hình Firebase web, `.env.example`, requirements và lockfile. Dependency, môi trường Python, cache, backup và `secrets/` được bỏ qua vì có thể tạo lại hoặc chứa thông tin riêng. Khóa backend và mật khẩu tài khoản cloud cần chủ project chia sẻ riêng; các link đến `secrets/` sẽ không có file trên bản clone mới. Muốn thử hoàn toàn local thì dùng tài khoản emulator ở mục 4, không cần khóa cloud.

## Thư mục chạy lệnh

```powershell
cd "C:\Users\ADMIN\Downloads\Green School"
```

## 1. Chọn cách chạy

| Bạn muốn làm gì? | Chạy theo mục | Cần chuẩn bị |
| --- | --- | --- |
| Chưa có ESP32, muốn kiểm tra servo và luồng điều khiển | [Mô phỏng ESP32](#3-mô-phỏng-esp32-không-cần-phần-cứng) | Node.js, Python, g++ |
| Chưa có ESP32, muốn kiểm tra cả đăng nhập và cộng điểm | [Kiểm thử Firebase local](#4-kiểm-thử-đăng-nhập-và-cộng-điểm-trên-firebase-local) | Thêm JDK 21 và dependency Node |
| Có ESP32, muốn camera nhận diện và mở nắp | [Chạy AI với phần cứng thật](#5-chạy-ai-với-phần-cứng-thật) | Webcam, ESP32, cảm biến/servo, Internet, khóa backend |
| Có ESP32, chỉ muốn đếm rác, mở nắp bằng tay | [Chế độ thủ công](#6-chạy-thủ-công-không-ai) | ESP32, cảm biến, Internet, khóa backend |

**Hiện chưa có phần cứng: bắt đầu ở mục 2 → 3 → 4.** Mô phỏng dùng nhãn rác và khoảng cách tổng hợp; không cần mở camera hay chọn cổng COM.

## 2. Chuẩn bị môi trường

### Python và Node.js

Cần Node.js **22.9 trở lên**, Python **3.12 64-bit** đã được kiểm thử với project.

```powershell
node --version
npm.cmd --version
py -3.12 --version
```

Tạo môi trường Python một lần nếu chưa có `.venv`:

```powershell
py -3.12 -m venv .venv
```

Kiểm tra môi trường đang dùng:

```powershell
.\.venv\Scripts\python.exe --version
```

Không cần activate `.venv`. Nếu máy không có lệnh `py` nhưng có Python, dùng executable Python thực tế để tạo môi trường, ví dụ `python -m venv .venv`.

### Chỉ mô phỏng ESP32

Cần g++ hỗ trợ C++17 và có trong PATH:

```powershell
g++ --version
```

Mô phỏng ở mục 3 chỉ dùng thư viện chuẩn Python; không cần cài model, OpenCV hay Firebase dependency. `npm.cmd run simulate:esp` có thể chạy trước `npm.cmd ci`.

### Kiểm thử Firebase local hoặc chạy backend

Cài dependency Node một lần:

```powershell
npm.cmd ci
```

Kiểm thử Firebase local cần thêm **JDK 21**:

```powershell
java -version
```

### Chạy camera hoặc toàn bộ test Python

```powershell
.\.venv\Scripts\python.exe -m pip install -r hardware/requirements-camera.txt
```

Chỉ dùng bridge thủ công thì cài `hardware/requirements.txt`. Không cài `opencv-python-headless` chung với OpenCV hiện tại vì camera cần cửa sổ preview. Không cần cài lại dependency mỗi lần chạy.

## 3. Mô phỏng ESP32 không cần phần cứng

Chạy:

```powershell
npm.cmd run simulate:esp
```

Kết quả thành công:

```text
PASS plastic: ACK -> 1800 us -> DROP -> 1200 us; event plastic
PASS metal: ACK -> 1800 us -> DROP -> 1200 us; event metal
PASS link timeout: PC leaves READY and can handshake again
PASS: no hardware, no camera/model inference, no production writes
```

Lệnh compile và chạy **chính firmware trong repo** bằng phần cứng giả lập. Nó kiểm tra mở đúng ngăn, giữ ngăn còn lại đóng, đếm một vật một lần, đóng nắp khi trống và bắt tay lại sau khi mất ping.

Đây là mô phỏng tự động trong terminal, không mở giao diện thùng ảo và không ghi điểm lên website thật. Muốn kiểm tra cả Firebase và cộng điểm, chạy tiếp mục 4.

Nếu Python nằm ở vị trí khác, có thể chỉ định executable cho simulator và test tích hợp trong cửa sổ hiện tại:

```powershell
$env:GS_PYTHON = "C:\duong-dan-thuc-te\python.exe"
npm.cmd run simulate:esp
```

## 4. Kiểm thử đăng nhập và cộng điểm trên Firebase local

### Kiểm thử toàn bộ luồng tự động

Đóng emulator đang chạy trước, rồi chạy:

```powershell
npm.cmd run test:emulators
```

Lệnh tự bật Auth, Database và Hosting emulator cho project **`demo-green-school`**, tạo dữ liệu kiểm thử, chạy backend trong tiến trình test rồi tắt emulator. Không cần khóa service account hoặc chạy `npm.cmd run backend` riêng.

Test kiểm tra đăng nhập, tạo phiên học sinh, Python điều khiển firmware mô phỏng, event đi qua Database Rules, cộng **2 điểm nhựa / 3 điểm kim loại** và xử lý lại không cộng trùng. Thành công khi hiện test pass và `Script exited successfully (code 0)`.

Dữ liệu này nằm trong emulator, không xuất hiện trên `smarttrashbin-98428.web.app`. Lần đầu emulator có thể cần Internet để tải thành phần chạy. Test tích hợp cần Python và g++ ở mục 2.

### Muốn mở web local để xem giao diện

**Cửa sổ 1**, bật emulator và giữ cửa sổ mở:

```powershell
npm.cmd run emulators
```

**Cửa sổ 2**, chỉ tạo dữ liệu mẫu khi database local còn trống:

```powershell
npm.cmd run seed:emulators
```

Mở **http://127.0.0.1:5000/?firebase=emulator**. Giữ `?firebase=emulator` để web chọn đúng môi trường local.

| Vai trò | Tên đăng nhập | Mật khẩu |
| --- | --- | --- |
| Admin local | `admin` | `admin123` |
| Học sinh local | `hs10a1` | `123456` |

Emulator UI: **http://127.0.0.1:4000**. Nếu seed báo database không trống, giữ dữ liệu hiện có; không cần seed lại. Khi dừng bằng Ctrl+C, lệnh emulator lưu dữ liệu vào `.emulator-data/` để lần sau nạp lại.

Chế độ mở web này phục vụ xem giao diện/dữ liệu; nó chưa tự chạy backend cộng điểm hoặc nối với simulator. Dùng test tự động phía trên để kiểm tra trọn luồng. Không chạy hai bộ emulator cùng lúc.

## 5. Chạy AI với phần cứng thật

Chỉ làm mục này khi đã có ESP32 và thiết bị nối vào máy tính.

### 5.1. Chuẩn bị tài khoản và thùng

- Website thật: **https://smarttrashbin-98428.web.app/**.
- Project Firebase: `smarttrashbin-98428`.
- Tài khoản học sinh mẫu: **`hs_mau_esp`**, lớp **11T2**, mã **ESP-DEMO-001**.
- Mật khẩu: [secrets/TAI_KHOAN_HOC_SINH_MAU.md](secrets/TAI_KHOAN_HOC_SINH_MAU.md). Đây là tài khoản cloud, khác tài khoản emulator ở mục 4.

Trên trang admin, kiểm tra thùng `BIN-01` tồn tại. Nội dung `hardware/bin_config.json` phải khớp:

```json
{ "bin_id": "BIN-01" }
```

QR, ID thùng trên Firebase và config laptop phải giống nhau. Đổi config thì khởi động lại camera/bridge.

### 5.2. Chuẩn bị khóa backend

Giữ nguyên `.env` và khóa đang chạy được. Nếu chưa có `.env`:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Trong `.env`, đặt đường dẫn đến **file service account thực tế** của project `smarttrashbin-98428`, ví dụ:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-service-account.json
```

File ví dụ trên không tự được tạo khi copy `.env.example`. Nếu chưa có khóa, xem [DEPLOYMENT.md](DEPLOYMENT.md). Khóa chỉ dùng cho backend, giữ trong `secrets/`, không chép vào `assets/` hoặc `public/`. Camera/ESP32 không cần mật khẩu thiết bị hay khóa quản trị.

### 5.3. Đấu nối và nạp firmware

| Thiết bị | GPIO |
| --- | --- |
| HC-SR04 đếm ngăn nhựa: TRIG / ECHO | 22 / 23 |
| HC-SR04 đếm ngăn kim loại: TRIG / ECHO | 13 / 14 |
| Servo ngăn nhựa / kim loại | 18 / 19 |
| Module còi kích LOW | 27 |

Dùng số GPIO; rút nguồn trước khi đấu dây. Servo dùng nguồn phù hợp và chung GND với ESP32; không cấp nguồn servo từ GPIO. ECHO cần chuyển mức/chia áp nếu vượt giới hạn điện áp ESP32.

Mở `hardware/Green-School/Green-School.ino` trong Arduino IDE. Cài board ESP32 và thư viện **ESP32Servo**, chọn đúng board/cổng COM. Bản đã kiểm thử compile dùng ESP32 Dev Module, ESP32 core 3.3.12 và ESP32Servo 3.2.1; chọn board theo thiết bị thực tế.

Giữ chế độ AI:

```cpp
#define AI_CONTROL_ENABLED 1
```

Đóng camera/bridge/Serial Monitor đang giữ COM rồi Verify và Upload. Firmware hiện đặt servo 50 Hz, đóng 1200 µs, mở 1800 µs; xác nhận chiều và hành trình trên cơ cấu thật trước vận hành. Có thể dùng `hardware/Servo-Test/Servo-Test.ino` để thử riêng servo sau khi tháo liên kết nắp; sau đó nạp lại firmware Green-School.

### Test nhanh cảm biến → servo (không cần Python)

Nạp `hardware/Sensor-Servo-Test/Sensor-Servo-Test.ino`, thư viện **ESP32Servo**, rồi mở Serial Monitor **115200 baud**. Ngăn 1 dùng TRIG/ECHO 23/34 và servo 18; ngăn 2 dùng 22/35 và servo 19. Đưa vật cách cảm biến **2–6 cm** trong hai mẫu liên tiếp: bộ đếm tăng một lần và servo tương ứng mở (1800 µs). Lấy vật ra **> 8 cm**, nắp đóng sau khoảng 2 giây (1200 µs); giữ vật hoặc mất ECHO thì giữ mở. Số đo dưới 2 cm không tạo lượt đếm.

Tháo liên kết nắp khi thử lần đầu; servo dùng nguồn riêng phù hợp và chung GND, ECHO HC-SR04 cần chuyển mức xuống 3,3 V. Sketch chỉ test phần cứng, không ghi Firebase; nạp lại `Green-School.ino` trước khi chạy camera AI.

### 5.4. Kiểm tra model và thử camera riêng

```powershell
.\.venv\Scripts\python.exe hardware/download_camera_model.py
.\.venv\Scripts\python.exe hardware/camera_ai.py --check-model
.\.venv\Scripts\python.exe hardware/camera_ai.py --camera 0 --fps 5 --dry-run
```

Trước khi chạy, lấy hết vật/tay khỏi ô giữa ảnh. Chương trình tự lấy nền lúc khởi động; đợi `MODEL OK` và giữ ô trống khoảng 1 giây đến khi thấy `CLEAR`, không cần nhấn C. Đưa chai nhựa/lon vào thử; Q hoặc Esc để thoát. Nếu camera 0 không đúng, thử `--camera 1`.

`--dry-run` chỉ thử camera/model, không mở servo hay ghi Firebase. Giữ camera và ánh sáng cố định; nếu thay đổi thì lấy vật ra và calibrate bằng C lại. Model chỉ cho nhãn `plastic`/`metal` mở ngăn; thông tin artifact và giấy phép ở [hardware/models/README.md](hardware/models/README.md).

### 5.5. Chạy hệ thống mỗi ngày

Mở **hai cửa sổ PowerShell tại thư mục project**.

**Cửa sổ 1 — backend cộng điểm:**

```powershell
npm.cmd run backend
```

Đợi `Backend ready: smarttrashbin-98428` rồi giữ cửa sổ mở.

**Cửa sổ 2 — camera và USB:** thay `COM5` bằng cổng ESP32 thực tế.

```powershell
.\.venv\Scripts\python.exe hardware/camera_ai.py --camera 0 --fps 5 --port COM5
```

Trước khi chạy, lấy vật/tay khỏi ô camera để chương trình tự lấy nền. Đợi `MODEL OK`, `GS_AI_READY 1` và `CLEAR`, không cần nhấn C. Hai cảm biến đếm cần đọc trống hợp lệ (> 8 cm) để firmware sẵn sàng. Chỉ một ứng dụng được giữ COM; đóng Serial Monitor và không chạy thêm bridge.

Học sinh thao tác:

1. Đăng nhập website bằng tài khoản học sinh. Quét QR hoặc mở https://smarttrashbin-98428.web.app/#/scan/BIN-01 để tạo phiên đúng thùng.
2. Đưa **một** vật nhựa/kim loại vào ô camera. Mặc định cần confidence ≥ 0,75 và 3 mẫu ổn định; phiên còn ít nhất 6 giây, rule đang bật.
3. Khi log có `ARM` và firmware trả `GS_AI_ACK`, nắp đúng ngăn được ra lệnh mở. **Nắp mở rồi mới thả rác.** Quét QR đơn thuần chưa mở servo.
4. Cảm biến đúng ngăn xác nhận rác: log `GS_AI_DROP`, sau đó `SENT USB-...`. Backend hiện `PROCESSED` hoặc `REJECTED` kèm lý do.
5. Lấy tay/vật ra, đợi nắp đóng, `GS_AI_DONE` và ô camera clear trước lượt tiếp theo. Kiểm tra lịch sử/điểm trên web.

`SENT` nghĩa Firebase đã nhận event; **`PROCESSED` mới xác nhận cộng điểm**. Mặc định nhựa 2 điểm, kim loại 3 điểm, cooldown 3 giây và phiên 3 phút; admin có thể thay đổi. Hết phiên thì chọn **Bỏ rác tiếp** hoặc quét QR lại.

Nếu lắp ngăn 1 kim loại, ngăn 2 nhựa, dùng mapping đảo ở Python:

```powershell
.\.venv\Scripts\python.exe hardware/camera_ai.py --camera 0 --fps 5 --port COM5 --sensor1 metal --sensor2 plastic
```

Camera QR trên điện thoại và camera phân loại trên laptop khác vai trò. Nếu dùng cùng webcam cho web và Python, phải dừng camera trên web trước.

## 6. Chạy thủ công không AI

Đổi `AI_CONTROL_ENABLED` thành `0` rồi nạp lại firmware. Chế độ này **mở nắp bằng tay**, chỉ đếm rác/còi; sensor 1 quy ước nhựa, sensor 2 kim loại.

**Cửa sổ 1:**

```powershell
npm.cmd run backend
```

**Cửa sổ 2:**

```powershell
.\.venv\Scripts\python.exe hardware/firebase_http_bridge.py --port COM5
```

Học sinh đăng nhập và mở phiên QR trước khi bỏ rác. Vật ≤ 6 cm tạo `GS_DROP`; cần ra > 8 cm mới đếm lượt tiếp. Không chạy camera AI đồng thời trên cùng COM.

## 7. Dừng và khởi động lại

- Q/Esc hoặc Ctrl+C để dừng camera trước. Chờ backend xử lý event cuối rồi Ctrl+C backend.
- Firmware thu hồi quyền khi mất ping > 3 giây và báo `GS_AI_OFFLINE 1`; Python bắt tay lại. Cần cả firmware và Python bản cập nhật.
- Rút USB hoặc chương trình dừng vì lỗi: xử lý kết nối, kiểm tra cảm biến trống rồi chạy lại. Khi chạy lại, giữ ô camera trống để chương trình tự lấy nền mới.
- Khi đã mở, nắp đóng sau khoảng 2 giây kể từ khi quyền kết thúc và cảm biến đọc trống; còn vật hoặc mất ECHO sẽ giữ mở. Cảm biến đếm không quan sát toàn bộ hành trình nắp, cần kiểm tra cơ khí thật.
- Queue gửi event nằm trong RAM, tối đa 100 lượt, thời hạn gửi 30 giây. Tắt chương trình/mất nguồn có thể mất lượt chưa gửi; không tự tạo ID mới để gửi lại một lượt cũ.

## 8. Tra lỗi nhanh

| Hiện tượng | Việc cần làm |
| --- | --- |
| Python báo không tìm thấy executable | Kiểm tra Python gốc còn tồn tại và `.venv` dùng đúng bản cài; chạy lệnh `--version` ở mục 2 |
| Simulator báo thiếu g++ | Kiểm tra `g++ --version`, cài compiler C++17 hoặc sửa PATH |
| Thiếu module Python | Cài đúng requirements vào `.venv`, không cài sang Python khác |
| Emulator không bật | Kiểm tra JDK21 và các cổng 4000, 4400, 4500, 5000, 9000, 9099; tắt bộ emulator cũ |
| Web local không thấy dữ liệu mẫu | Mở đúng URL có `?firebase=emulator`; seed một lần khi database local trống |
| `WAIT_FIRMWARE` / chưa READY sau 15 giây | Kiểm tra firmware AI, COM/baud và hai cảm biến đếm trống, không mất ECHO |
| `Firmware is in manual mode` | Nạp firmware `AI_CONTROL_ENABLED=1` để chạy camera, hoặc dùng bridge thủ công với firmware 0 |
| `Access denied` ở COM | Đóng Serial Monitor và ứng dụng khác đang giữ cổng |
| `WAIT_FIREBASE` | Kiểm tra Internet, config thùng và khả năng đọc phiên/settings |
| `SCAN_QR` | Mở/gia hạn phiên đúng thùng bằng tài khoản học sinh |
| `WAIT_CLEAR` | Lấy vật/tay ra và đợi CLEAR. Nếu nền lúc khởi động có vật hoặc camera/ánh sáng thay đổi, nhấn c khi ô trống để lấy nền lại |
| READY nhưng không ARM | Kiểm tra nhãn, confidence/frame, rule, cooldown và phiên còn ≥ 6 giây; READY chưa phải lệnh mở |
| Có ACK nhưng servo không quay | Kiểm tra nguồn, chung GND, dây GPIO18/19 và hành trình; ACK không xác nhận vị trí thực |
| `BIN_BLOCKED` / log `GS_BIN_BLOCKED n occupied\|no_echo` | Cảm biến ngăn n đọc ≤ 8 cm hoặc mất ECHO quá 10 giây: đổ rác/gỡ vật kẹt hoặc kiểm tra dây ECHO. `no_echo` gồm cả số đo nhiễu dưới 2 cm: kiểm tra VCC 5V, chung GND, dây ECHO và mạch chia áp xuống GPIO34/35. Hết kẹt sẽ có `GS_BIN_CLEAR n` và chương trình tự bắt tay lại |
| `WAIT_DONE` lâu / nắp không đóng | Kiểm tra ECHO, lấy vật khỏi cảm biến đếm > 8 cm, chờ timer; không bỏ qua trạng thái để ép mở tiếp |
| Backend không đọc được khóa | Kiểm tra đường dẫn `.env`, file JSON và đúng project; không in/chia sẻ private key |
| HTTP 401/403 | Kiểm tra Rules, thùng/phiên/mapping và giờ laptop; bridge không cần tài khoản thùng |
| SENT nhưng chưa có điểm | Giữ backend chạy, tìm cùng event ID trong log và xem processed/rejected |

Web báo thùng online dựa trên heartbeat; trạng thái đó không đo sức khỏe camera hoặc vị trí servo.

## 9. Kiểm thử và tài liệu liên quan

```powershell
npm.cmd test
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
npm.cmd run simulate:esp
npm.cmd run test:emulators
```

Lần kiểm tra ngày 07/11/2026 đã đạt: 26 test Node, 30 test Python, mô phỏng ESP, harness firmware AI/thủ công và kiểm thử tích hợp emulator. Firmware AI đã compile bằng toolchain ESP32. Test ONNX thật chỉ chạy khi model đã tải; nếu chưa có sẽ skip.

Chưa kiểm chứng servo, nguồn, cảm biến hoặc độ chính xác camera trên thùng thật trong lần này. Nhãn/khoảng cách tổng hợp của simulator không thay thế kiểm thử thiết bị. Khi có hardware, thử từng ngăn và nhiều lượt nhựa/kim loại/lượt âm tính trước khi cho học sinh vận hành.

- [MO_PHONG_ESP.md](MO_PHONG_ESP.md): cấu trúc project, lỗi mất liên kết đã sửa và phạm vi mô phỏng.
- [hardware/README_HTTP_BRIDGE.md](hardware/README_HTTP_BRIDGE.md): giao thức USB và cách bridge gửi event.
- [hardware/models/README.md](hardware/models/README.md): model, checksum và giấy phép.
- [DEPLOYMENT.md](DEPLOYMENT.md): cấu hình cloud và triển khai. Chạy laptop hằng ngày không cần deploy web/Rules lại.
- [CAMERA_AI_PLAN.md](CAMERA_AI_PLAN.md): các tiêu chí cần kiểm tra thêm trên thiết bị.
