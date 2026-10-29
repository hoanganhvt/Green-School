# Green School

Hệ thống thi đua bỏ rác đúng chỗ giữa các lớp: học sinh quét QR mở phiên trên
thùng, thiết bị ghi nhận lượt bỏ rác, hệ thống xử lý điểm và bảng xếp hạng.

## Sử dụng bản đã deploy

Web: **https://smarttrashbin-98428.web.app/**

Firebase project: `smarttrashbin-98428`.
Database: `https://smarttrashbin-98428-default-rtdb.asia-southeast1.firebasedatabase.app`.

Mở web trực tiếp trên trình duyệt có kết nối Internet. Không cần khởi động server
web trên laptop. Đăng nhập bằng tài khoản cloud đã được cấp.

1. Quản trị viên đăng nhập bằng tên `ADMIN` và mật khẩu đã thiết lập trên cloud.
2. Kiểm tra danh sách lớp, học sinh và thùng rác; chuẩn bị dữ liệu thực tế bằng các chức năng quản trị tương ứng.
3. Học sinh dùng tài khoản cloud của mình, quét QR trên thùng hoặc mở trang scan của thùng. Với `BIN-01`: https://smarttrashbin-98428.web.app/#/scan/BIN-01.
4. Kiểm tra phiên đang hoạt động trước khi bỏ rác. Khi luồng thiết bị và xử lý điểm cloud đã tích hợp đầy đủ, kiểm tra kết quả trong lịch sử và bảng xếp hạng.

Theo [trạng thái triển khai đã ghi nhận](DEPLOYMENT.md), Hosting, Email/Password
Auth và Realtime Database Rules đã deploy. Functions tự động cộng điểm còn chờ
Blaze; chưa xác nhận luồng cộng điểm cloud hoàn chỉnh. Mật khẩu admin không lưu
trong mã nguồn hoặc tài liệu.

## Backend Firebase

Backend xử lý điểm là Cloud Function `processBinEvent` trong `functions/index.js`.
Hàm tự chạy khi có event mới tại `/events/{txId}` trong Realtime Database;
không có lệnh `npm start` để bật backend trên laptop. Laptop chỉ cần chạy chương
trình đọc USB/camera và gửi event khi chương trình đó đã được tích hợp cloud.

Để kiểm tra backend đã sẵn sàng, vào Firebase Console của project
`smarttrashbin-98428`, mở Functions và kiểm tra `processBinEvent` ở vùng
`asia-southeast1`. Nếu chưa có hàm, hoàn tất điều kiện Blaze ghi trong
[DEPLOYMENT.md](DEPLOYMENT.md), rồi triển khai từ PowerShell tại thư mục dự án:

```powershell
Set-Location 'C:\Users\ADMIN\Downloads\Green School'
npm.cmd install
npm.cmd --prefix functions install
npx.cmd firebase login
npx.cmd firebase deploy --only functions --project smarttrashbin-98428
```

Đây là lệnh cập nhật backend trên cloud, chỉ thực hiện khi cần deploy. Khi deploy
thành công, backend chạy trên Firebase, không cần giữ PowerShell mở. Xem Logs của
`processBinEvent` trong Firebase Console khi cần kiểm tra lỗi xử lý event.

Việc deploy Functions chưa kết nối được USB/camera với cloud: chương trình trên
laptop còn cần gửi event bằng tài khoản thiết bị được cấp quyền. Không gửi thử
event bằng tài khoản admin để thay cho luồng thiết bị.

## Kết nối phần cứng

Rút nguồn trước khi đấu dây. Bảng dưới là GPIO đúng theo firmware hiện tại;
đối chiếu ký hiệu GPIO trên board, không dùng số thứ tự chân vật lý.

| Thiết bị | Chân tín hiệu trên thiết bị | GPIO ESP32 |
| --- | --- | --- |
| Siêu âm mở nắp 1 | TRIG / ECHO | 5 / 18 |
| Siêu âm mở nắp 2 | TRIG / ECHO | 17 / 16 |
| Siêu âm đếm rác 1 | TRIG / ECHO | 22 / 23 |
| Siêu âm đếm rác 2 | TRIG / ECHO | 13 / 14 |
| Servo nắp 1 | Signal | 19 |
| Servo nắp 2 | Signal | 21 |
| Module còi | Signal / IN | 27 |

- Cấp nguồn cảm biến, servo và còi theo thông số của module thực tế; nối chung GND với ESP32. Không cấp nguồn servo từ chân GPIO.
- Kiểm tra mức điện áp ECHO trước khi nối vào ESP32; dùng mạch chuyển mức/chia áp nếu tín hiệu vượt mức đầu vào cho phép của board.
- Firmware giả định module còi kích mức LOW. Kiểm tra đúng loại module trước khi cấp nguồn.
- Cắm ESP32 vào laptop bằng cáp USB truyền dữ liệu; xem cổng COM trong Arduino IDE hoặc Device Manager.
- Camera dùng camera tích hợp hoặc USB của laptop; không nối camera laptop vào GPIO ESP32.

Loại board, model cảm biến và nguồn servo chưa được ghi cụ thể trong dự án;
cần đối chiếu linh kiện thực tế trước khi đấu nguồn.

## Nạp và chạy firmware ESP32

Firmware chính: **[hardware/Green-School/Green-School.ino](hardware/Green-School/Green-School.ino)**.

Chuẩn bị Arduino IDE, gói board ESP32, thư viện `ESP32Servo` và cáp USB truyền dữ liệu.

1. Mở file firmware trên bằng Arduino IDE; thư mục sketch đã khớp tên file.
2. Chọn đúng loại board và cổng COM trong menu Tools.
3. Verify, rồi Upload lên ESP32.
4. Mở Serial Monitor ở **115200 baud** để kiểm tra hoạt động cảm biến.
5. Khi bộ đếm tăng, firmware phát `GS_DROP 1 <số đếm>` hoặc `GS_DROP 2 <số đếm>`. Đóng Serial Monitor trước khi dùng chương trình khác đọc cùng cổng COM.

Sau Upload, firmware tự chạy khi ESP32 được cấp nguồn; không cần chạy file `.ino`
trên laptop. Khi cần khởi động lại, nhấn nút reset của board.

Kiểm tra lần lượt từng ngăn: đưa vật trong khoảng mở nắp 10 cm, kiểm tra servo;
đưa vật qua cảm biến đếm trong khoảng 6 cm, kiểm tra bộ đếm và còi. Đưa vật ra
xa hơn 8 cm trước lượt đếm tiếp theo. Nắp đóng sau khoảng 2 giây không phát
hiện vật; góc servo trong code là đóng 0°, mở 90°. Kiểm tra hành trình cơ khí
trước khi gắn tải vào servo.

Firmware điều khiển hai nắp, còi và bốn cảm biến siêu âm; chưa có Wi-Fi hoặc gửi
request Firebase. Cảm biến đếm không tự nhận diện vật liệu. Quy ước ngăn 1 là
`plastic`, ngăn 2 là `metal` cần khớp với cách lắp thực tế.

## Laptop, camera và kết nối Firebase cloud

### Kiểm tra laptop nhận dữ liệu ESP32

Sau khi nạp firmware, đóng Serial Monitor. Mở Windows PowerShell, thay `COM5`
bằng cổng thực tế và chạy đoạn sau để đọc dữ liệu USB:

```powershell
$espPort = New-Object System.IO.Ports.SerialPort 'COM5', 115200, None, 8, One
$espPort.ReadTimeout = 1000
try {
    $espPort.Open()
    while ($true) {
        try { Write-Host ($espPort.ReadLine().Trim()) }
        catch [System.TimeoutException] { }
    }
} finally {
    if ($espPort.IsOpen) { $espPort.Close() }
    $espPort.Dispose()
}
```

Khi bỏ rác qua cảm biến đếm, cần thấy dòng như `GS_DROP 1 1` hoặc `GS_DROP 2 1`.
Nhấn Ctrl+C để dừng và giải phóng cổng. Đoạn lệnh chỉ kiểm tra USB, chưa gửi
request Firebase. Nếu không mở được cổng, đóng ứng dụng khác đang dùng COM;
nếu không có dữ liệu đếm, kiểm tra chân cảm biến và ngưỡng trong firmware.

### Chương trình camera và gửi event

Luồng dự kiến:

```text
Camera laptop -> Python nhận diện -> ESP32 qua USB
ESP32 xác nhận rác qua cảm biến -> laptop gửi event -> Firebase cloud -> xử lý điểm
```

Các phần hiện có và phần cần hoàn thiện:

| Thành phần | Trạng thái |
| --- | --- |
| `hardware/Green-School/Green-School.ino` | Firmware chính, phát `GS_DROP`; chưa nhận nhãn phân loại từ camera. |
| `hardware/ei_bridge.py` | Script camera Edge Impulse tham khảo; chưa tương thích firmware chính và chưa gửi event Firebase. |
| `hardware/firebase_usb_bridge.ps1` | Chỉ hỗ trợ emulator, chưa gửi tới Firebase cloud; không dùng làm lệnh chạy bản đã deploy. |
| `hardware/firebase_http_bridge.py` | Đọc `GS_DROP` từ USB, gửi HTTPS tới Firebase cloud bằng tài khoản thiết bị. Xem [cách chạy](hardware/README_HTTP_BRIDGE.md). |
| Xử lý điểm cloud | Theo `DEPLOYMENT.md`, Functions còn chờ Blaze. |

Script HTTP đã có luồng ESP32 xác nhận rác → laptop → Firebase cloud. Luồng camera
và xử lý điểm cloud vẫn chưa hoàn chỉnh: cần tích hợp nhãn Serial vào firmware và
triển khai backend tính điểm. Chỉ gửi lượt bỏ rác khi cảm biến xác nhận, không gửi
ngay khi camera nhận diện. Không chạy hai chương trình cùng mở cổng COM của ESP32.

## Tài liệu kỹ thuật

- [DEPLOYMENT.md](DEPLOYMENT.md): bản ghi triển khai và các phần cloud còn thiếu.
- [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md): kiến trúc, hợp đồng dữ liệu và lịch sử kiểm thử; các phần thử nghiệm cũ không phải hướng dẫn vận hành bản cloud.

Firmware, camera và luồng USB với thiết bị thật chưa được kiểm thử xác nhận.
