# Project Green School và mô phỏng ESP32

Kiểm tra ngày 07/11/2026 (Asia/Bangkok), không có phần cứng thật.

## Luồng hoạt động

1. Web đăng nhập Firebase Auth. `users`, `usernames`, `students` gắn tài khoản với học sinh/lớp (`assets/js/core/services.js`).
2. Quét QR tạo/gia hạn `bins/BIN-01/activeSession`. Quét QR cấp phiên tích điểm, chưa ra lệnh servo.
3. `hardware/camera_ai.py` kiểm tra phiên/settings, nền camera đã clear, nhãn nhựa/kim loại, confidence ≥ 0,75 và ba frame ổn định rồi gửi `GS_AI_ARM` qua USB.
4. `hardware/Green-School/Green-School.ino` mở servo tương ứng: GPIO18 nhựa, GPIO19 kim loại; mở 1800 µs, đóng 1200 µs.
5. Cảm biến đếm đúng ngăn thấy cạnh rác mới ≤ 6 cm sau khi nắp đã mở thì phát `GS_AI_DROP`. Giữ vật không đếm lại; cần đọc > 8 cm để nhả.
6. `FirebaseBridge.send_drop()` tạo event pending đúng phiên. `backend/worker.cjs` và `scoring.cjs` kiểm tra rồi cập nhật điểm/lịch sử/thống kê trong transaction. Hosting chỉ phục vụ web; backend và camera cần chạy trên laptop.

## Tài khoản học sinh mẫu đã tạo

- Firebase thật: `smarttrashbin-98428`.
- Đăng nhập: `hs_mau_esp`.
- Họ tên: Học sinh mô phỏng ESP; lớp `11T2`; mã `ESP-DEMO-001`.
- Mật khẩu và xác nhận tạo/đăng nhập: [file riêng](secrets/TAI_KHOAN_HOC_SINH_MAU.md).
- Website: https://smarttrashbin-98428.web.app/.

Đã kiểm tra Email/Password thành công. Không mở phiên thử hoặc cộng điểm thử trên hệ thống thật. File mật khẩu nằm trong `secrets/` được Git bỏ qua và không nằm trong gói Hosting.

## Lỗi đã tái hiện và sửa

ESP32 thu hồi quyền AI nếu không nhận ping trong hơn 3 giây, nhưng trước đây không báo cho Python. Laptop vẫn giữ `ready=True`; ARM tiếp theo có thể bị firmware từ chối và chỉ phục hồi khi lượt đó hết thời gian chờ ACK. Preview có thể hiện READY dù hai phía chưa đồng bộ.

Mô phỏng chạy chính firmware C++: bắt tay → chạy thời gian ảo hơn 3 giây không ping → kiểm tra controller. Trước sửa, assert thất bại: `PC still reports READY after the firmware link expired`.

Đã sửa tại nguồn:

- Firmware gửi `GS_AI_OFFLINE 1` khi hết hạn liên kết.
- Python bỏ READY, thu hồi lượt đang chờ và đặt lại thời gian chờ handshake. Luồng serial gửi HELLO lại; firmware chỉ trả READY khi cảm biến/nắp hợp lệ.
- Lượt đã hủy không được xác nhận cộng điểm. Reconnect vẫn phải đợi camera clear và nhận diện lại.

Cần dùng đồng thời firmware và Python cập nhật để có thông báo này. Đây là lỗi phần mềm chứng minh được, chưa phải kết luận về một sự cố servo vật lý cụ thể.

## Vì sao nắp có thể chưa mở

| Điều kiện | Cách hiểu |
| --- | --- |
| Chỉ đăng nhập/quét QR | Chưa có phân loại rác và ARM; nắp chưa mở là đúng luồng |
| `WAIT_FIRMWARE` | Chưa bắt tay hoặc mất liên kết |
| `WAIT_FIREBASE` | Snapshot phiên/settings đã cũ hoặc mạng chưa sẵn sàng |
| `SCAN_QR` | Chưa có phiên hợp lệ còn ít nhất 6 giây |
| `WAIT_CLEAR` | Calibrate ô trống bằng C rồi chờ clear ít nhất 1 giây |
| READY nhưng chưa ARM | Cần vật nhựa/kim loại đủ confidence/frame và rule bật; READY không đo vị trí servo |
| Cảm biến đếm có vật hoặc mất ECHO | Firmware từ chối bắt tay/mở chu kỳ mới; không bỏ qua điều kiện này |
| Firmware `AI_CONTROL_ENABLED=0` | Chỉ đếm rác; mở nắp bằng tay theo thiết kế hiện tại |
| Camera `--dry-run` | Không kết nối USB/Firebase |

Heartbeat trên web không chứng minh camera/servo sẵn sàng. Nguồn, GND, dây GPIO và hành trình cơ khí cần kiểm tra riêng khi có thiết bị.

## Chạy mô phỏng không cần ESP32

```powershell
npm.cmd run simulate:esp
```

Cần Python và g++ có C++17. Windows mặc định dùng `.venv/Scripts/python.exe`; có thể chỉ định executable bằng biến `GS_PYTHON`. Không cần camera, COM, ONNX runtime hay Internet. Không ghi Firebase.

- `tests/firmware/esp_simulator.cpp` include sketch thật; stub thay HC-SR04, serial, servo và đồng hồ.
- `hardware/simulate_esp.py` compile simulator, chạy `TurnController` thật với nhãn tổng hợp, đọc ACK/DROP/DONE, kiểm tra xung servo và gọi `FirebaseBridge.send_drop()` với transport trong RAM.
- Kiểm tra cả hai ngăn: chưa clear không ARM, mở đúng ngăn, ngăn khác đóng, một vật chỉ đếm một lần, đóng lại khi clear, thiếu ECHO/còn vật không READY, mất ping phải bỏ READY rồi bắt tay lại.

```text
PASS plastic: ACK -> 1800 us -> DROP -> 1200 us; event plastic
PASS metal: ACK -> 1800 us -> DROP -> 1200 us; event metal
PASS link timeout: PC leaves READY and can handshake again
PASS: no hardware, no camera/model inference, no production writes
```

## Kiểm thử và kết quả

```powershell
npm.cmd test
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
npm.cmd run test:emulators
```

Đã đạt: 26 test Node, 30 test Python (có smoke test model ONNX thật), harness firmware AI/thủ công, mô phỏng ESP và tích hợp Auth/Database Rules/backend trên emulator. Firmware AI cũng compile thành công bằng ESP32 core 3.3.12 + ESP32Servo đã cài.

Emulator cần JDK21, Python và g++. Tài khoản local: `hs10a1` / `123456`, khác tài khoản cloud trên. Test tích hợp lấy event từ Python + firmware mô phỏng, kiểm tra cộng 2 điểm nhựa/3 điểm kim loại và xử lý lại không cộng trùng. Tổng test lớp 10A1 tăng từ 4 lên 9 điểm; toàn bộ ở project local `demo-green-school`.

Giới hạn: nhãn AI/khoảng cách tổng hợp; không mô phỏng nguồn điện, tải servo, echo nhiễu, mất byte USB hay hiệu suất camera thật. Chưa kiểm thử trình duyệt tự động hoặc upload firmware vì chưa có board. Không deploy Hosting/Rules vì bản sửa nằm ở firmware và Python local.
