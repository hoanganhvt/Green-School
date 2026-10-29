# Green School — hướng dẫn chạy

Web: **https://smarttrashbin-98428.web.app/**
Firebase project: `smarttrashbin-98428`.

Hệ thống dùng Firebase cloud để lưu dữ liệu và phục vụ web; backend cộng điểm
chạy trên laptop. **Không cần Blaze, Cloud Functions hoặc Firebase Emulator để
vận hành.** Laptop cần Internet, backend và bridge USB phải cùng chạy.

## 1. Các thành phần và luồng hoạt động

| Thành phần | File / thư mục | Chạy ở đâu, làm gì? |
| --- | --- | --- |
| Web | `index.html`, `assets/` | Đã deploy, mở trên trình duyệt để đăng nhập, quét QR và xem điểm. |
| Firmware | `hardware/Green-School/Green-School.ino` | Nạp lên ESP32, điều khiển nắp/còi và đếm lượt qua cảm biến. |
| Bridge USB | `hardware/firebase_http_bridge.py` | Python trên laptop đọc COM và gửi event lên Firebase. |
| ID thùng | `hardware/bin_config.json` | Cấu hình thùng mà bridge đang đại diện, ví dụ `BIN-01`. |
| Backend | `backend/index.cjs` | Node.js trên laptop đọc khóa và kết nối Firebase. |
| Xử lý event | `backend/worker.cjs` | Đọc event đang chờ, gọi bộ tính điểm. |
| Tính điểm | `backend/scoring.cjs` | Kiểm tra phiên/cooldown, chống cộng trùng, cập nhật điểm và lịch sử. |
| Khóa backend | `secrets/` và `.env` | Quyền quản trị Firebase dành riêng cho backend; không đưa lên web/Git. |

```text
Học sinh đăng nhập và quét QR -> mở phiên cho đúng thùng trên Firebase
Bỏ rác -> ESP32 -> USB Serial GS_DROP -> Python bridge -> Firebase events/pending
Backend Node.js trên laptop -> kiểm tra và cộng điểm -> Firebase -> web realtime
```

`npm.cmd run backend` là tên lệnh trong `package.json`, thực chất chạy:

```powershell
node --env-file-if-exists=.env backend/index.cjs
```

ESP32 hiện **chưa nhận diện vật liệu bằng camera**. Ngăn/cảm biến đếm 1 được
quy ước là nhựa (`plastic`), ngăn/cảm biến đếm 2 là kim loại (`metal`).

## 2. Chạy nhanh khi đã setup xong

Cắm ESP32 vào USB, xác nhận đúng COM và đóng Arduino Serial Monitor.
Mở **hai cửa sổ PowerShell riêng**, cùng tại thư mục dự án.

**Cửa sổ 1 — backend cộng điểm:**

```powershell
Set-Location 'C:\Users\ADMIN\Downloads\Green School'
npm.cmd run backend
```

Đợi:

```text
Backend ready: smarttrashbin-98428. Keep this window open; Ctrl+C to stop.
```

**Cửa sổ 2 — bridge USB, thay COM5 bằng cổng thực tế:**

```powershell
Set-Location 'C:\Users\ADMIN\Downloads\Green School'
py hardware/firebase_http_bridge.py --port COM5
```

Đợi:

```text
Listening on COM5 -> BIN-01. Ctrl+C to stop.
```

Giữ cả hai cửa sổ mở. Trên web, **đăng nhập học sinh → quét QR → đợi phiên hoạt
động → bỏ rác**. Bridge phải hiện `SENT`, backend phải hiện `PROCESSED`, sau đó
kiểm tra điểm/lịch sử trên web. Các phần dưới hướng dẫn setup lần đầu.

## 3. Chuẩn bị phần mềm lần đầu

- Node.js **22.9 trở lên**, có npm, để chạy backend.
- Python 3 có lệnh `py`, để chạy bridge.
- Arduino IDE, gói board ESP32 và thư viện `ESP32Servo`, để nạp firmware.
- Cáp USB truyền dữ liệu, driver phù hợp với board và kết nối Internet.

Trong PowerShell tại thư mục dự án:

```powershell
Set-Location 'C:\Users\ADMIN\Downloads\Green School'
node --version
npm.cmd --version
py --version
npm.cmd install
py -m pip install -r hardware/requirements.txt
```

Chỉ cài dependencies lần đầu hoặc khi dependencies thay đổi; không cần chạy
`npm install` mỗi lần bật backend. Luồng cảm biến hiện tại không cần OpenCV,
Edge Impulse hoặc model camera.

## 4. Cấu hình khóa backend một lần

Nếu máy đã có `.env` đúng đường dẫn và backend đã hiện `Backend ready`, bỏ qua
bước tạo khóa, không ghi đè cấu hình hiện có.

1. Mở [Firebase Console → Service accounts](https://console.firebase.google.com/project/smarttrashbin-98428/settings/serviceaccounts/adminsdk) của project `smarttrashbin-98428`.
2. Chọn **Generate new private key → Generate key**, tải file JSON về laptop.
3. Lưu file trong thư mục `secrets/` của dự án. Có thể giữ tên file tải về hoặc đặt tên `firebase-service-account.json`.
4. Tạo `.env` ở thư mục gốc bằng cách sao chép `.env.example` nếu chưa có:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Sửa dòng trong `.env` để khớp **đúng tên file thực tế**, ví dụ:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-service-account.json
```

Nếu giữ tên file tải về, thay `firebase-service-account.json` bằng tên đó. Nếu
khóa nằm ngoài dự án, dùng đường dẫn tuyệt đối và dấu `/`; đặt trong dấu ngoặc
kép nếu đường dẫn có khoảng trắng. Không chép nội dung JSON vào `.env`.

Đây là khóa quản trị cho backend, **không phải email/mật khẩu của thùng rác**.
`secrets/`, `.secrets/` và `.env` đã được loại khỏi Git. Không đặt khóa trong
`assets/`, `public/` hoặc chia sẻ nội dung khóa. Web đã deploy không chứa khóa.
`firebase login` không thay thế khóa backend.

Tham khảo [hướng dẫn Firebase Admin SDK](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments).

## 5. Chuẩn bị thùng và tài khoản trên web

1. Mở https://smarttrashbin-98428.web.app/ và đăng nhập quản trị bằng tên `ADMIN`, mật khẩu cloud đã thiết lập.
2. Kiểm tra lớp và học sinh cần sử dụng đã tồn tại; học sinh có tài khoản cloud đang hoạt động, gắn đúng lớp.
3. Vào **Thùng rác & QR**, tạo hoặc chọn thùng, ví dụ `BIN-01`, rồi in/dán QR của đúng thùng.
4. Sửa `hardware/bin_config.json` trên laptop để trùng mã thùng:

```json
{ "bin_id": "BIN-01" }
```

ID thùng do admin nhập khi tạo trên web, không tự sinh từ COM. Bridge không tự
tạo thùng và không hỏi email/mật khẩu. Đổi ID trong config thì khởi động lại
bridge. Mỗi thùng phải dùng đúng QR và config tương ứng.

## 6. Nối phần cứng

Rút nguồn trước khi đấu dây. Đây là GPIO theo firmware hiện tại; đối chiếu ký
hiệu GPIO trên board, không dùng số thứ tự chân vật lý.

| Thiết bị | Chân tín hiệu | GPIO ESP32 |
| --- | --- | --- |
| Siêu âm mở nắp 1 | TRIG / ECHO | 5 / 18 |
| Siêu âm mở nắp 2 | TRIG / ECHO | 17 / 16 |
| Siêu âm đếm rác 1 | TRIG / ECHO | 22 / 23 |
| Siêu âm đếm rác 2 | TRIG / ECHO | 13 / 14 |
| Servo nắp 1 | Signal | 19 |
| Servo nắp 2 | Signal | 21 |
| Module còi | Signal / IN | 27 |

- Cấp nguồn đúng thông số của module/servo thực tế và nối chung GND với ESP32; không cấp nguồn servo từ GPIO.
- Kiểm tra mức điện áp ECHO; dùng mạch chuyển mức/chia áp nếu vượt mức đầu vào cho phép của board.
- Firmware giả định module còi kích LOW. Kiểm tra đúng loại trước khi cấp nguồn.
- Dùng USB truyền dữ liệu nối ESP32 với laptop; xem COM trong Arduino IDE hoặc Device Manager.

Loại board, nguồn và model cảm biến cụ thể chưa được ghi trong dự án; cần đối
chiếu linh kiện thực tế trước khi đấu nguồn. Camera laptop không nối vào GPIO.

## 7. Nạp và kiểm tra firmware

1. Mở **`hardware/Green-School/Green-School.ino`** bằng Arduino IDE.
2. Cài thư viện `ESP32Servo`, chọn đúng loại board ESP32 và cổng COM trong Tools.
3. Bấm Verify, rồi Upload. Nếu bridge đang chạy, dừng bridge trước để giải phóng COM.
4. Mở Serial Monitor ở **115200 baud** để kiểm tra.
5. Đưa vật tới cảm biến mở nắp trong khoảng 10 cm: kiểm tra servo mở. Nắp đóng sau khoảng 2 giây không phát hiện vật.
6. Đưa vật qua cảm biến đếm trong khoảng 6 cm: kiểm tra bộ đếm/còi và dòng `GS_DROP 1 1` hoặc `GS_DROP 2 1`. Đưa vật ra xa hơn 8 cm trước lượt đếm tiếp theo.
7. Đóng Serial Monitor trước khi bật bridge. Không để hai chương trình giữ cùng cổng COM.

Firmware tự chạy khi ESP32 được cấp nguồn; không chạy file `.ino` trên laptop.
Góc servo là đóng 0°, mở 90°; kiểm tra hành trình cơ khí trước khi gắn tải.
Firmware không cần Wi-Fi và không gửi request Firebase trực tiếp.

## 8. Chạy thử một lượt hoàn chỉnh

1. Bật backend và bridge theo phần **Chạy nhanh**. Backend không giữ COM; bridge giữ COM.
2. Đăng nhập học sinh trên web. Có thể dùng điện thoại hoặc trình duyệt riêng để không thay phiên đăng nhập admin.
3. Quét QR đúng thùng. Với `BIN-01`, có thể mở trực tiếp https://smarttrashbin-98428.web.app/#/scan/BIN-01.
4. Đợi trang xác nhận phiên đang hoạt động và đúng học sinh/lớp rồi mới bỏ rác.
5. Bỏ vào ngăn tương ứng, kiểm tra cảm biến đếm thực sự ghi nhận rác.
6. Bridge hiện `SENT USB-...: plastic ...` hoặc `metal`.
7. Backend hiện `PROCESSED USB-...: +2 points` hoặc điểm theo cấu hình vật liệu.
8. Kiểm tra lịch sử, điểm học sinh/lớp và bảng xếp hạng trên web.

`SENT` chỉ xác nhận Firebase nhận event; `PROCESSED` mới xác nhận đã xử lý và
cộng điểm. Mặc định nhựa 2 điểm, kim loại 3 điểm; admin có thể đổi trong Cài đặt.
Đợi hơn **3 giây** giữa hai lượt để tránh cooldown mặc định. Phiên mặc định dài
**3 phút**, được gia hạn khi lượt hợp lệ được xử lý. Nếu phiên kết thúc, chọn
**Bỏ rác tiếp** hoặc quét QR lại. Không bỏ rác trước rồi mới quét QR: lượt đó
không thuộc phiên của bạn.

Nếu lắp ngăn 1 là kim loại, ngăn 2 là nhựa, chạy bridge với mapping ngược:

```powershell
py hardware/firebase_http_bridge.py --port COM5 --sensor1 metal --sensor2 plastic
```

## 9. Dừng, bật lại và giới hạn hiện tại

Nhấn Ctrl+C ở bridge trước, chờ backend xử lý xong lượt cuối rồi Ctrl+C ở
backend. Khi bật lại, chỉ chạy hai lệnh trong phần Chạy nhanh; không cần nạp
firmware, tạo khóa hoặc tạo thùng lại nếu cấu hình/phần cứng không đổi.

- Đóng trang admin không dừng cộng điểm; đóng backend/tắt laptop thì dừng xử lý điểm. Web cloud vẫn mở được.
- Event chờ đã gửi nằm trong Firebase. Backend chạy lại sẽ từ chối lượt cũ hơn 60 giây hoặc có phiên hết hạn/không khớp, không cộng sang phiên mới.
- Bridge chỉ giữ queue trong RAM tối đa 100 lượt, hết hạn sau 30 giây. Tắt bridge/mất điện có thể mất lượt chưa gửi.
- Mã thùng chỉ định danh, không xác thực phần cứng. Người biết ID/dữ liệu phiên có thể giả gửi event hoặc heartbeat; Rules không cho request đó sửa điểm, phiên hoặc event cũ.
- `hardware/ei_bridge.py` vẫn là script camera tham khảo. Chưa có luồng camera phân loại tương thích firmware chính; không chạy đồng thời script đó và bridge trên cùng COM.

## 10. Xử lý lỗi

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| `node`, `npm.cmd` hoặc `py` không tìm thấy | Cài phần mềm tương ứng, mở lại PowerShell và kiểm tra lệnh version ở phần 3. |
| Thiếu module Node/Python | Chạy `npm.cmd install` hoặc `py -m pip install -r hardware/requirements.txt` tại thư mục gốc. |
| `Set GOOGLE_APPLICATION_CREDENTIALS` / không đọc được JSON | Kiểm tra `.env` nằm ở gốc và đường dẫn khớp file trong `secrets/`, không nhầm với `.secrets/`. Không ghi đè `.env` đang dùng. |
| `Use a service account key for project ...` | Dùng khóa service account của `smarttrashbin-98428`, không dùng file cấu hình web Firebase. |
| Lỗi token/quyền ở backend | Kiểm tra Internet, khóa còn hiệu lực và quyền quản trị Realtime Database của service account. |
| Không mở được COM / Access denied | Kiểm tra COM, cáp/driver; đóng Serial Monitor, bridge cũ và chương trình camera đang giữ COM. |
| Bridge không có `SENT` | Kiểm tra đúng firmware/COM, cảm biến có phát `GS_DROP` và học sinh đã mở phiên đúng thùng. |
| `SKIPPED: no valid student session...` | Đăng nhập học sinh và quét QR trước; kiểm tra QR trùng `bin_id`. |
| `HTTP 401/403` ở bridge | Kiểm tra Rules đã deploy, ID thùng tồn tại, phiên còn hạn, loại rác và đồng hồ laptop; bridge không dùng tài khoản thiết bị. |
| `RETRY` / `HEARTBEAT` | Kiểm tra Internet và quyền Rules; bridge sẽ thử lại trong giới hạn queue/thời gian. |
| `SENT` nhưng chưa có điểm | Kiểm tra backend còn `Backend ready`; tìm cùng ID event trong log backend và `/events` trên Firebase Console. |
| `REJECTED` | Xem lý do ở backend/event: phiên hết hạn, học sinh bị khóa, loại rác tắt, cooldown hoặc timestamp quá cũ. |

## 11. Kiểm thử và tài liệu

Các lệnh dưới dành cho kiểm tra mã nguồn, không phải bước bắt buộc mỗi lần vận hành:

```powershell
npm.cmd test
py -m unittest discover -s tests -p test_firebase_http_bridge.py
```

Backend đã qua 26 test Node và kiểm thử Firebase Emulator, gồm chống cộng trùng
khi hai worker xử lý cùng event. Người dùng đã khởi chạy backend với Firebase
thật và nhận `Backend ready`. Chưa xác nhận lượt bỏ rác thật từ ESP32 tới cập
nhật điểm; camera và phần cứng vẫn cần kiểm thử thực tế.

- [hardware/README_HTTP_BRIDGE.md](hardware/README_HTTP_BRIDGE.md): tham số bridge và chi tiết gửi event.
- [DEPLOYMENT.md](DEPLOYMENT.md): trạng thái triển khai và giới hạn hệ thống.
