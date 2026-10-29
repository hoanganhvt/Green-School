# Gửi lượt bỏ rác từ laptop lên Firebase

Bridge đọc `GS_DROP` từ ESP32 qua USB và gửi HTTPS tới Firebase cloud.
Không cần tài khoản, email hoặc mật khẩu cho thùng rác. Học sinh và admin vẫn
đăng nhập web như trước.

## Chuẩn bị

1. Tạo thùng trong trang quản trị, ví dụ mã `BIN-01`.
2. Sửa `hardware/bin_config.json` trên laptop, khớp mã thùng đã tạo:

   ```json
   { "bin_id": "BIN-01" }
   ```

3. Nạp `hardware/Green-School/Green-School.ino` lên ESP32, kiểm tra cổng COM.
4. Cài Python 3 và dependencies từ thư mục gốc dự án:

   ```powershell
   py -m pip install -r hardware/requirements.txt
   ```

Config được đọc theo vị trí script, không phụ thuộc thư mục PowerShell hiện tại.
Mỗi laptop/thùng đặt `bin_id` tương ứng; không tự tạo ID từ cổng COM.

## Chạy

Đóng Arduino Serial Monitor và các chương trình khác đang giữ COM5, rồi chạy:

```powershell
py hardware/firebase_http_bridge.py --port COM5
```

Không truyền `--email`, không có lời nhắc mật khẩu. Có thể chọn config khác:

```powershell
py hardware/firebase_http_bridge.py --port COM5 --config hardware/bin_config.json
```

Mặc định cảm biến 1 là `plastic`, cảm biến 2 là `metal`. Nếu lắp ngược:

```powershell
py hardware/firebase_http_bridge.py --port COM5 --sensor1 metal --sensor2 plastic
```

Giữ cửa sổ mở; Ctrl+C để dừng. Script kiểm tra thùng đã tồn tại trước khi mở USB.
Học sinh đăng nhập web, quét QR đúng thùng trước khi bỏ rác. Ví dụ:
https://smarttrashbin-98428.web.app/#/scan/BIN-01.

Trước khi bỏ rác, chạy backend trong PowerShell riêng tại thư mục gốc:

```powershell
npm.cmd run backend
```

Backend cần file service account trong `secrets/` và `.env` trỏ đúng tên file.
Xem [hướng dẫn đầy đủ trong README](../README.md): setup lần đầu, đấu dây/nạp
firmware, chạy hai cửa sổ PowerShell, quét QR và kiểm tra điểm.
Không cần Blaze. Giữ cả backend và bridge chạy; hai chương trình không tranh COM.
`SENT` chỉ nghĩa là database đã nhận event; backend in `PROCESSED` khi đã cộng
điểm hoặc `REJECTED` kèm lý do. Kết quả cuối cùng lưu trong `/events` và lịch sử.

## Rules và giới hạn

Rules và web mới đã deploy ngày 29/10/2026 theo phê duyệt dùng ID thùng không
đăng nhập. Cộng điểm do backend laptop xử lý, không dùng Cloud Functions.

Rules trong `firebase/database.rules.json` đã được áp dụng. Backend nằm trong
`backend/`, chạy trên laptop; không deploy backend lên Firebase. Nếu cần cập nhật
Rules trong lần sau, dùng:

```powershell
npx.cmd firebase deploy --only database --project smarttrashbin-98428
```

Rules chỉ cho tạo event mới đúng schema, loại rác đã cấu hình, thùng tồn tại,
khớp phiên học sinh còn hiệu lực và timestamp hợp lệ. Request không được sửa/xóa
event cũ, sửa điểm hoặc thay đổi phiên. Heartbeat chỉ cập nhật `lastSeen` và `ip`
của thùng tồn tại. Đọc từng event theo ID phục vụ xác nhận retry; không cho liệt kê
cả danh sách event khi chưa đăng nhập.

**ID thùng không phải bí mật hay bằng chứng xác thực. Ai biết ID và dữ liệu phiên
cũng có thể giả gửi event hoặc heartbeat.** Kiểm tra phiên và cooldown chỉ giới
hạn event hợp lệ, không chứng minh request đến từ phần cứng thật.

HTTP 401/403: kiểm tra đã deploy Rules mới, đúng mã thùng, phiên còn hạn và
mapping vật liệu có trong cấu hình điểm. Không cần xử lý tài khoản thiết bị nữa.

## Camera và độ tin cậy

Firmware chính chưa nhận nhãn camera từ `ei_bridge.py`. Chỉ một chương trình
được mở cổng COM. Khi tích hợp camera, có thể import `FirebaseBridge(bin_id)`,
gọi `check_bin()` một lần và `send_drop(sensor, captured_ms)` sau mỗi `GS_DROP`.
`captured_ms` là thời điểm nhận USB: `int(time.time() * 1000)`.

Retry giữ nguyên ID và timestamp, kiểm tra event đã tồn tại khi mất phản hồi,
không ghi đè event đã xử lý. Queue trong RAM tối đa 100 lượt, hết hạn sau 30 giây;
tắt chương trình/mất điện có thể mất lượt chưa gửi. Chỉ gửi sau cảm biến xác nhận.

Kiểm thử không cần board:

```powershell
py -m unittest discover -s tests -p test_firebase_http_bridge.py
```
