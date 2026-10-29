# Green School — tài liệu bàn giao cho agent

Cập nhật: 29/10/2026. Đây là nguồn hướng dẫn bàn giao cho Firebase local và bước triển khai tiếp theo.

## 1. Mục tiêu và giới hạn công việc

Green School là web thi đua phân loại/bỏ rác giữa các lớp: học sinh đăng nhập,
quét QR của thùng, mở phiên sử dụng và được cộng điểm cho lớp khi cảm biến đếm
một lượt bỏ rác. Giáo viên quản lý học sinh, tài khoản, thùng, quy tắc điểm và
lịch sử. Bảng xếp hạng cập nhật realtime; có tổng hợp theo tuần Việt Nam.

Chỉ dẫn mới nhất của chủ project: **agent tiếp theo đã đăng nhập Google và sẽ
triển khai lên Firebase. Agent đó được phép cấu hình, kiểm thử và deploy.** Chỉ
dẫn này thay thế giới hạn "chỉ viết code, chưa deploy" của lượt xây dựng local.
Trạng thái đăng nhập là thông tin người dùng cung cấp; agent triển khai cần kiểm
tra tài khoản/project đang hoạt động trong môi trường của mình, không mặc định
phiên CLI cô lập của emulator là phiên đã đăng nhập.

Project ID local là `demo-green-school`, không phải project Google thật. Giữ
nguyên ID này trong script local; dùng project ID thật một cách tường minh khi
triển khai. Project ID thật chưa được ghi trong tài liệu này. Việc nạp firmware
lên thiết bị vẫn cần yêu cầu riêng; quyền deploy Firebase không bao gồm nạp ESP32.

Nếu sau này tương tác Cloudflare: dùng cf CLI trừ khi project có file cấu hình
Wrangler. Thư mục cache `.wrangler/` tự nó không phải file cấu hình Wrangler.

## 2. Kiến trúc và mã nguồn

Frontend là HTML/CSS/JavaScript thuần, namespace `window.GS`, route dạng `#/...`,
không có React/Vite và không có bước build frontend.

| Thành phần | Nguồn và trách nhiệm |
| --- | --- |
| `index.html`, `assets/css/app.css` | Điểm vào và giao diện |
| `assets/js/config.js` | Giá trị mặc định, config Firebase, chọn emulator |
| `assets/js/core/db-local.js` | Demo dùng localStorage, đồng bộ các tab cùng origin |
| `assets/js/core/db-firebase.js` | Adapter Firebase Auth + Realtime Database, SDK compat tải từ CDN |
| `assets/js/core/services.js` | Đăng ký, phiên, quản trị, bộ xử lý điểm dành riêng cho demo |
| `assets/js/core/seed.js` | Dữ liệu demo trình duyệt, không dùng làm dữ liệu Auth emulator |
| `assets/js/core/util.js`, `router.js` | Tiện ích, tuần UTC+7, layout, điều hướng |
| `assets/js/pages/` | Trang chủ, auth, scan, cá nhân, giới thiệu |
| `assets/js/admin/` | Tổng quan, học sinh, tài khoản, điểm, thùng/QR, cài đặt |
| `firebase/database.rules.json` | Quyền đọc/ghi RTDB |
| `functions/index.js`, `scoring.js` | Trigger tạo event và logic tính điểm trên server |
| `scripts/` | Khởi động emulator, seed, REST local, mô phỏng thiết bị |
| `tests/` | Unit test và kiểm thử tích hợp emulator |
| `hardware/Green-School/Green-School.ino` | **Firmware chính**: cảm biến siêu âm, hai servo, còi, lượt đếm qua Serial |
| `hardware/firebase_usb_bridge.ps1` | Chuyển thông báo USB của firmware chính sang Firebase local |
| `hardware/ei_bridge.py` | Script camera Edge Impulse tham khảo; chưa tích hợp với firmware chính `hardware/Green-School/Green-School.ino` |
| `du-lieu-mau/` | Excel mẫu để thử import học sinh |

Luồng Firebase:

```text
Web học sinh -> Auth -> /bins/BIN-01/activeSession
hardware/Green-School/Green-School.ino -> Serial GS_DROP -> PowerShell USB bridge
USB bridge -> Auth thiết bị -> /events/{txId} (pending)
Cloud Functions -> kiểm tra thiết bị/phiên/học sinh/cooldown
               -> transaction nguyên tử trên RTDB
               -> /transactions + điểm học sinh/lớp/tuần + trạng thái event
RTDB listeners -> web cập nhật bảng xếp hạng và lịch sử
```

Trong demo localStorage, trình duyệt vẫn xử lý điểm bằng code cũ. Trong Firebase
(bao gồm emulator), `startProcessor()` không chạy bộ xử lý trình duyệt; cần
Functions emulator đang hoạt động. Đóng tất cả tab vẫn xử lý được event.

## 3. Hai chế độ chạy

### Demo giao diện, không cần Firebase

Dùng một static server, ví dụ `npx.cmd --yes http-server . -p 8080`, rồi mở
`http://127.0.0.1:8080/`. Lệnh ví dụ này có thể tải gói từ npm khi chưa có cache.
Không có `?firebase=emulator` và không cấu hình Firebase thật thì app dùng demo.

- Admin: `admin` / `admin123`.
- Học sinh: `hs10a1` / `123456`.
- Mở `#/scan/BIN-01`, dùng nút bỏ nhựa/kim loại để demo.
- Hai tab cùng origin thấy thay đổi qua sự kiện localStorage. Hai trình duyệt
  khác nhau không chia sẻ dữ liệu demo.
- Demo không kiểm chứng được Firebase Rules, Auth thật hoặc Cloud Functions.

### Firebase Emulator — luồng đầy đủ trên máy

Prerequisite: Node.js/npm, Firebase CLI, Java JDK 21. Khi kiểm tra máy này đã có
Node `24.11.1`, npm `11.21.0`, CLI `15.34.0`, Temurin JDK `21.0.5` tại
`C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot`.
Java chưa có trong PATH; launcher tự tìm JDK 21 tại Eclipse Adoptium trên Windows
hoặc dùng `JAVA_HOME` có sẵn. Functions khai báo runtime Node 22; nên dùng Node 22
khi cần kiểm tra sát runtime cloud. Host Node 24 có thể gây cảnh báo khác runtime.

Trong PowerShell ở thư mục project, khi sẵn sàng cài dependencies:

```powershell
npm.cmd install
npm.cmd --prefix functions install
npm.cmd run emulators
```

Các lệnh trên không yêu cầu `firebase login`. Lần đầu emulator có thể cần tải
binary/JAR/UI qua Internet. Không chạy `firebase init` vì config đã được viết.
Lần bàn giao này chưa cài dependencies và chưa tải/chạy emulator.

Mở terminal thứ hai:

```powershell
npm.cmd run seed:emulators
```

Sau đó mở:

- Web Firebase local: `http://127.0.0.1:5000/?firebase=emulator`.
- Emulator UI: `http://127.0.0.1:4000`.
- Auth: `127.0.0.1:9099`; Database: `127.0.0.1:9000`; Functions: `127.0.0.1:5001`.

**Giữ `?firebase=emulator` trước phần `#/...`.** Các link QR được tạo trong chế
độ này giữ tham số đó. Emulator chỉ bật trên hostname loopback, không trên LAN
IP/domain công khai. Không mở điện thoại bằng IP máy rồi mong tự nối emulator.

Config emulator ưu tiên hơn config Firebase đã lưu trong localStorage và cờ
forced-demo. Nếu khởi tạo emulator lỗi, app báo lỗi; không tự rơi về demo. SDK,
font và thư viện Excel/QR còn tải CDN: chạy backend local không đồng nghĩa hoàn
toàn offline. Chưa vendor các thư viện này vào repo.

Launcher cố định `--project demo-green-school`, giới hạn các dịch vụ local và
dùng config CLI riêng trong `.cache/firebase-config/` để không dùng account
Google lưu ngoài project. Không có script deploy. Launcher dùng CLI trong
node_modules, hoặc CLI global có sẵn trên Windows nếu chưa cài bản local.
Nó không thay PATH/JAVA_HOME hay ExecutionPolicy của hệ thống; chỉ sửa môi trường
process con. Dùng `.cmd` để tránh PowerShell chặn các shim `.ps1`.

### Dữ liệu seed và lưu phiên test

Seed tạo đúng các tài khoản **local mẫu**, không dùng trong production:

| Vai trò | Username/email | Password |
| --- | --- | --- |
| Admin web | `admin` | `admin123` |
| Học sinh web | `hs10a1` | `123456` |
| Thiết bị Auth | `bin01@devices.greenschool.app` | `device-demo-123` |

Học sinh đã đăng ký: `10A1-DEMO`, Nguyễn Minh An, lớp 10A1. Học sinh chưa đăng ký:
`10A2-TEST`, Trần Bảo Bình, lớp 10A2. Có thùng `BIN-01`, hai lớp, quy tắc nhựa 2
điểm/kim loại 3 điểm, cooldown 3 giây và phiên 3 phút. Seed từ chối database không
rỗng để tránh ghi đè. Nếu bị ngắt giữa lúc tạo tài khoản và ghi DB, xoá các tài
khoản seed dở bằng Auth Emulator UI trước khi chạy lại, hoặc dùng phiên emulator
mới. Không dùng các tài khoản/mật khẩu mẫu ở cloud.

Ctrl+C dừng launcher và yêu cầu export sang `.emulator-data/`; lần bật sau import
nếu có metadata. Đây là dữ liệu local, gồm Auth và RTDB. Muốn bắt đầu sạch, dừng
emulator trước rồi di chuyển thư mục `.emulator-data/` sang tên backup. Dữ liệu
demo localStorage độc lập với export emulator. Không xoá cache/dữ liệu thật của
người dùng để làm test sạch.

## 4. Kịch bản demo Firebase không cần phần cứng

1. Bật emulator, seed, mở web với query emulator.
2. Đăng nhập `hs10a1`, mở `?firebase=emulator#/scan/BIN-01` để mở phiên.
3. Ở terminal khác chạy:

   ```powershell
   node scripts/simulate-bin.cjs BIN-01 plastic
   ```

4. Xem `events/{txId}` thành `processed`, điểm học sinh/lớp tăng 2, có transaction
   và tổng hợp tuần. Sau hơn 3 giây gửi `metal`, tổng điểm tăng thêm 3.
5. Gửi hai lượt ngay liên tiếp: lượt sau phải bị từ chối vì cooldown.
6. Kết thúc phiên trên web rồi gửi tiếp: event phải `rejected`, điểm không đổi.
7. Mở cửa sổ riêng đăng nhập admin để theo dõi dashboard. Cửa sổ riêng cần thiết
   vì Firebase Auth đồng bộ đăng nhập giữa các tab cùng origin.
8. Admin có thể gửi lượt thử cho học sinh tại trang Thùng hoặc Tổng quan. Event
   `source=sim` phải có `createdBy` là UID admin; backend chỉ cho admin active bỏ
   qua điều kiện phiên. Học sinh không có quyền tự gửi loại event này.

Script mô phỏng dùng tài khoản thiết bị seed của BIN-01. Thùng khác cần được cấp
tài khoản/quyền thiết bị tương ứng; truyền BIN-02 sẽ không được tài khoản BIN-01
ghi sự kiện.

## 5. Firmware chính và cầu nối USB

Hướng dẫn chạy từng bước trên Windows (cài đặt, emulator, seed, nạp firmware,
cổng COM và kiểm tra điểm): [README.md](README.md#hướng-dẫn-chạy-trên-laptop-windows).

`hardware/Green-School/Green-School.ino` không có Wi-Fi, Firebase hay nhận lệnh phân loại Edge Impulse.
Nó dùng 4 cảm biến siêu âm: hai cảm biến mở nắp và hai cảm biến đếm rác. Không
được hiểu hai cảm biến đếm là tự nhận diện vật liệu. Quy ước tạm thời: ngăn/cảm
biến 1 là plastic, ngăn/cảm biến 2 là metal; cần xác nhận với cách lắp thực tế.

Giữ nguyên chân và ngưỡng: servo 19/21, còi 27, ngưỡng mở nắp 10 cm, đếm 6 cm,
nhả latch khi xa hơn 8 cm, đóng nắp sau 2 giây. Library Arduino cần `ESP32Servo`.
Mã thêm hai dòng máy đọc được, chỉ phát khi thực sự tăng bộ đếm:

```text
GS_DROP 1 1
GS_DROP 2 1
```

Cột 2 là cảm biến, cột 3 là số đếm từ lúc boot; các dòng debug khác bị bridge
bỏ qua. Chưa biên dịch/nạp firmware hoặc xác nhận hiệu chuẩn phần cứng.
Firmware nguồn chuẩn nằm trong thư mục sketch `hardware/Green-School/` đã trùng tên file; mở trực tiếp file firmware bằng Arduino IDE khi cần nạp.

Khi đã nạp firmware và có quyền dùng thiết bị, đóng Arduino Serial Monitor rồi
chạy từ Windows PowerShell (không để hai chương trình cùng chiếm COM):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\hardware\firebase_usb_bridge.ps1 -Port COM5
```

`-ExecutionPolicy Bypass` chỉ cho process được gọi, không đổi chính sách hệ thống.
Thay COM5 bằng cổng thực tế. Có thể đổi mapping bằng `-Sensor1Type metal
-Sensor2Type plastic`. Tham số `-DeviceEmail`/`-DevicePassword` dùng cho thiết bị
local khác đã cấp quyền. Bridge cố định loopback, không hỗ trợ URL cloud.

Bridge đăng nhập Auth emulator, gửi heartbeat 30 giây/lần, đăng nhập lại sau 50
phút. Mỗi lượt có UUID, PUT có `if-match: null_etag`; retry giữ UUID để tránh ghi
đè event đã xử lý khi mất phản hồi. Timestamp lấy lúc capture, cần đồng hồ PC
đúng. Queue tối đa 100 trong RAM, bỏ event chưa gửi quá 30 giây; không replay lượt
cũ vào phiên học sinh mới. Tắt bridge làm mất queue chưa gửi. Chưa có outbox bền
vững hoặc bảo đảm không mất lượt khi rút USB/mất điện.

## 6. Hợp đồng dữ liệu và quy tắc backend

| Nhánh RTDB | Nội dung |
| --- | --- |
| `settings` | Tên trường/app, mùa, cooldown, thời lượng phiên, rules vật liệu |
| `classes/{classId}` | Thông tin lớp và tổng `points`, `count`, `byType` |
| `weekly/{YYYY-Www}/{classId}` | Tổng hợp tuần ISO, timezone cố định UTC+7 |
| `students/{code}` | Mã HS, tên/lớp, liên kết UID/username, điểm, `lastTs` |
| `users/{uid}`, `usernames/{username}` | Hồ sơ và ánh xạ username sang email Auth |
| `admins/{uid}` | Cờ quyền admin; role hiển thị trong hồ sơ |
| `devices/{uid}` | `{ binId, enabled }`: tài khoản Auth được phép gửi cho thùng |
| `bins/{binId}` | Thông tin, count, heartbeat, activeSession |
| `events/{txId}` | Event đầu vào, trạng thái xử lý, lý do từ chối |
| `transactions/{txId}` | Lịch sử đã tính điểm, hoặc điều chỉnh thủ công |
| `meta` | Cờ đã setup/seed |

Event thiết bị điển hình:

```json
{
  "txId": "USB-unique-id",
  "binId": "BIN-01",
  "type": "plastic",
  "deviceUid": "UID_ACCOUNT_THIET_BI",
  "ts": { ".sv": "timestamp" },
  "status": "pending",
  "source": "esp32"
}
```

REST local: `PUT http://127.0.0.1:9000/events/USB-unique-id.json?ns=demo-green-school-default-rtdb&auth=<ID_TOKEN>`.
`ts` server timestamp sẽ được RTDB resolve thành number; bridge dùng timestamp
PC lúc capture. `studentCode`/`username` là tuỳ chọn; nếu có phải khớp phiên.
Không gửi điểm do thiết bị tự tính. Không ghi trực tiếp transactions/aggregates.

Trigger `onValueCreated('/events/{txId}')` xử lý pending bằng transaction tại root
instance phát sinh sự kiện. Trong cùng transaction: kiểm tra thiết bị enabled,
bin đúng quyền, loại rác, phiên chưa hết hạn, UID học sinh, trạng thái tài khoản,
timestamp (không cũ hơn 60 giây/không tương lai hơn 15 giây), cooldown và trùng ID;
sau đó cập nhật mọi tổng điểm và event thành processed, hoặc rejected có reason.
Phiên hợp lệ được gia hạn khi có lượt thành công. Delivery lại không tính trùng.
Không có trạng thái processing trung gian có thể bị kẹt sau crash.

Root transaction bảo đảm cooldown đồng thời và điểm/lịch sử cùng commit, phù hợp
quy mô demo/trường nhỏ. Khi dữ liệu hoặc contention tăng phải phân vùng, không
coi đây là thiết kế đã benchmark ở quy mô lớn. Retry trigger bật cho lỗi hạ tầng;
sự kiện quá cũ sau khi hệ thống phục hồi sẽ bị từ chối theo chính sách thời gian.
Region emulator `us-central1`, cấu hình tương lai cloud `asia-southeast1`: cần
đối chiếu region database thật trước bất kỳ triển khai được cho phép nào.

Rules chặn học sinh sửa tổng điểm, transaction, role, thiết bị hoặc chiếm/xoá
phiên của người khác đang còn hạn. Device chỉ tạo event mới đúng bin và cập nhật
heartbeat. Admin vẫn có quyền quản trị/cộng trừ điểm và reset mùa từ client.
Username mới chỉ gồm chữ thường, số, underscore, dài 4–20; dấu chấm bị loại khỏi
validator vì không dùng được làm key RTDB.

## 7. Kiểm thử và tiêu chí chấp nhận

Không cần cài dependency để chạy unit test trên Node có sẵn:

```powershell
npm.cmd test
```

Các unit test kiểm tra điểm mọi aggregate, giao dịch trùng/delivery lại, cooldown,
sai thứ tự, phiên thiếu/hết hạn/sai UID, loại rác không có hoặc bị tắt, thiết bị
sai quyền/bị tắt, giả admin simulation, timestamp, key bất thường, tuần UTC+7,
chọn config emulator và không chạy processor trình duyệt ở Firebase mode.

Khi đã cài dependency, **dừng phiên emulator đang chạy trước**, rồi:

```powershell
npm.cmd run test:emulators
```

Lệnh này tạo phiên emulator riêng không import dữ liệu demo, seed fixture rồi
chạy `tests/emulator.integration.cjs` và dừng. Test từ chối seed nếu DB đã có dữ
liệu; không chạy trực tiếp integration file vào phiên đang dùng. Nó kiểm tra
Auth, multi-path registration, Rules cấm giả quyền/sửa điểm/tạo thiết bị, khoá
phiên của người khác và trigger tính điểm thật qua REST không có trình duyệt.
Không dùng token `owner` để giả lập quyền học sinh: owner chỉ dành seed fixture.

Checklist test thủ công bổ sung:

- Setup DB rỗng tại `#/setup`, tạo admin đầu tiên, có settings mặc định; setup lần
  hai phải bị chặn. Đây là luồng khác seed và chưa được integration test bao phủ.
- Đăng ký `10A2-TEST` đúng/sai tên, lớp, mã đã dùng; đăng nhập đúng/sai, đăng xuất,
  đổi mật khẩu; tạo admin thứ hai không làm admin hiện tại bị đăng xuất.
- Hai cửa sổ học sinh khác nhau tranh BIN-01: chỉ một phiên thắng; hết hạn thì
  người khác mở được; gia hạn/kết thúc phiên hoạt động đúng.
- Khoá/reset tài khoản khi có phiên; sự kiện của tài khoản không active không
  cộng điểm. Kiểm tra khả năng đăng ký lại sau reset bằng mã cũ.
- Event trùng ID, sai bin/type, timestamp cũ/tương lai, thiết bị bị disabled,
  source=sim giả, không token: bị từ chối tại Rules hoặc backend, điểm không đổi.
- Admin gửi thử, điều chỉnh điểm, huỷ lượt, reset mùa; đối chiếu học sinh/lớp/tuần,
  bảng xếp hạng và xuất Excel. Thử thao tác quản trị đồng thời ở hai cửa sổ.
- Import Excel mẫu, lớp ở nhiều sheet, thiếu cột, trùng học sinh; in/tải QR và
  xác nhận QR vẫn có query emulator. Camera localhost yêu cầu quyền trình duyệt.
- Đóng trang scan/admin sau khi mở phiên, dùng REST simulator: Functions vẫn tính.
- Ctrl+C/export/import: account Auth và điểm còn nguyên sau khởi động lại.
- Thiết bị thật: mapping ngăn, đếm một lần khi vật còn trong ngưỡng, nhả >8 cm,
  mất echo, rút/cắm USB, cổng COM bận, mất emulator, retry không tính trùng,
  heartbeat online/offline. Không tự nạp firmware khi chưa được yêu cầu.

## 8. Trạng thái xác minh và phần còn lại

Đã chạy unit test và kiểm tra cú pháp JS/PowerShell ở lượt bàn giao. Chưa chạy
Auth/RTDB/Functions emulator, chưa validate Rules bằng runtime emulator, chưa
kiểm tra browser trực quan, chưa compile/nạp Arduino hoặc thử USB thật. Không
được diễn giải unit pass thành end-to-end pass. Cần chạy `test:emulators` sau khi
cài dependencies và ghi nhận lỗi thực tế trước khi kết luận sẵn sàng demo.

Các giới hạn cần xử lý trước khi mở cho người dùng thật:

- Chưa có màn hình provision thiết bị Auth; seed local làm việc này. Cloud cần
  luồng cấp/thu hồi credentials riêng, không tái dùng mật khẩu mẫu.
- Một số nhánh như bins, transaction và thông tin mã HS còn đọc công khai theo
  thiết kế ban đầu; cần rà soát quyền riêng tư dữ liệu học sinh trước triển khai.
- Đăng ký còn dựa mã học sinh và đối chiếu thông tin phía client; chưa có backend
  xác minh mã mời/giới hạn dò mã. Bootstrap admin đầu tiên cần luồng provision
  được kiểm soát trước khi public app chưa có admin.
- Khoá tài khoản hiện chủ yếu là trạng thái ứng dụng; chưa disable/revoke Auth
  bằng Admin SDK. Cần kiểm tra và thống nhất hành vi riêng với tài khoản admin.
- Xoá/reset tài khoản admin UI chưa xoá user khỏi Firebase Auth; hàm client
  `removeAuthUser` còn no-op ở Firebase. Hồ sơ/database thay đổi, Auth user cũ có
  thể còn tồn tại; đăng ký lại dùng email nội bộ ngẫu nhiên mới.
- Các thao tác admin cũ như huỷ giao dịch có read-then-update, chưa được chuyển
  sang backend nguyên tử; cần test đồng thời, đặc biệt tránh trừ điểm hai lần.
- Chưa tích hợp Edge Impulse vào firmware chính và chưa có nhận diện vật liệu
  thật. Các file tham khảo không chứng minh tính năng đó đã hoạt động.
- Chưa cài dependency ở lượt này, chưa có lockfile sinh từ cài đặt. Agent tiếp
  theo cài dependencies, lưu lockfile và dùng Node phù hợp để tái lập môi trường.

## 9. Công việc của agent tiếp theo: kiểm thử và deploy Firebase

Người dùng đã xác nhận agent tiếp theo đăng nhập Google và sẽ deploy. Không coi
ghi chú lịch sử "chưa đăng nhập/chưa deploy" trong lượt xây dựng local là lệnh
cấm triển khai. Agent đã được giao thực hiện bước này; không cần xin lại quyền
deploy chỉ vì tài liệu trước đó giới hạn lượt viết code.

1. Kiểm tra phiên Firebase CLI của chính môi trường triển khai và xác định đúng
   project thật từ cấu hình/tài khoản hiện có. Nếu có nhiều project mà không xác
   định được đích, hỏi project ID; không chọn ngẫu nhiên. Không triển khai vào
   `demo-green-school` và không dùng launcher emulator để thực hiện lệnh cloud.
2. Cài dependencies, lưu lockfile, chạy unit và integration emulator, xử lý lỗi
   thực tế. Kiểm tra browser và các luồng trong checklist mục 7. Trạng thái chưa
   kiểm chứng ở mục 8 là trạng thái bàn giao, không phải kết quả test của agent mới.
3. Chuẩn bị Auth Email/Password, Realtime Database, Hosting và Functions của
   project thật. Đối chiếu region DB với Functions, runtime Node và điều kiện
   billing cần cho Functions; báo rõ cấu hình còn thiếu nếu có.
4. Điền Web App config thật, gồm databaseURL, vào `GS.FIREBASE_CONFIG` trong
   `assets/js/config.js`. Giữ config demo/emulator riêng như hiện tại. Kiểm tra
   URL cloud không có `?firebase=emulator`, Auth domain và QR dùng URL Hosting thật.
5. Hoàn tất luồng cấp admin đầu tiên và tài khoản thiết bị thật. Không chạy seed
   mẫu vào cloud, không đưa mật khẩu demo hoặc service-account private key vào
   frontend. Xử lý các giới hạn về Rules, thông tin học sinh và quyền quản trị ở
   mục 8 trước khi mở hệ thống cho học sinh thật.
6. Nếu bản deploy cần nhận lượt từ ESP32, bổ sung cầu nối USB hỗ trợ Firebase
   cloud với HTTPS và Auth phù hợp. Bridge hiện tại cố định localhost nên deploy
   web/Functions không tự làm thiết bị gửi được lên cloud. Tiếp tục dùng firmware
   chính `hardware/Green-School/Green-School.ino`; không thay bằng mẫu Edge Impulse/Wi-Fi mà không kiểm
   tra phần cứng. Giữ chế độ local hoạt động khi bổ sung chế độ cloud.
7. Kiểm tra danh sách file Hosting để tránh public code backend, dữ liệu học sinh,
   secrets và tài liệu nội bộ; deploy Rules, Functions và Hosting tới project ID
   thật đã xác định. Dùng CLI đăng nhập của agent triển khai, không dùng config
   cô lập `.cache/firebase-config/` của launcher local.
8. Smoke test trên URL thật: đăng nhập/đăng xuất, mở phiên QR, thiết bị được cấp
   quyền gửi event, Functions tính điểm khi không có tab admin, realtime ranking,
   quyền bị từ chối và log Functions. Báo URL Hosting, project ID, thành phần đã
   deploy, kết quả test và phần chưa hoàn tất. Nếu thiết bị chưa kiểm tra được,
   ghi rõ giới hạn đó, không báo tích hợp ESP32-cloud đã hoạt động.

Lượt viết tài liệu này không đăng nhập hay deploy; quyền và công việc triển khai
ở trên dành cho agent tiếp theo theo chỉ dẫn mới của người dùng.

Tài liệu chính thức: https://firebase.google.com/docs/emulator-suite/install_and_configure
và https://firebase.google.com/docs/functions/local-emulator.
