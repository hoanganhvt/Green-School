# Green School

Web thi đua bỏ rác đúng chỗ giữa các lớp: học sinh quét QR mở phiên trên thùng,
ESP32 ghi nhận lượt bỏ rác, hệ thống cộng điểm và cập nhật bảng xếp hạng realtime.
Frontend HTML/CSS/JavaScript thuần, không cần build.

**Trạng thái cloud hiện tại:** [DEPLOYMENT.md](DEPLOYMENT.md). Web đã deploy: https://smarttrashbin-98428.web.app/. Cloud Functions đang chờ bật Blaze.

**Tài liệu đầy đủ cho agent tiếp theo:** [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md).
Bao gồm mục tiêu, cấu trúc, hợp đồng dữ liệu, tài khoản mẫu, hướng dẫn demo,
checklist test, giới hạn hiện tại và những phần chưa được xác minh.

Code đã được chuẩn bị cho local. Theo chỉ dẫn mới nhất, **agent tiếp theo đã đăng
nhập Google và sẽ kiểm thử, cấu hình rồi deploy Firebase**. Xem mục 9 của tài liệu
bàn giao; project cloud thật cần được xác định riêng với `demo-green-school`.
Firmware chính là **`Green-School.ino`**, không phải mẫu cũ trong `hardware/`.

## Firebase local

Cần Node.js/npm, JDK 21 và dependencies bên dưới. Trong PowerShell dùng `.cmd`
để tránh chính sách chặn các shim `.ps1`:

```powershell
npm.cmd install
npm.cmd --prefix functions install
npm.cmd run emulators
```

Terminal thứ hai, chỉ seed một lần khi database còn rỗng:

```powershell
npm.cmd run seed:emulators
```

- Web: <http://127.0.0.1:5000/?firebase=emulator>
- Emulator UI: <http://127.0.0.1:4000>
- Admin: `admin` / `admin123`.
- Học sinh: `hs10a1` / `123456`.

Đăng nhập học sinh, mở `?firebase=emulator#/scan/BIN-01`, rồi gửi lượt mô phỏng:

```powershell
node scripts/simulate-bin.cjs BIN-01 plastic
```

Đợi hơn 3 giây trước lượt tiếp theo để không bị cooldown. Đóng trang admin vẫn
xử lý được sự kiện nhờ Functions emulator. Ctrl+C export dữ liệu sang
`.emulator-data/`; lần bật sau launcher tự import. Lần đầu có thể cần Internet
để tải emulator; web vẫn dùng CDN cho SDK, font, QR và Excel.

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

Unit tests đã chạy. Integration emulator, browser và thiết bị thật chưa được
chạy xác nhận trong lượt viết code này. Xem tài liệu bàn giao trước khi tiếp tục.
