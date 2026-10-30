# Green School — setup và vận hành

Web Firebase: **https://smarttrashbin-98428.web.app/**
Firebase project: `smarttrashbin-98428`. Hướng dẫn cập nhật 30/10/2026.

Hệ thống có hai chế độ: **camera AI** chọn đúng ngăn rồi cảm biến khoảng cách mở nắp; hoặc **thủ công** mở nắp theo khoảng cách như trước. Cả hai giữ cảm biến đếm rác, còi và backend cộng điểm. Chế độ mặc định của firmware mới là AI; phải nạp firmware tương ứng trước khi chọn chương trình chạy trên laptop.

## 1. Toàn bộ flow

```text
Web học sinh -> Firebase Auth -> quét QR -> bins/<binId>/activeSession

Camera trên laptop -> WasteWise ONNX -> phiên hợp lệ + nhãn ổn định
                                      -> USB cấp quyền đúng ngăn
ESP32: được cấp quyền + vật gần ≤ 10 cm -> servo mở nắp
ESP32: cảm biến đếm phát hiện rác ≤ 6 cm -> USB xác nhận lượt
Python trên laptop -> Firebase events/<txId> (pending)
Backend Node.js trên laptop -> kiểm tra + cộng điểm atomically
Firebase -> web cập nhật điểm, lịch sử, lớp và bảng xếp hạng realtime
```

- **Firebase Hosting** phục vụ web, **Authentication** đăng nhập, **Realtime Database/Rules** lưu và kiểm tra dữ liệu. AI và backend Node.js chạy trên laptop, không chạy trong Hosting.
- Học sinh dùng web để đăng nhập, quét QR, gia hạn/kết thúc phiên và xem điểm. Admin quản lý lớp/học sinh/tài khoản, thùng/QR, quy tắc điểm và thống kê.
- ESP32 không chạy AI, không dùng Wi-Fi và không trực tiếp gửi Firebase. ESP32 tiếp tục đọc bốn cảm biến, điều khiển servo/còi và báo USB.
- Không cần Blaze hoặc Cloud Functions cho kiến trúc này. Laptop cần Internet, backend và chương trình camera/bridge phải cùng chạy.
- Đóng trang admin không dừng cộng điểm. Tắt backend thì pending chưa được xử lý, dù web cloud vẫn mở được.

| Thành phần | File chính |
| --- | --- |
| Web nguồn | `index.html`, `assets/` |
| Firmware | `hardware/Green-School/Green-School.ino` |
| Camera AI + USB | `hardware/camera_ai.py` |
| Tải model đã ghim phiên bản | `hardware/download_camera_model.py` |
| Bridge thủ công / sender dùng chung | `hardware/firebase_http_bridge.py` |
| ID thùng | `hardware/bin_config.json` |
| Backend cộng điểm | `backend/index.cjs`, `worker.cjs`, `scoring.cjs` |
| Cấu hình/quyền Firebase | `assets/js/config.js`, `firebase/database.rules.json` |

## 2. Phần mềm cần cài một lần

Windows: Node.js **22.9+**, Python **3.12 64-bit** (đã kiểm thử), Arduino IDE, ESP32 board package, thư viện **ESP32Servo**, driver USB phù hợp và webcam nối máy tính.

Firmware đã compile cho **ESP32 Dev Module** (`esp32:esp32:esp32`) với **ESP32 core 3.3.12** và **ESP32Servo 3.2.1**. Board vật lý chưa kết nối khi kiểm thử; chọn profile phù hợp board thực tế trước Upload, không suy ra model board từ kết quả compile này.

Nếu `py` báo `No installed Python found`, cần cài Python thật, không chỉ Python Launcher. Nếu máy dùng lệnh `python` thay vì `py -3.12`, thay lệnh tạo venv tương ứng. Sau khi tạo venv, dùng đúng executable trong `.venv` để tránh cài nhầm môi trường.

Mở PowerShell tại thư mục project:

```powershell
node --version
npm.cmd --version
py -3.12 --version
npm.cmd ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r hardware/requirements-camera.txt
```

Không cần activate venv hoặc đổi PowerShell execution policy. Không cài `opencv-python-headless` chung với `opencv-python` trong venv này vì ứng dụng cần cửa sổ preview. Dependency model dùng CPU, không cần CUDA/GPU.

Chỉ chạy thủ công, không camera: có thể chỉ cài `hardware/requirements.txt` thay vì requirements-camera. Không chạy `npm install`/cài Python packages mỗi lần bật hệ thống.

## 3. Chuẩn bị Firebase và khóa backend

Với project hiện tại, cấu hình web đã nằm trong `assets/js/config.js`, database URL có sẵn trong backend và bridge. Không cần tạo lại project, tài khoản hoặc Rules mỗi lần chạy. Nếu dùng một Firebase project khác, phải cập nhật đồng bộ ba nơi đó và Hosting/site config; đổi mỗi bin ID không đổi Firebase project.

Backend cần service account đúng project, còn camera/bridge không dùng khóa quản trị hoặc tài khoản thiết bị:

1. Mở [Firebase Console → Service accounts](https://console.firebase.google.com/project/smarttrashbin-98428/settings/serviceaccounts/adminsdk).
2. Nếu đã có `.env`/khóa chạy được, giữ nguyên. Nếu chưa có, Generate new private key và lưu JSON trong `secrets/`.
3. Sao chép `.env.example` thành `.env` nếu chưa tồn tại:

   ```powershell
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
   ```

4. Đặt đúng đường dẫn/tên file thực tế:

   ```dotenv
   GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-service-account.json
   ```

Khóa chỉ nằm trên laptop tin cậy, không đưa vào Git, `assets/`, `public/`, model hay firmware. `firebase login` không thay thế service account cho backend. Không cần chia sẻ nội dung khóa để setup.

Nếu dựng Firebase mới, bật Email/Password Authentication, tạo Realtime Database, cấu hình Web App rồi áp dụng Rules tương ứng. Xem [DEPLOYMENT.md](DEPLOYMENT.md). Bản camera không yêu cầu đổi schema/Rules hoặc deploy web mới; không nhầm setup local với deploy cloud.

## 4. Chuẩn bị học sinh, thùng và QR trên web

1. Đăng nhập admin bằng tài khoản `ADMIN` và mật khẩu đã thiết lập trong Firebase Auth.
2. Kiểm tra lớp, học sinh và tài khoản cloud đang hoạt động, gắn đúng lớp.
3. Vào **Thùng rác & QR**, tạo/chọn thùng, ví dụ `BIN-01`, in/dán QR tương ứng.
4. Sửa `hardware/bin_config.json` để khớp chính xác:

   ```json
   { "bin_id": "BIN-01" }
   ```

QR, thùng trong Firebase và config laptop phải cùng ID; không tự sinh ID từ COM. Đổi config thì khởi động lại chương trình camera/bridge. Bridge kiểm tra thùng tồn tại, không tự tạo thùng hoặc hỏi mật khẩu thiết bị.

Camera QR của web và camera phân loại của Python khác vai trò: nên quét QR bằng điện thoại, Python dùng webcam trên laptop. Nếu dùng cùng webcam cho trình duyệt và Python, dừng/giải phóng camera trên web trước khi mở chương trình Python.

## 5. Đấu nối và chức năng phần cứng được giữ lại

Rút nguồn trước khi đấu dây. Dùng số GPIO, không phải số thứ tự chân vật lý.

| Thiết bị | GPIO |
| --- | --- |
| Siêu âm mở nắp 1, TRIG/ECHO | 5 / 18 |
| Siêu âm mở nắp 2, TRIG/ECHO | 17 / 16 |
| Siêu âm đếm rác 1, TRIG/ECHO | 22 / 23 |
| Siêu âm đếm rác 2, TRIG/ECHO | 13 / 14 |
| Servo ngăn 1 / ngăn 2 | 19 / 21 |
| Module còi kích LOW | 27 |

Giữ ngưỡng mở **≤ 10 cm**, đếm **≤ 6 cm**, nhả đếm **> 8 cm**, tự đóng sau **2 giây** không còn vật gần, còi đặt **200 ms** và bộ đếm riêng từng ngăn. Servo đóng 0°, mở 90°, 50 Hz, xung 500–2.400 µs.

- Servo cần nguồn phù hợp và chung GND với ESP32; không cấp nguồn servo từ GPIO.
- Kiểm tra điện áp ECHO, dùng chuyển mức/chia áp khi vượt giới hạn board. Kiểm tra đúng loại còi kích LOW.
- Board/model cảm biến/nguồn cụ thể chưa được xác nhận trong repo; đối chiếu linh kiện thật và hành trình nắp trước cấp tải.
- Camera chỉ nối laptop, không nối GPIO ESP32.
- Khi đã mở, vật còn gần vẫn giữ nắp mở, kể cả hết quyền AI. Khi vật rời xa, nắp đóng theo timer. **Không có echo không được coi là đường đóng đã trống**, nên cảm biến lỗi có thể giữ nắp mở; kiểm tra và khắc phục cảm biến, không ép đóng vào vật.
- Chu kỳ lấy mẫu có delay nên thời điểm đóng/tắt còi thực tế có thể trễ hơn giá trị đặt. Đây không phải hệ thống chống kẹp chuyên dụng.

## 6. Nạp firmware và chọn chế độ

Mở `hardware/Green-School/Green-School.ino` bằng Arduino IDE; cài board ESP32 và thư viện `ESP32Servo`, chọn đúng board/COM. Đóng mọi bridge/camera/Serial Monitor đang giữ COM trước khi upload.

Ở đầu file:

```cpp
#ifndef AI_CONTROL_ENABLED
#define AI_CONTROL_ENABLED 1
#endif
```

- **AI:** giữ `1`. Đưa vật gần chưa tự mở; cần handshake và quyền ngăn từ `camera_ai.py`. Log khởi động `GS_AI_BOOT 1`.
- **Thủ công:** đổi giá trị thành `0`, Verify/Upload lại. Nắp mở theo khoảng cách như trước; chạy bridge thủ công ở mục 9. Log `GS_AI_MANUAL 1`.

Trong cả hai chế độ, bốn cảm biến, đếm, còi và log `GS_DROP` vẫn hoạt động. AI không tự chuyển sang thủ công khi PC mất kết nối. Khi bật nguồn/reset, firmware đặt hai servo về góc đóng, cần kiểm tra an toàn cơ khí trước khi thử.

Ở chế độ AI, khi cảm biến đếm đúng ngăn xác nhận sẽ có `GS_AI_DROP <id> <sensor> <counter>`. Camera dùng message này để gửi event, bỏ qua `GS_DROP` legacy để không cộng hai lần. `GS_AI_ACK` chỉ xác nhận nhận quyền, không chứng minh nắp đạt góc hay rác đã rơi.

Đóng Serial Monitor sau khi kiểm tra 115200 baud. Cổng COM chỉ được một chương trình giữ. Chi tiết giao thức ở [hardware/README_HTTP_BRIDGE.md](hardware/README_HTTP_BRIDGE.md).

## 7. Tải model, kiểm tra và thử camera trước

Model: [WasteWise Garbage Classifier](https://huggingface.co/SriramRokkam/wastewise-garbage-cls), YOLOv8n-cls ONNX CPU, tám loại rác, trong đó có `plastic`/`metal`. Chương trình chỉ cho hai nhãn này mở ngăn; các loại khác/không chắc chắn bị từ chối.

```powershell
.\.venv\Scripts\python.exe hardware/download_camera_model.py
.\.venv\Scripts\python.exe hardware/camera_ai.py --check-model
.\.venv\Scripts\python.exe hardware/camera_ai.py --camera 0 --fps 5 --dry-run
```

Downloader ghim revision/checksum, không tải “latest” ngẫu nhiên; runtime kiểm tra hash, input/output và nhãn trước chạy. Model tải về bị Git ignore. Chi tiết checksum và **giấy phép mâu thuẫn giữa model card và metadata** được ghi ở [hardware/models/README.md](hardware/models/README.md).

Trong preview:

1. Cố định camera, nền và ánh sáng, để một vùng đặt vật rõ trong ô vuông giữa ảnh.
2. **Lấy hết vật/tay ra khỏi ô vuông rồi nhấn C** để chụp nền trống. Đợi `CLEAR` ít nhất khoảng một giây.
3. Đưa từng chai nhựa/lon vào ô; xem nhãn, điểm và thời gian suy luận. Thử cả giấy, thủy tinh, tay và nền trống để tìm nhầm lẫn.
4. Sau mỗi lượt lấy vật khỏi vùng để nhận lượt tiếp. Thay góc camera/ánh sáng thì lấy hết vật ra và C lại; không calibrate với chai/tay trong ảnh.
5. Q/Esc hoặc Ctrl+C để dừng. Dry-run không mở COM, không truy cập Firebase và không điều khiển nắp.

`--fps 5` giới hạn suy luận tối đa 5 lần/giây, không ép FPS camera. Preview hiển thị FPS thực tế/mục tiêu và ms suy luận. Model chạy chậm thì bỏ frame cũ, không tích video. Nếu camera 0 không đúng, thử `--camera 1`.

Có thể thử một ảnh tĩnh mà không mở camera/USB/Firebase:

```powershell
.\.venv\Scripts\python.exe hardware/camera_ai.py --image C:/images/chai.jpg
```

Không hứa độ chính xác trên thùng thật từ điểm validation của tác giả. Bước đầu thử tối thiểu 30 lượt nhựa, 30 lượt kim loại và 30 lượt âm tính; ghi cả lượt từ chối/mở sai trước khi vận hành có người dùng.

## 8. Chạy AI hoàn chỉnh mỗi ngày

Sau setup/nạp firmware, mở **hai cửa sổ PowerShell tại project root**.

**Cửa sổ 1 — backend:**

```powershell
npm.cmd run backend
```

Đợi `Backend ready: smarttrashbin-98428`.

**Cửa sổ 2 — camera + USB, thay COM5 bằng cổng thật:**

```powershell
.\.venv\Scripts\python.exe hardware/camera_ai.py --camera 0 --fps 5 --port COM5
```

Đợi `MODEL OK`, `GS_AI_READY 1`, calibrate ô trống bằng C. Không chạy thêm `firebase_http_bridge.py`, bridge PowerShell hoặc `ei_bridge.py` trên COM đó.

1. Học sinh đăng nhập web, quét QR đúng thùng; ví dụ https://smarttrashbin-98428.web.app/#/scan/BIN-01. Đợi đúng học sinh/lớp và phiên hoạt động.
2. Đưa một vật vào ô camera. Khi đủ ba mẫu ổn định và điểm ≥ 0,85, chương trình log `ARM` và cấp quyền đúng ngăn trong 5 giây.
3. Đưa vật gần cảm biến mở nắp đúng ngăn ≤ 10 cm rồi thả vào. Ngăn còn lại không được mở theo lượt đó. Chỉ thấy vật trước camera chưa có điểm.
4. Cảm biến đếm xác nhận rác rơi; log `GS_AI_DROP`, sau đó `SENT USB-...`. Backend hiện `PROCESSED ... +... points` hoặc `REJECTED` kèm lý do.
5. Lấy tay/vật ra; đợi nắp đóng, cảm biến đếm nhả, `GS_AI_DONE` và ô camera clear trước lượt mới.
6. Kiểm tra lượt, điểm/lịch sử học sinh, điểm lớp và bảng xếp hạng realtime trên web.

`SENT` chỉ nghĩa Firebase nhận event, `PROCESSED` mới là đã cộng điểm. Mặc định nhựa 2 điểm, kim loại 3 điểm, cooldown 3 giây, phiên 3 phút. Admin có thể đổi settings; Python không tự cộng điểm. Backend gia hạn phiên khi xử lý lượt hợp lệ. Phiên hết hạn thì chọn **Bỏ rác tiếp** hoặc quét QR lại; không bỏ rác trước rồi quét QR sau.

Nếu lắp ngăn 1 kim loại, ngăn 2 nhựa:

```powershell
.\.venv\Scripts\python.exe hardware/camera_ai.py --camera 0 --fps 5 --port COM5 --sensor1 metal --sensor2 plastic
```

Có thể chỉnh `--threshold 0.9`, `--stable-frames 4`, `--config <file>`. Hai mapping phải khác nhau. Không giảm threshold chỉ để ép một vật khó nhận diện được tính điểm.

Trạng thái preview: `WAIT_FIRMWARE` đợi firmware, `WAIT_FIREBASE` đợi dữ liệu phiên/settings mới, `SCAN_QR` cần mở/gia hạn phiên, `WAIT_CLEAR` đợi ô trống, `READY` đã clear (vẫn phải có loại rác hợp lệ), `WAIT_ACK`, `WAIT_DROP`, `WAIT_DONE`. Web “thùng đang kết nối” dựa trên heartbeat, **không chứng minh camera/model/servo đang sẵn sàng**; xem preview/log khi chẩn đoán.

## 9. Chạy thủ công không AI

Chọn `AI_CONTROL_ENABLED 0` và upload lại firmware. Chế độ này không xác minh vật liệu; sensor 1/2 được quy ước thành nhựa/kim loại.

```powershell
# Cửa sổ 1:
npm.cmd run backend
# Cửa sổ 2:
.\.venv\Scripts\python.exe hardware/firebase_http_bridge.py --port COM5
```

Các bước QR/phiên/cảm biến/cộng điểm như mục 8. Test độc lập trên bàn: vật gần ≤ 10 cm mở nắp, bỏ ra xa đóng sau khoảng 2 giây; vật qua cảm biến đếm ≤ 6 cm tạo `GS_DROP`, phải ra > 8 cm mới đếm tiếp.

## 10. Dừng, khởi động lại và giới hạn

- Q/Esc/Ctrl+C camera trước, chờ backend xử lý event cuối rồi dừng backend. Camera cố gửi CANCEL cho lượt đang chờ; ESP32 mất ping quá 3 giây cũng thu hồi quyền. Nắp đang mở vẫn hoàn thành đóng theo khoảng cách, không ép đóng ngay khi mất PC.
- Cảm biến đếm/còi và bộ đếm cục bộ vẫn chạy khi PC/mạng lỗi, nhưng không có quyền AI thì không mở lượt mới hoặc tự cộng điểm. Bộ đếm ESP32 ở RAM, reset về 0.
- Tắt chương trình/mất nguồn có thể mất event chưa gửi trong queue RAM, tối đa 100 lượt, TTL gửi 30 giây. Pending đã ở Firebase quá 60 giây hoặc phiên hết hạn có thể bị backend từ chối khi chạy lại.
- Snapshot phiên ngăn đổi học sinh giữa lượt; backend vẫn kiểm tra lại. Monitor phiên/settings polling nên thay đổi có thể có độ trễ; lượt không hợp lệ không được bảo đảm cộng điểm.
- Một vật mỗi lượt. Model học bề ngoài, không đo chất liệu và có thể nhầm vật sơn/bọc. Kiểm tra nền chỉ phù hợp camera/ánh sáng cố định; chưa phải detector hoặc hệ thống chống gian lận.
- ID thùng là định danh, không phải xác thực phần cứng. Ai biết dữ liệu bin/phiên có thể giả gửi event/heartbeat; Rules không cho bridge ghi trực tiếp điểm hoặc sửa event cũ.

## 11. Xử lý lỗi

| Hiện tượng | Kiểm tra |
| --- | --- |
| Python/py không chạy | Cài Python 3.12 thật, tạo venv bằng executable đúng; đừng chỉ cài Launcher |
| Thiếu module / preview lỗi GUI | Cài requirements-camera trong đúng venv; không dùng headless OpenCV |
| Checksum mismatch | File không đúng artifact; đổi tên/loại file lỗi rồi chạy downloader lại, không bỏ qua hash |
| Camera không mở / ảnh đứng | Kiểm tra index, quyền Windows, cáp và app/trình duyệt khác giữ camera |
| Không có `GS_AI_READY` sau 15 giây | Firmware AI đã nạp chưa, đúng COM/baud, hai nắp/cảm biến có đang bận/kẹt không; lỗi thì dừng và khởi động lại sau khi clear |
| `Firmware is in manual mode` | Upload lại với `AI_CONTROL_ENABLED 1`, hoặc dùng bridge thủ công với firmware 0 |
| Access denied ở COM | Đóng Serial Monitor/bridge cũ/app khác; chỉ camera hoặc bridge được giữ COM |
| Camera nhận đúng nhưng không ARM | Calibrate C khi trống; đợi clear, đúng phiên QR còn ít nhất 6 giây, rule đang bật, đúng mapping và đủ confidence/frame |
| Đã ARM nhưng không mở | Đưa vật gần đúng cảm biến ≤ 10 cm trong hạn 5 giây; kiểm tra dây/nguồn servo và ACK |
| `WAIT_DONE` lâu / nắp không đóng | Lấy vật ra khỏi hai cảm biến đếm > 8 cm, khỏi cảm biến nắp > 10 cm; kiểm tra echo. Không tự bypass trạng thái để mở tiếp |
| Camera STOPPED / USB rút | Ngừng dùng, xử lý thiết bị, khởi động lại; không hứa phục hồi lượt chưa gửi |
| Backend không đọc được key | Kiểm tra `.env`, đúng tên file JSON, project_id và quyền service account; không in/chia sẻ khóa |
| HTTP 401/403 | Kiểm tra Rules, thùng/QR/config, phiên, loại rác và đồng hồ laptop; không cần tài khoản thùng |
| SENT nhưng chưa có điểm | Backend phải còn chạy, tìm cùng event ID trong log/Firebase; xem processed/rejected, không gửi lại bằng ID mới |
| REJECTED | Xem reason: cooldown, timestamp, tài khoản khóa, rule tắt, phiên hết hạn/đổi |

## 12. Kiểm thử và trạng thái bàn giao

Không cần hardware cho test Python/Node. Test model thật được chạy khi file ONNX đã tải; nếu chưa tải thì smoke test đó sẽ skip.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
npm.cmd test
# Cần JDK 21 và Firebase emulator; dùng demo-green-school, không production:
npm.cmd run test:emulators
```

Harness firmware không cần ESP32, cần g++ hỗ trợ C++17:

```powershell
New-Item -ItemType Directory -Path .cache -Force | Out-Null
g++ -std=c++17 -Wall -Wextra -I tests/firmware tests/firmware/firmware_test.cpp -o .cache/firmware-ai-test.exe
.\.cache\firmware-ai-test.exe
g++ -std=c++17 -Wall -Wextra -DAI_CONTROL_ENABLED=0 -I tests/firmware tests/firmware/firmware_test.cpp -o .cache/firmware-manual-test.exe
.\.cache\firmware-manual-test.exe
```

Harness kiểm tra gating, cảm biến, timer, đếm/còi, timeout và parser trong hai chế độ; không thay compile toolchain ESP32 hoặc kiểm tra cơ khí thật. Việc cài đặt code/model và các test tự động không chứng minh độ chính xác camera hoặc một lượt bỏ rác thật đã đạt.

Bản tích hợp này không tự upload firmware, không deploy Hosting/Rules và không tạo event thử trên production. Cần người vận hành thử camera/thùng thật theo mục 7–8 trước bàn giao cho học sinh.

Đã chạy: **26 test Python**, **26 test Node**, kiểm thử tích hợp **Auth/Database/Hosting Emulator + backend**, smoke test ONNX CPU và harness firmware AI/thủ công. Cả hai cấu hình firmware đã compile bằng ESP32 toolchain. Kết quả này chưa bao gồm đo độ chính xác bằng camera thật hoặc xác nhận rác rơi trên thùng thật.

- [hardware/README_HTTP_BRIDGE.md](hardware/README_HTTP_BRIDGE.md): giao thức và bridge.
- [hardware/models/README.md](hardware/models/README.md): model, hash, giấy phép.
- [CAMERA_AI_PLAN.md](CAMERA_AI_PLAN.md): phạm vi và các tiêu chí nghiệm thu còn cần làm trên thiết bị.
- [DEPLOYMENT.md](DEPLOYMENT.md): kiến trúc cloud và lịch sử triển khai.
