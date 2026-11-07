# USB bridge, camera và Firebase

Hướng dẫn setup đầy đủ: [README.md](../README.md). Web cloud, phiên QR và backend Node.js trên laptop được dùng chung cho hai chế độ.

## Chọn đúng firmware và chương trình

| Chế độ | Firmware `AI_CONTROL_ENABLED` | Chương trình giữ COM |
| --- | --- | --- |
| Camera AI | `1` (mặc định mới) | `hardware/camera_ai.py` |
| Đếm thủ công | `0`, cần upload lại | `hardware/firebase_http_bridge.py` hoặc bridge PowerShell cũ |

Không chạy hai bridge, Arduino Serial Monitor hoặc `ei_bridge.py` trên cùng COM. Backend Node.js không giữ COM nên phải chạy song song trong cửa sổ khác.

```powershell
npm.cmd run backend
# Cửa sổ riêng, chọn MỘT lệnh phù hợp firmware:
.\.venv\Scripts\python.exe hardware/camera_ai.py --port COM5 --camera 0 --fps 5
.\.venv\Scripts\python.exe hardware/firebase_http_bridge.py --port COM5
```

Config `hardware/bin_config.json` chứa `bin_id` trùng thùng/QR đã tạo trên web, được đọc theo vị trí script. Có thể dùng `--config <path>`. Mapping mặc định sensor 1 = plastic, 2 = metal; dùng `--sensor1 metal --sensor2 plastic` ở chương trình đã chọn nếu lắp ngược. Camera yêu cầu hai mapping khác nhau.

Học sinh đăng nhập web và quét QR trước khi bỏ rác, ví dụ https://smarttrashbin-98428.web.app/#/scan/BIN-01. Bridge không hỏi email/mật khẩu và không dùng service account. Chỉ backend dùng khóa quản trị trong `.env`/`secrets/`.

## Giao thức AI version 1

115200 baud, ASCII mỗi dòng kết thúc newline. Request ID là 32 ký tự hex thường, sensor chỉ 1/2. Máy tính chỉ ARM sau khi nhận READY.

| Chiều | Message | Ý nghĩa |
| --- | --- | --- |
| ESP32 -> PC | `GS_AI_BOOT 1` | Khởi động/reset, hủy pending cũ ở PC |
| PC -> ESP32 | `GS_AI_HELLO 1` | Bắt tay; thu hồi quyền cũ nếu controller reconnect |
| ESP32 -> PC | `GS_AI_READY 1` | Sẵn sàng, nắp không mở và cảm biến đếm không đang giữ vật |
| ESP32 -> PC | `GS_AI_OFFLINE 1` | Mất ping quá 3 giây; PC thu hồi READY/lượt đang chờ, đặt lại thời gian chờ và bắt tay lại |
| ESP32 -> PC | `GS_AI_MANUAL 1` | Firmware thủ công, camera phải dừng |
| PC -> ESP32 | `GS_AI_PING` | Mỗi 1 giây |
| PC -> ESP32 | `GS_AI_ARM <id> <sensor>` | Mở ngay đúng ngăn, chờ rác tối đa 5 giây |
| ESP32 -> PC | `GS_AI_ACK <id> <sensor>` | Nhận quyền, chưa phải xác nhận rác |
| ESP32 -> PC | `GS_AI_DROP <id> <sensor> <counter>` | Cạnh rác mới, đúng ngăn, sau một chu kỳ đã mở nắp |
| PC -> ESP32 | `GS_AI_CANCEL <id>` | Thu hồi quyền mở/gia hạn lượt mới |
| ESP32 -> PC | `GS_AI_DONE <id> <reason>` | Quyền kết thúc, đã ra lệnh đóng hai nắp và cảm biến đếm trống; reason drop/timeout/cancel/link_lost |

Mất ping > 3 giây thu hồi quyền và báo OFFLINE, không tự chuyển sang thủ công. ARM trùng không kéo dài deadline; request khác khi bận bị bỏ. Python không retry mở khi mất ACK, mà hủy và handshake lại. Quá 15 giây chưa READY sẽ dừng và báo kiểm tra firmware/cảm biến. Cập nhật cả firmware/Python để có thông báo OFFLINE; xem [mô phỏng](../MO_PHONG_ESP.md).

ESP32 chỉ đọc hai HC-SR04 đếm rác: nhựa TRIG/ECHO 23/34, kim loại 22/35. AI mở servo D18 (nhựa) hoặc D19 (kim loại) ngay khi nhận quyền. Ngưỡng đếm/nhả 6/8 cm, còi 200 ms. Sau đếm/hết hạn/hủy/mất kết nối, đóng sau 2 giây khi cảm biến đếm trống; còn vật hoặc mất ECHO sẽ giữ mở. Thủ công chỉ đếm, mở nắp bằng tay.

Cả AI/thủ công vẫn in `GS_DROP <sensor> <counter>` và log khoảng cách. **Python AI bỏ qua GS_DROP**; chỉ AI_DROP đúng ID/ngăn, ACK, thời hạn và chưa xử lý mới tạo event. Firmware thủ công dùng GS_DROP qua bridge cũ. ACK/DONE không phải phản hồi vị trí servo cơ khí.

## Gửi event và backend

`FirebaseBridge` trong `firebase_http_bridge.py` được camera import lại, không mở COM lần hai. `send_drop(sensor, captured_ms, stop=None, expected_session=None)` giữ tương thích caller cũ; camera truyền snapshot phiên gồm uid/studentCode/username/startedAt. Gia hạn expiresAt vẫn được chấp nhận, đổi người/phiên thì không gửi sang chủ mới.

Timestamp là lúc PC nhận xác nhận USB. Payload giữ `source: esp32`, `status: pending`, loại rác mapping đúng sensor và thông tin học sinh. Không gửi confidence, ảnh hoặc request ID AI vào Rules. Sender retry giữ nguyên txId, timestamp và học sinh, kiểm tra event đã tồn tại sau mất phản hồi PUT và không ghi đè event đã processed.

`SENT` chỉ xác nhận database nhận event, không phải đã cộng điểm. Backend kiểm tra lại phiên, user, rule, timestamp và cooldown; `PROCESSED` mới xác nhận cộng điểm, `REJECTED` có reason. Web theo dõi kết quả realtime; backend không cần trang admin mở.

Heartbeat 30 giây cập nhật lastSeen và `ip: python-usb-bridge`. Web xem thùng online trong khoảng 90 giây từ lastSeen, không đo sức khỏe camera/servo. Trong AI, monitor phiên/settings độc lập sender, dữ liệu quá 2,5 giây không được dùng cấp quyền mới. Không đọc được phiên/settings thì dừng cấp quyền.

Queue giới hạn 100 lượt trong RAM, TTL gửi 30 giây. Mất tiến trình có thể mất lượt chưa gửi; backend từ chối event cũ/phiên hết hạn. Không tự replay bằng txId mới.

## Quyền và triển khai

Luồng camera không yêu cầu đổi database Rules, loại source hoặc deploy web. Bản Rules hiện tại chỉ cho bridge tạo event pending đúng schema/thùng/phiên/loại/timestamp và heartbeat; không cho ghi điểm/phiên hoặc sửa event cũ. Khóa Admin SDK chỉ dùng ở backend tin cậy.

ID thùng không phải xác thực: người biết bin/phiên vẫn có thể giả gửi event/heartbeat. Camera không giải quyết hạn chế xác thực đó. HTTP 401/403 cần kiểm tra Rules, bin ID, phiên, mapping và đồng hồ laptop, không đăng nhập tài khoản thùng.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
npm.cmd test
npm.cmd run test:emulators
```
