# Gửi lượt bỏ rác từ laptop lên Firebase

`firebase_http_bridge.py` đọc `GS_DROP 1 <count>` / `GS_DROP 2 <count>` từ firmware
chính qua USB, đăng nhập tài khoản thiết bị rồi gửi HTTPS tới Firebase cloud của
Green School. Không cần cài Edge Impulse hoặc OpenCV để chạy riêng script này.

## Chuẩn bị một lần

1. Cài Python 3 trên laptop nếu chưa có. Kiểm tra `py --version` trên Windows.
2. Trong Firebase Console của `smarttrashbin-98428`, mở Authentication → Users,
   tạo tài khoản Email/Password riêng cho thiết bị và sao chép UID. Không dùng tài khoản ADMIN.
3. Trong Realtime Database, tạo `/devices/<UID>` với dữ liệu:

   ```json
   { "binId": "BIN-01", "enabled": true }
   ```

   Thùng `/bins/BIN-01` phải tồn tại và có trường `id` là `BIN-01`.
   Script kiểm tra quyền đã cấp, không tự tạo tài khoản hoặc sửa Rules.
4. Nạp `hardware/Green-School/Green-School.ino` vào ESP32, chọn đúng COM.

## Chạy từ thư mục gốc Green School

```powershell
py -m pip install -r hardware/requirements.txt
py hardware/firebase_http_bridge.py --port COM5 --email bin01@example.com
```

Thay COM và email bằng giá trị thực tế. Nhập mật khẩu khi được hỏi; không hiện
mật khẩu trên màn hình. Có thể dùng biến môi trường `GS_DEVICE_EMAIL` và
`GS_DEVICE_PASSWORD` nếu gọi từ chương trình khác. Đóng Arduino Serial Monitor
trước khi chạy. Giữ cửa sổ script mở; Ctrl+C để dừng.

Đăng nhập học sinh trên web và quét QR thùng trước khi bỏ rác:
https://smarttrashbin-98428.web.app/#/scan/BIN-01.

Mặc định cảm biến 1 là `plastic`, cảm biến 2 là `metal`. Nếu lắp ngược, dùng:

```powershell
py hardware/firebase_http_bridge.py --port COM5 --email bin01@example.com --sensor1 metal --sensor2 plastic
```

`SENT` nghĩa là Firebase đã nhận event tại `/events/USB-...`; **chưa xác nhận đã
cộng điểm**. Backend `processBinEvent` hiện còn chờ triển khai. Script gửi event
theo schema hiện có, không thay thế backend cộng điểm và không cần đổi Rules.
HTTP 401/403: kiểm tra email/mật khẩu, UID thiết bị, `enabled`, `binId` và Rules.

## Camera và cổng COM

Chạy riêng script này để gửi lượt khi cảm biến xác nhận. Firmware chính chưa nhận
nhãn từ `ei_bridge.py`, nên chưa hoàn thành luồng camera điều khiển nắp.
Không chạy hai script cùng mở một cổng COM. Khi tích hợp camera, chỉ một chương
trình giữ COM; có thể import `FirebaseBridge`, gọi `check_device()` một lần và gọi
`send_drop(sensor, captured_ms)` sau mỗi dòng `GS_DROP`. `captured_ms` là thời điểm
nhận dòng USB, tính bằng `int(time.time() * 1000)`. Gọi mạng ở worker để không chặn camera.

Mỗi lượt có ID riêng, giữ nguyên khi retry; kiểm tra event đã tồn tại nếu mất
phản hồi và không ghi đè event đã xử lý. Chỉ gửi cho phiên học sinh có hiệu lực
tại thời điểm nhận USB. Queue RAM tối đa 100 lượt, hết hạn sau 30 giây; mất lượt
chưa gửi khi tắt chương trình/mất điện. Không báo cộng điểm khi mạng lỗi.

Kiểm thử logic không cần board hoặc tài khoản cloud:

```powershell
py -m unittest discover -s tests -p test_firebase_http_bridge.py
```

Tham chiếu: [Firebase Auth REST](https://firebase.google.com/docs/reference/rest/auth),
[Firebase REST conditional writes](https://firebase.google.com/docs/database/rest/save-data#section-conditional-requests).
