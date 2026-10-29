# Phương án ESP32 + Firebase, không dùng Blaze

Ngày: 29/10/2026. Tài liệu bàn giao cho bước triển khai tiếp theo.

## 1. Quyết định và trạng thái

Chọn ESP32 kết nối Wi-Fi và gửi HTTPS trực tiếp tới Firebase. Firebase tiếp tục phục vụ Hosting, Authentication và Realtime Database trong hạn mức Spark. Không cần Cloud Functions, server bên ngoài hoặc máy tính chạy thường trực khi hệ thống hoàn tất.

**Đây là tài liệu phương án, chưa phải bản firmware đã triển khai.** Lượt này chỉ backup và viết tài liệu; firmware, Rules, web và bản deploy đang chạy được giữ nguyên. Luồng tự cộng điểm trên cloud hiện vẫn chưa hoạt động.

Thông tin dự án:

| Mục | Giá trị |
|---|---|
| Project | `smarttrashbin-98428` |
| Website | https://smarttrashbin-98428.web.app/ |
| Database | `https://smarttrashbin-98428-default-rtdb.asia-southeast1.firebasedatabase.app` |
| Tài khoản quản trị web | `ADMIN`, đăng nhập không phân biệt hoa thường |
| Firmware chính | `hardware/Green-School/Green-School.ino` |

Mật khẩu admin không được đưa vào firmware, tài liệu hoặc source public. ESP32 phải dùng tài khoản thiết bị riêng.

## 2. Backup trước khi đổi kiến trúc

File: `backups/green-school-before-esp32-20261029-170122.zip`.

- Chứa 49 file nguồn, cấu hình, lockfile, tài liệu, test và firmware tại thời điểm backup.
- Đã mở ZIP, kiểm tra số file và đối chiếu SHA-256 từng nội dung với file gốc.
- SHA-256 ZIP: `8BD593075F025CEF9CA57F97C24F0D499F04448B07A3B7564553A3F2080DDA59`.
- Loại trừ dependencies, public sinh tự động, cache, log, emulator data, Git, backup lồng nhau và file `.env*`.
- Đây là backup source local; không chứa bản export dữ liệu/Auth cloud hoặc credentials đăng nhập Google. Không xem ZIP là bản khôi phục toàn bộ Firebase.

Khôi phục bằng cách giải nén vào thư mục mới, chạy `npm.cmd ci` và `npm.cmd --prefix functions ci` nếu cần bản backend cũ. Chạy `node scripts/prepare-hosting.cjs` để tạo lại public. Deploy bản cũ không làm tự cộng điểm cloud hoạt động khi chưa có Cloud Functions.

## 3. ESP32 hiện đang làm gì

Firmware hiện tại đọc 4 cảm biến siêu âm, điều khiển 2 servo và còi, đếm lượt khi vật đi qua ngăn, gửi `GS_DROP 1 <count>` hoặc `GS_DROP 2 <count>` qua USB Serial. Chưa có Wi-Fi, Firebase Auth, HTTPS hoặc tính điểm cloud.

| Phần cứng | GPIO |
|---|---|
| Cảm biến mở nắp 1, TRIG/ECHO | 5 / 18 |
| Cảm biến mở nắp 2, TRIG/ECHO | 17 / 16 |
| Cảm biến đếm ngăn 1, TRIG/ECHO | 22 / 23 |
| Cảm biến đếm ngăn 2, TRIG/ECHO | 13 / 14 |
| Servo 1 / 2 | 19 / 21 |
| Còi | 27 |

Giữ nguyên ngưỡng mở nắp 10 cm, đếm 6 cm, nhả latch trên 8 cm, đóng nắp sau 2 giây và còi 200 ms. Mapping dự kiến: ngăn 1 = nhựa, ngăn 2 = kim loại; cần kiểm tra cách lắp thực tế. Cảm biến siêu âm không nhận diện vật liệu.

USB còn dùng để nạp/debug; khi chạy độc lập ESP32 cần nguồn phù hợp và Wi-Fi có Internet.

## 4. Luồng mục tiêu

```text
Học sinh đăng nhập web → quét QR → Firebase lưu phiên của thùng
                                       ↓
ESP32 đăng nhập tài khoản thiết bị → đọc phiên + quy tắc điểm
                                       ↓
Cảm biến nhận lượt → tạo eventId cố định → gửi thao tác tính điểm qua HTTPS
                                       ↓
Database Rules kiểm tra quyền, phiên, dữ liệu và điều kiện cộng điểm
                                       ↓
Commit điểm/lượt hợp lệ → web nhận realtime và cập nhật bảng xếp hạng
```

ESP32 phải xử lý được khi không có trang admin hoặc trang học sinh đang mở, miễn phiên vẫn còn hợp lệ. Không bật lại processor cộng điểm trong trình duyệt làm backend chính.

## 5. HTTPS và xác thực

- Đăng nhập tài khoản thiết bị bằng Firebase Authentication REST; lưu và refresh token theo thời hạn trả về.
- Mỗi thiết bị có UID riêng và `/devices/{uid} = { binId, enabled }`. Có thể thu hồi quyền bằng `enabled=false`.
- `GET /bins/BIN-01/activeSession.json` để đọc phiên; `GET /settings/rules.json` để đọc quy tắc. Các request có xác thực theo Rules tương ứng.
- Gửi heartbeat bằng `PATCH` đúng thùng được cấp quyền; không cấp quyền admin hoặc quyền ghi root cho ESP32.
- HTTPS phải kiểm tra chứng chỉ máy chủ. Đồng bộ thời gian trước khi kiểm tra TLS và gửi lượt. Không dùng `setInsecure()` cho bản triển khai.
- Credentials Wi-Fi/thiết bị đặt trong cấu hình local không đưa vào Hosting; không in password, ID token hoặc refresh token vào Serial log.
- Request mạng phải có timeout và chạy tách khỏi vòng điều khiển cảm biến/servo để mạng chậm không làm ngừng hoạt động nắp.

## 6. Tính điểm: phần cần thiết kế lại trước khi viết firmware

**Không thể chỉ thêm PUT vào `/events` rồi giữ nguyên hệ thống hiện tại.** `functions/index.js` mới là nơi gọi bộ tính điểm ở cloud; processor trình duyệt chỉ chạy trong demo. Rules hiện chặn thiết bị ghi trực tiếp các tổng điểm.

Không được mở quyền cho thiết bị tùy ý PATCH `classes`, `students`, `weekly` và `transactions`. Token thiết bị bị lộ khi đó có thể sửa tổng điểm. Tăng điểm rồi ghi lịch sử bằng các request rời rạc cũng có thể cộng trùng hoặc mất đồng bộ khi mất mạng.

Hướng thiết kế cần thử nghiệm trong emulator:

1. Gom bản ghi lượt và trạng thái tính điểm có liên quan vào một phạm vi giao dịch nhỏ, dự kiến theo học sinh/mùa, thay vì đọc/ghi toàn bộ database từ ESP32.
2. Có `eventId` duy nhất, giữ nguyên khi retry; cùng một eventId chỉ được ghi nhận một lần. Lượt được gắn với UID học sinh và phiên lúc capture, không tự chuyển sang phiên của người tiếp theo.
3. Dùng REST conditional GET/PUT: lấy ETag bằng `X-Firebase-ETag: true`, PUT với `if-match`. Khi trả 412 phải đọc lại, kiểm tra event đã commit chưa rồi mới quyết định retry. PATCH không hỗ trợ conditional ETag.
4. Rules phải kiểm tra trạng thái trước/sau của toàn bộ đơn vị giao dịch: thiết bị enabled đúng bin, phiên còn hạn, UID học sinh đúng, tài khoản active, loại rác enabled, điểm tăng đúng quy tắc, count tăng đúng một, cooldown, timestamp và lịch sử cũ không bị sửa/xóa.
5. Ưu tiên một nguồn dữ liệu tính điểm có thẩm quyền. Web có thể tổng hợp lớp/tuần từ dữ liệu đã được Rules kiểm chứng ở quy mô trường nhỏ. Nếu giữ các tổng điểm lưu sẵn ở nhiều nhánh, phải chứng minh được chúng và lịch sử commit nhất quán trước khi cho chạy.
6. Cooldown phải đúng cả khi học sinh dùng hai thùng, không chỉ kiểm tra RAM trên một ESP32. ETag riêng của mỗi thùng không tự giải quyết trường hợp này.

Schema cuối cùng và Rules chưa được viết/chứng minh trong lượt này. Chỉ chốt schema sau khi test đồng thời, giả mạo và retry qua emulator đạt. Security Rules kiểm chứng request; chúng không tự chạy chương trình cộng điểm thay Cloud Functions.

Thiết bị hợp lệ vẫn là nguồn tin cho việc cảm biến có phát hiện rác hay không; Rules không chứng minh được sự kiện vật lý. Đây là giới hạn của mô hình tin cậy thiết bị.

## 7. Những file/luồng phải cập nhật cùng nhau

| Thành phần | Công việc |
|---|---|
| `hardware/Green-School/Green-School.ino` | Wi-Fi, HTTPS/TLS, Auth/refresh, phiên, eventId, queue, retry, heartbeat, giao dịch tính điểm |
| `firebase/database.rules.json` | Quyền tối thiểu thiết bị, bảo toàn số điểm và lịch sử, chống trùng/giả mạo |
| `assets/js/core/services.js` | Adapter dữ liệu điểm mới, thao tác điều chỉnh/hủy/reset nhất quán |
| `assets/js/pages/home.js`, `me.js` | Ranking, tổng tuần, điểm cá nhân, lịch sử theo nguồn dữ liệu mới |
| `assets/js/admin/` | Dashboard, điểm, QR, thùng và mô phỏng phù hợp kiến trúc mới |
| Provision thiết bị | Tạo Auth riêng, liên kết UID-bin, thu hồi; không dùng admin trên ESP32 |
| `tests/` | Test Rules, retry, cạnh tranh nhiều thiết bị, aggregates và thao tác admin |
| `functions/`, USB bridge | Giữ làm bản tham chiếu/đường local cũ; tránh hai processor cộng cùng một lượt |

Không tự động chuyển dữ liệu live hoặc deploy Rules mới trước khi firmware và web tương thích. Không tự nạp firmware lên board khi chưa xác định board/cổng COM và có yêu cầu nạp.

## 8. Mất mạng, mất điện và retry

- EventId tạo một lần tại capture, không tạo ID mới sau timeout.
- Queue có giới hạn và TTL; không nhận lượt cũ cho phiên mới. Khuyến nghị bắt đầu TTL 30 giây như bridge hiện tại, kiểm tra lại theo yêu cầu vận hành.
- Không có phiên hợp lệ hoặc không xác nhận được trạng thái thì không báo đã cộng điểm. Hoạt động cơ khí vẫn tiếp tục.
- Timeout sau PUT có thể là đã commit: đọc trạng thái event trước khi cộng lại.
- Chọn rõ queue RAM hay NVS. Queue RAM mất khi tắt nguồn; nếu cần chống mất lượt qua reboot phải có outbox bền vững và test giới hạn ghi flash.
- Không hứa đảm bảo không mất lượt khi mất điện nếu chưa triển khai và kiểm thử outbox.

## 9. Checklist nghiệm thu

- [ ] Compile đúng board ESP32 và thư viện; kiểm tra mapping, nắp, còi, ngưỡng và chống đếm lặp trên thiết bị thật.
- [ ] Auth thiết bị, refresh token, TLS, mất Wi-Fi/kết nối lại, heartbeat hoạt động.
- [ ] Học sinh quét QR, bỏ nhựa/kim loại; điểm cá nhân/lớp/tuần và lịch sử đúng quy tắc.
- [ ] Đóng mọi trang admin: ESP32 vẫn ghi nhận và tính điểm.
- [ ] Retry cùng eventId, mất phản hồi sau commit, reboot và hai thùng đồng thời không tính trùng hoặc ghi đè điểm.
- [ ] Phiên thiếu/hết hạn/đổi học sinh, tài khoản khóa, thiết bị disabled/sai bin, timestamp sai và loại rác tắt bị từ chối.
- [ ] Client sửa request để tự tăng điểm, sửa lịch sử hoặc bỏ cooldown bị Rules chặn.
- [ ] Hủy lượt, điều chỉnh thủ công, reset mùa, import học sinh và bảng xếp hạng hoạt động với schema mới.
- [ ] Kiểm tra lưu lượng, kích thước payload và tài nguyên ESP32; tránh tải toàn bộ lịch sử của trường lên board.
- [ ] Backup dữ liệu cloud trước migration, thử rollback, deploy web/Rules tương thích và smoke test live trên Spark.

Chỉ báo hoàn tất phương án không Blaze sau khi cả emulator, bản live và thiết bị thật đạt các tiêu chí liên quan.

## 10. Tài liệu chính thức

- [Firebase Realtime Database REST API, HTTPS và phương thức request](https://firebase.google.com/docs/reference/rest/database)
- [REST conditional requests, ETag và retry](https://firebase.google.com/docs/database/rest/save-data#section-conditional-requests)
- [Firebase Authentication REST](https://firebase.google.com/docs/reference/rest/auth)
- [Realtime Database Security Rules](https://firebase.google.com/docs/database/security)

`DEPLOYMENT.md` mô tả bản cloud hiện tại; yêu cầu Blaze trong tài liệu đó áp dụng cho backend Cloud Functions cũ. Hướng thay thế đã chọn là tài liệu này, nhưng chưa triển khai.
