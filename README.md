# Green School

Web thi đua bỏ rác đúng chỗ giữa các lớp: học sinh quét QR mở phiên trên thùng,
ESP32 ghi nhận lượt bỏ rác, hệ thống cộng điểm và cập nhật bảng xếp hạng realtime.
Frontend HTML/CSS/JavaScript thuần, không cần build.

**Trạng thái cloud hiện tại:** [DEPLOYMENT.md](DEPLOYMENT.md). Web đã deploy: https://smarttrashbin-98428.web.app/. Cloud Functions đang chờ bật Blaze.

**Tài liệu đầy đủ cho agent tiếp theo:** [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md).
Bao gồm mục tiêu, cấu trúc, hợp đồng dữ liệu, tài khoản mẫu, hướng dẫn demo,
checklist test, giới hạn hiện tại và những phần chưa được xác minh.

## Hướng dẫn chạy trên laptop (Windows)

Firmware sử dụng là **[hardware/Green-School/Green-School.ino](hardware/Green-School/Green-School.ino)**.
ESP32 điều khiển nắp và đếm rác; laptop nhận dữ liệu USB và gửi request tới
Firebase local. Functions emulator xử lý cộng điểm.

```text
ESP32 -> USB Serial (GS_DROP) -> firebase_usb_bridge.ps1
      -> Firebase Emulator -> Functions cộng điểm -> Web
```

Mở PowerShell tại thư mục dự án trước khi chạy các lệnh bên dưới:

```powershell
Set-Location 'C:\Users\ADMIN\Downloads\Green School'
```

### 1. Chuẩn bị

- Node.js 22 và npm; JDK 21 (đặt `JAVA_HOME` nếu launcher không tìm được Java).
- Arduino IDE, gói board ESP32 và thư viện `ESP32Servo` nếu dùng thiết bị thật.
- Cáp USB truyền dữ liệu và driver phù hợp với board để máy nhận cổng COM.

Chạy một lần sau khi tải dự án, hoặc khi dependencies thay đổi:

```powershell
npm.cmd install
npm.cmd --prefix functions install
```

### 2. Khởi động Firebase local

Trong PowerShell thứ nhất:

```powershell
npm.cmd run emulators
```

Giữ cửa sổ này chạy. Launcher dùng project `demo-green-school`, chuẩn bị web vào
`public/` và khởi động Auth, Database, Functions, Hosting emulators.

Trong PowerShell thứ hai tại cùng thư mục dự án, chỉ seed lần đầu khi database còn rỗng:

```powershell
npm.cmd run seed:emulators
```

- Web: <http://127.0.0.1:5000/?firebase=emulator>
- Emulator UI: <http://127.0.0.1:4000>
- Admin: `admin` / `admin123`.
- Học sinh: `hs10a1` / `123456`.

Nếu seed báo database không rỗng, giữ dữ liệu hiện có và bỏ qua bước seed.
Các tài khoản mẫu trên chỉ dành cho local.

### 3. Nạp firmware và kết nối USB

1. Mở `hardware/Green-School/Green-School.ino` bằng Arduino IDE. Thư mục sketch đã khớp tên file.
2. Chọn board ESP32 đúng loại và cổng COM của board trong menu Tools.
3. Cài thư viện `ESP32Servo` nếu thiếu, rồi Verify và Upload.
4. Có thể mở Serial Monitor ở **115200 baud** để kiểm tra. Khi bộ đếm tăng, firmware phát `GS_DROP 1 <số đếm>` hoặc `GS_DROP 2 <số đếm>`.
5. Đóng Serial Monitor trước khi chạy bridge để giải phóng cổng COM.

Chạy trong PowerShell thứ hai, thay `COM5` bằng cổng thực tế:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\hardware\firebase_usb_bridge.ps1 -Port COM5
```

Giữ bridge chạy. Mặc định dùng `BIN-01`, cảm biến đếm 1 tương ứng `plastic`,
cảm biến đếm 2 tương ứng `metal`. Đây là quy ước ngăn chứa, cảm biến siêu âm
không nhận diện vật liệu. Nếu lắp hai ngăn ngược nhau:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\hardware\firebase_usb_bridge.ps1 -Port COM5 -Sensor1Type metal -Sensor2Type plastic
```

Bridge dùng tài khoản thiết bị local do bước seed tạo và chỉ gửi tới emulator
trên laptop; chưa hỗ trợ Firebase cloud. Không cần cấu hình Wi-Fi trong firmware.

### 4. Mở phiên học sinh và thử bỏ rác

1. Mở <http://127.0.0.1:5000/?firebase=emulator>, đăng nhập `hs10a1` / `123456`.
2. Mở <http://127.0.0.1:5000/?firebase=emulator#/scan/BIN-01> để mở phiên cho thùng.
3. Bỏ rác qua cảm biến đếm của ngăn tương ứng. Bridge cần hiện `Captured sensor ...`, rồi `Sent ...`.
4. Kiểm tra lịch sử và điểm học sinh/lớp trên web. `Sent` chỉ xác nhận gửi event; kiểm tra trạng thái xử lý tại `/events` trong Database trên Emulator UI nếu điểm không tăng.
5. Đợi hơn 3 giây giữa hai lượt; phiên mặc định hết hạn sau 3 phút, cần mở lại trang scan để tạo phiên khi đã hết hạn.

Để kiểm tra web/backend khi chưa có ESP32, mở thêm PowerShell tại thư mục dự án
và gửi lượt mô phỏng sau khi mở phiên học sinh:

```powershell
node scripts/simulate-bin.cjs BIN-01 plastic
```

Đóng trang admin vẫn xử lý được sự kiện nhờ Functions emulator.

### 5. Dừng và chạy lại

Nhấn Ctrl+C ở cửa sổ bridge trước, rồi Ctrl+C ở cửa sổ emulator và đợi export
xong. Dữ liệu lưu tại `.emulator-data/`; lần bật sau launcher tự import, không
cần seed lại. Hàng đợi chưa gửi của bridge chỉ nằm trong RAM và mất khi dừng.

Lần đầu có thể cần Internet để tải emulator; web vẫn dùng CDN cho SDK, font,
QR và Excel. Chạy local chưa đồng nghĩa hoạt động hoàn toàn offline.

### Camera trên laptop

`hardware/ei_bridge.py` hiện là script Edge Impulse tham khảo cho luồng firmware
cũ đã xóa. Firmware chính chưa nhận nhãn phân loại qua Serial, và script Python
chưa gửi event tới Firebase. **Chưa chạy script camera trong luồng hướng dẫn này**;
cần tích hợp thêm trước khi dùng camera để phân loại. Python không bắt buộc cho
luồng USB hiện tại.

### Lỗi thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Không tìm thấy Java | Cài JDK 21 và đặt `JAVA_HOME` tới thư mục JDK, mở lại terminal. |
| Không mở được COM / Access denied | Kiểm tra cổng trong Arduino IDE, cáp/driver; đóng Serial Monitor và chương trình khác đang giữ COM. |
| Bridge không đăng nhập được | Kiểm tra emulator còn chạy, cổng Auth 9099 và đã seed tài khoản thiết bị local. |
| Không thấy `Captured` | Kiểm tra firmware đã nạp, đúng COM, baud 115200 và cảm biến đếm thực sự tăng bộ đếm. |
| Đã `Sent` nhưng không tăng điểm | Kiểm tra đang dùng URL có `firebase=emulator`, phiên BIN-01 còn hạn, Functions emulator còn chạy và trạng thái event có bị từ chối do cooldown. |
| Cổng emulator bị chiếm | Dừng phiên emulator cũ; các cổng cấu hình là 4000, 5000, 5001, 9000, 9099. |

## Demo giao diện

Không có query emulator và không cấu hình Firebase thật thì dùng dữ liệu demo
localStorage. Có thể mở qua static server:

```powershell
npx.cmd --yes http-server . -p 8080
```

Mở <http://127.0.0.1:8080/>. Tài khoản demo giống tài khoản web mẫu ở trên. Các
nút bỏ nhựa/kim loại ở trang scan chỉ giả lập trong trình duyệt; demo này không
kiểm tra Firebase Rules hoặc Cloud Functions.

## Test

```powershell
npm.cmd test
```

Khi đã cài dependency, dừng emulator đang dùng trước khi chạy phiên tích hợp riêng:

```powershell
npm.cmd run test:emulators
```

Kết quả kiểm thử đã ghi nhận xem tại [DEPLOYMENT.md](DEPLOYMENT.md).
Lượt cập nhật hướng dẫn này không chạy lại emulator, camera hoặc nạp/kiểm thử ESP32.
