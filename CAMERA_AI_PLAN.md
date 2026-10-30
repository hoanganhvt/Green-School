# Kế hoạch tích hợp camera AI vào Green School

Ngày: 30/10/2026. Trạng thái: đã implement code camera, sender và firmware AI/manual;
chưa upload board hoặc nghiệm thu phần cứng. Xem README.md để setup/vận hành.

Chi tiết thực hiện: có thêm downloader/checksum và lệnh --check-model/--image;
preview cần nhấn C khi vùng trống để calibrate. Khi mất echo, nắp đang mở chờ
đọc được khoảng cách trống hợp lệ thay vì ép đóng theo timeout cảm biến.
Các checkbox thử trên thiết bị dưới đây chỉ hoàn tất sau khi đo thực tế.

Đã kiểm thử: 26 test Python, 26 test Node, Auth/Database/Hosting Emulator với
backend thật, harness firmware hai chế độ và compile ESP32 Dev Module với
ESP32 core 3.3.12 / ESP32Servo 3.2.1. Chưa nạp board hoặc mở camera thật.

## 1. Phạm vi và phân chia trách nhiệm

Thêm chương trình Python trên máy tính backend, đọc camera theo FPS cấu hình và dùng WasteWise để chọn ngăn nhựa/kim loại. Giữ nguyên các chức năng phần cứng hiện có liên quan đến khoảng cách, đóng/mở nắp, đếm rác và còi.

- **Máy tính:** camera, suy luận AI, kiểm tra phiên QR, cấp quyền mở đúng ngăn, quản lý lượt và gửi sự kiện Firebase.
- **ESP32:** nhận lệnh cho phép ngăn, tiếp tục đọc cảm biến khoảng cách, điều khiển servo theo khoảng cách/thời gian hiện tại, phát hiện rác rơi và báo về máy tính. Không chạy AI hoặc cộng điểm.
- **Backend Node.js:** kiểm tra event, phiên, cooldown và chống trùng; cộng điểm như hiện tại.

Lưu ý làm rõ yêu cầu: “ESP32 nhận lệnh và điều khiển servo” nghĩa là không chạy AI trên ESP32; **không loại bỏ các chức năng cảm biến hiện có**. Kế hoạch này thay thế phần phân công bỏ cảm biến trong bản trước.

Bản đầu: một camera, một ESP32, hai ngăn, một vật mỗi lượt. Không train model, không thêm cloud AI hoặc dashboard camera.

## 2. Các chức năng phần cứng bắt buộc giữ lại

Thông số lấy từ `hardware/Green-School/Green-School.ino`; giữ giá trị mặc định, chỉ hiệu chỉnh khi đo thực tế cho thấy cần và ghi rõ thay đổi.

| Chức năng | Hiện tại | Yêu cầu khi thêm AI |
| --- | --- | --- |
| Cảm biến gần nắp 1 | TRIG 5, ECHO 18 | Tiếp tục đo khoảng cách và kích hoạt mở nắp 1 khi được AI cho phép |
| Cảm biến gần nắp 2 | TRIG 17, ECHO 16 | Tiếp tục đo khoảng cách và kích hoạt mở nắp 2 khi được AI cho phép |
| Ngưỡng mở nắp | Khoảng cách hợp lệ > 0 và ≤ 10 cm | Giữ nguyên; AI là điều kiện cho phép bổ sung |
| Tự đóng nắp | Sau 2.000 ms không còn phát hiện gần | Giữ timer và xử lý riêng cho từng nắp |
| Cảm biến đếm 1 | TRIG 22, ECHO 23 | Giữ phát hiện và bộ đếm ngăn 1 |
| Cảm biến đếm 2 | TRIG 13, ECHO 14 | Giữ phát hiện và bộ đếm ngăn 2 |
| Phát hiện rác | Khoảng cách hợp lệ ≤ 6 cm | Giữ phát hiện cạnh, không đếm mỗi vòng loop |
| Cho phép đếm lại | Vật ra xa > 8 cm | Giữ hysteresis và trạng thái riêng từng ngăn |
| Servo | GPIO 19/21, 50 Hz, xung 500–2.400 µs; góc 0°/90° | Giữ thông số và hiệu chỉnh cơ khí |
| Còi | GPIO 27, kích LOW, 200 ms | Giữ báo rác qua cảm biến và tự tắt |
| Log, bộ đếm, `GS_DROP` | Đếm từng ngăn và xuất USB | Giữ cho chẩn đoán/bridge thủ công; không gửi trùng event trong chế độ AI |

Đọc siêu âm timeout trả -1 vẫn phải bị bỏ qua, không được coi là có vật hoặc vùng cửa đã trống. Đo khoảng cách và bộ đếm cục bộ vẫn chạy khi model/mạng lỗi; chỉ ngừng cấp quyền mở lượt AI mới và gửi tính điểm không đủ điều kiện.

## 3. Luồng vận hành

### Toàn bộ hệ thống web Firebase hiện tại

Web cấu hình cho `https://smarttrashbin-98428.web.app/`, Firebase project `smarttrashbin-98428`. Đây là các vai trò riêng:

| Thành phần | Vai trò trong luồng hoàn chỉnh |
| --- | --- |
| Firebase Hosting | Phục vụ web HTML/CSS/JS trên điện thoại hoặc máy tính; không chạy chương trình Python hay backend Node.js |
| Firebase Authentication | Đăng nhập học sinh/admin; web ánh xạ username sang email nội bộ để đăng nhập |
| Firebase Realtime Database + Rules | Chia sẻ phiên thùng, settings, event, giao dịch và tổng điểm; kiểm tra quyền client/bridge |
| Web học sinh | Quét QR đúng thùng, mở/gia hạn/kết thúc phiên, xem lượt được chấp nhận/từ chối và điểm realtime |
| Web quản trị | Quản lý học sinh/lớp/tài khoản, thùng và QR, quy tắc điểm, xem event, thống kê/lịch sử và bảng xếp hạng |
| Laptop: bridge/camera mới | Đọc ID thùng, phiên Firebase và phần cứng USB; gửi heartbeat/event; bổ sung nhận diện AI |
| Laptop: backend Node.js | Dùng Admin SDK và service account để xử lý pending event; chạy độc lập với trình duyệt |
| ESP32 | Khoảng cách, servo, cảm biến đếm, còi và Serial; không dùng Wi-Fi hoặc gọi Firebase trực tiếp |

Luồng hiện tại trước khi thêm AI:

1. Admin tạo lớp/học sinh/tài khoản và thùng trên web; QR chứa route `#/scan/<binId>`. ID đó phải khớp `hardware/bin_config.json` trên laptop.
2. Học sinh đăng nhập web, quét QR hoặc nhập ID. Trang `assets/js/pages/scan.js` gọi `startSession` để ghi transaction vào `bins/<binId>/activeSession`; thùng đang có người khác dùng thì hiển thị bận.
3. Phiên chứa UID, mã/tên đăng nhập học sinh, lớp, startedAt/expiresAt. Mặc định 3 phút; người dùng có thể gia hạn hoặc kết thúc. Đây là căn cứ gắn lượt rác với học sinh, không suy ra danh tính từ camera.
4. ESP32 tự mở theo khoảng cách và phát `GS_DROP` khi cảm biến đếm ghi nhận. Bridge gắn loại theo sensor, đọc phiên hợp lệ tại lúc rơi rồi ghi `events/<txId>` với status pending; heartbeat cập nhật `bins/<binId>/lastSeen`.
5. Backend laptop polling pending khoảng mỗi giây, tối đa 100 event mỗi pass. Transaction kiểm tra ID trùng, thùng, nguồn, loại rác đang bật, timestamp, phiên khớp/còn hạn, tài khoản và cooldown.
6. Lượt hợp lệ tạo `transactions/<txId>`, cập nhật `students`, `classes`, `weekly`, thống kê `bins`, gia hạn phiên và chuyển event sang processed. Lượt không hợp lệ thành rejected có reason. Mặc định nhựa 2 điểm, kim loại 3 điểm, cooldown 3 giây; giá trị vận hành lấy từ settings Firebase.
7. Web subscribe dữ liệu Realtime Database: trang phiên hiển thị lượt/điểm/lý do từ chối, trang cá nhân hiện lịch sử, trang chủ/admin cập nhật bảng xếp hạng/thống kê. Không cần reload trang hoặc giữ trang admin mở để backend cộng điểm.

`S.processEvent` và `startProcessor` trong JavaScript web chỉ thực sự xử lý điểm ở chế độ demo; với Firebase thật, backend laptop xử lý. Không đưa camera vào browser hoặc chuyển tính điểm về frontend khi tích hợp AI.

Camera QR của web và camera AI trên laptop là hai vai trò khác nhau. Web có thể chạy trên điện thoại để quét QR, Python dùng webcam nối laptop để phân loại; nếu dùng cùng webcam trên cùng máy phải xử lý tranh thiết bị và giải phóng camera QR trước khi Python mở.

Hosting lấy nội dung từ `public/`, được chuẩn bị bởi `scripts/prepare-hosting.cjs` từ `index.html`, `manifest.webmanifest`, `assets/`. Nếu phải sửa giao diện/hướng dẫn trên web thì sửa nguồn `assets/`/`index.html`, không chỉ sửa bản sao `public/`. Không deploy trong bước lập kế hoạch.

### Luồng bổ sung AI

```text
Quét QR -> Firebase activeSession
Camera -> Python/WasteWise -> nhãn ổn định + phiên hợp lệ
                          -> USB cấp quyền ngăn 1 hoặc 2
ESP32: quyền AI đúng ngăn + khoảng cách ≤ 10 cm -> mở servo
Cảm biến đếm đúng ngăn phát hiện cạnh rác rơi -> USB xác nhận có ID lượt
Python -> FirebaseBridge -> events/pending -> backend kiểm tra/cộng điểm -> web
ESP32: không còn vật gần nắp trong 2 giây -> đóng nắp
```

**Điều kiện mở trong chế độ AI:** quyền AI còn hiệu lực **và** cảm biến gần nắp tương ứng phát hiện trong ngưỡng. Ngăn còn lại không mở chỉ vì có người đưa tay tới. AI không bỏ qua kiểm tra khoảng cách và không mở cả hai ngăn.

Sau rác rơi hoặc timeout, ngừng quyền mở/gia hạn mở của lượt; vẫn hoàn thành chu kỳ đóng nắp theo khoảng cách. Không nhận lượt tiếp theo trước khi nắp đóng, cảm biến đếm đã nhả và vùng camera đã clear. Chỉ chờ đóng không được arm lại cùng vật.

Chương trình camera là tiến trình duy nhất mở COM khi chạy AI, thay cho chạy `firebase_http_bridge.py` hoặc `firebase_usb_bridge.ps1` riêng. Backend Node.js tiếp tục chạy riêng; Firebase là kênh tích hợp có sẵn, không thêm server trung gian.

## 4. Model và xác minh trước tích hợp

Nguồn: [WasteWise model card](https://huggingface.co/SriramRokkam/wastewise-garbage-cls), [file model](https://huggingface.co/SriramRokkam/wastewise-garbage-cls/tree/main).

Theo model card: YOLOv8n-cls, RGB 224×224, tám lớp; file `wastewise-yolo.onnx` khoảng 5,81 MB. Model phân loại ảnh, không cung cấp detector/tracking hoặc bằng chứng rác rơi.

- Tải model vào `hardware/models/`, ghi revision đầy đủ, SHA-256, nguồn và thông tin giấy phép. Không tự tải lại mỗi lần chạy.
- Kiểm tra input/output/metadata bằng ONNX Runtime, đối chiếu nhãn với model card. Mâu thuẫn thì dừng, không đoán nhãn.
- Tiền xử lý dự kiến theo tác giả: BGR -> RGB, resize 224×224, float32/255, NCHW `[1,3,224,224]`; xác minh bằng ảnh tĩnh trước.
- Thứ tự nhãn dự kiến: `battery, biological, cardboard, glass, metal, paper, plastic, trash`. Argmax trên đủ tám lớp rồi mới xét `plastic`/`metal`, không ép model chọn một trong hai.
- Xác minh output là xác suất hay logits trước threshold; không softmax hai lần. Shape sai, NaN hoặc nhãn không xác định không được điều khiển phần cứng.
- Thử ảnh chai/lon/vật khác để kiểm tra nhãn và preprocessing. Không mặc định ONNX đã là INT8; kích thước file không phải tổng RAM chạy.

## 5. Chương trình Python nhỏ

File mới: `hardware/camera_ai.py`. Dependency riêng tại `hardware/requirements-camera.txt`: `opencv-python`, `onnxruntime` CPU, `numpy`, dùng lại `pyserial`. Chốt phiên bản phù hợp Windows/Python thực tế khi implement.

| Tham số | Mặc định dự kiến |
| --- | --- |
| `--camera` | `0` |
| `--fps` | `5`, là giới hạn FPS suy luận |
| `--model` | `hardware/models/wastewise-yolo.onnx` |
| `--port` | Bắt buộc khi điều khiển, ví dụ `COM5` |
| `--config` | `hardware/bin_config.json` |
| `--sensor1`, `--sensor2` | `plastic`, `metal`; phải khác nhau và dùng chung mapping servo/event |
| `--threshold` | `0.85`, hiệu chỉnh sau thử thực tế |
| `--stable-frames` | `3` mẫu mới liên tiếp cùng nhãn vượt ngưỡng |
| `--dry-run` | Chỉ camera/model, không COM hoặc ghi Firebase |

Preview hiển thị vùng đặt vật, nhãn, điểm, FPS thực tế và trạng thái lượt. Crop vùng vuông giữa ảnh trước resize để giảm nền và méo ảnh; vẽ đúng vùng model sử dụng.

- Luồng capture chỉ giữ frame mới nhất và timestamp; không backlog video. Suy luận theo monotonic, không chạy bù, không xử lý lặp cùng frame, bỏ frame cũ hơn 1 giây.
- Luồng Serial và HTTP sender riêng để model/mạng chậm không chặn đọc rác rơi. Model load một lần, CPU provider.
- Nhãn đổi, confidence thấp hoặc ảnh lỗi reset chuỗi ổn định. Không gửi quyền mở lặp khi lượt đang bận.
- Sau mỗi lượt yêu cầu vùng quan sát trống ổn định khoảng 1 giây trước khi arm lại. Kiểm tra nền đơn giản, calibrate khi thực sự trống; model không có lớp nền trống nên không dùng riêng nhãn `trash` để kết luận vùng trống.
- CLI phải kiểm tra số hữu hạn, FPS dương, threshold trong `(0,1]`, stable frames nguyên dương; lỗi camera/model/COM dừng cấp quyền mới.
- Không lưu ảnh mặc định, không log token/secret. Có log mã lượt, nhãn, trạng thái, thời gian suy luận và kết quả gửi event.

## 6. Giao thức USB và quyền mở theo lượt

Giữ 115200 baud, mỗi message một dòng. Bổ sung giao thức AI version 1, giữ `GS_DROP <sensor> <counter>` cũ cho tương thích.

| Chiều | Message | Ý nghĩa |
| --- | --- | --- |
| PC -> ESP32 | `GS_AI_HELLO 1` | Bắt tay giao thức |
| ESP32 -> PC | `GS_AI_READY 1` | Firmware hỗ trợ AI, chưa cấp quyền ngăn nào |
| PC -> ESP32 | `GS_AI_PING` | Heartbeat mỗi giây |
| PC -> ESP32 | `GS_AI_ARM <requestId> <sensor>` | Cho phép ngăn tương ứng mở theo khoảng cách, thời hạn lượt 5 giây |
| ESP32 -> PC | `GS_AI_ACK <requestId> <sensor>` | Đã nhận quyền; chưa chứng minh servo đã mở hoặc rác đã rơi |
| ESP32 -> PC | `GS_AI_DROP <requestId> <sensor> <counter>` | Cạnh cảm biến đếm đúng ngăn của lượt đang chờ |
| PC -> ESP32 | `GS_AI_CANCEL <requestId>` | Thu hồi quyền mở mới của lượt |
| ESP32 -> PC | `GS_AI_DONE <requestId> <reason>` | Đã kết thúc chu kỳ, nắp đã được ra lệnh đóng và cảm biến đếm đã nhả; reason `drop`, `timeout`, `cancel`, `link_lost` |

- UUID hex 32 ký tự, sensor chỉ 1/2; parser giới hạn độ dài, không chờ newline vô hạn, bỏ log thường và dòng lỗi.
- Một lượt tại một thời điểm. ARM trùng ID không mở lại hoặc kéo dài deadline; ID khác khi bận không được thay lượt. Python không tự retry ARM khi thiếu ACK.
- Trước ARM, cảm biến đếm ngăn phải trống. Chỉ báo AI_DROP sau ACK và sau khi firmware đã ra lệnh mở ngăn đúng lượt; mỗi lượt tối đa một xác nhận. Không biến vật kẹt từ trước thành lượt mới.
- Bộ đếm/còi và GS_DROP legacy vẫn phản ánh cạnh cảm biến hiện tại, kể cả ngoài lượt AI. Python AI chỉ gửi event từ AI_DROP khớp pending ID, không gửi thêm event từ GS_DROP.
- Mất ping quá 3 giây, cancel hoặc hết hạn: thu hồi quyền mở mới, không tạo xác nhận AI mới; tiếp tục đo khoảng cách và hoàn thành đóng nắp theo logic thời gian, không đóng cưỡng bức ngay lập tức.
- DONE không phải xác nhận cơ khí đạt góc vì chưa có cảm biến vị trí servo. Không phát DONE chỉ vì hết timeout khi nắp còn phải chờ đóng hoặc cảm biến đếm chưa nhả.
- Firmware có chế độ cấu hình rõ `AI_CONTROL_ENABLED`: AI dùng gating nêu trên; chế độ thủ công giữ luồng khoảng cách cũ. Không tự chuyển sang thủ công khi PC mất kết nối. Chế độ được chọn rõ khi build/nạp.
- Reboot hủy quyền cũ. PC phát hiện reset/handshake mới phải hủy pending, không nhận message cũ hoặc tự mở lại.
- Giữ hiệu chỉnh, khoảng cách và logic timer hiện tại; chỉ thay các delay polling bằng lịch `millis()` nếu đo thực tế cho thấy cần để đáp ứng Serial. Không bỏ đọc cảm biến để tăng FPS camera.

## 7. Phiên QR, xác nhận rơi và gửi event

```text
WAIT_CLEAR -> CLASSIFYING -> CHECK_SESSION -> WAIT_ACK -> WAIT_DROP
                                                        |
                                                SUBMIT + WAIT_DONE
                                                        |
                                                    WAIT_CLEAR
```

1. Khi nhãn ổn định, đọc activeSession, yêu cầu còn hiệu lực và đủ thời gian cho lượt. Snapshot gồm `uid`, `studentCode`, `username`, `startedAt`; không dùng `expiresAt` làm định danh vì có thể gia hạn.
2. Gắn pending ID, sensor/nhãn, snapshot, deadline trước khi gửi ARM. Không đọc được Firebase/không có phiên thì không cấp quyền mở.
3. Chỉ AI_DROP đúng request ID, sensor, ACK, counter chưa xử lý và trong hạn mới được gửi. Sai ngăn, message cũ/trùng, chỉ ACK hoặc chỉ mở nắp không cộng điểm.
4. Timestamp là lúc PC nhận xác nhận cảm biến, không phải lúc dự đoán hoặc uptime ESP32. Chụp ngay khi nhận Serial, trước queue HTTP.
5. Kiểm tra phiên vẫn cùng snapshot và hợp lệ tại lúc rơi; đổi phiên thì bỏ lượt, không chuyển sang học sinh mới. Mở rộng `FirebaseBridge.send_drop` bằng snapshot tùy chọn, giữ caller legacy.
6. Retry giữ nguyên txId, timestamp và học sinh. Dùng queue HTTP giới hạn kích thước; đầy hoặc worker chết phải báo và ngừng nhận lượt mới, không âm thầm mất lượt.
7. DROP hợp lệ đã được xếp gửi không bị DONE đến sau xóa mất. Chỉ arm lượt kế khi firmware DONE và camera clear. Timeout/camera mất/USB mất trước xác nhận thì hủy pending, không cộng điểm.
8. Tái sử dụng cooldown từ settings để không cấp quyền liên tục quá nhanh; backend vẫn quyết định cuối cùng.

Giữ payload hiện tại gồm `txId`, `binId`, `type`, `studentCode`, `username`, `ts`, `source: "esp32"`, `status: "pending"`: nguồn này đúng vì lượt có xác nhận cảm biến ESP32. Không thêm nguồn camera hoặc trường metadata AI vào Rules. Không cần xác nhận rơi bằng hình ảnh hoặc yêu cầu camera phải thấy cửa thùng.

Giữ TTL gửi 30 giây và queue RAM của bridge; mất tiến trình có thể mất lượt chưa gửi. Backend còn kiểm tra phiên tại thời điểm xử lý nên vẫn có thể từ chối sau khi Firebase đã nhận. Log phân biệt gửi thành công và đã cộng điểm. Không nâng mức tin cậy xác thực thiết bị: ID thùng vẫn chỉ là định danh như hiện tại.

## 8. Các file cần triển khai

| File | Thay đổi |
| --- | --- |
| `hardware/camera_ai.py` | Camera/model, preview, state machine và một COM owner |
| `hardware/requirements-camera.txt` | Dependency CPU tối thiểu, dùng lại requirements bridge |
| `hardware/models/README.md`, `.gitignore` | Nguồn/revision/hash và cách tải; bỏ qua model/ảnh cục bộ |
| `hardware/firebase_http_bridge.py` | Snapshot phiên tùy chọn; tái sử dụng sender, retry và heartbeat |
| `hardware/Green-School/Green-School.ino` | Thêm AI gating/giao thức, giữ toàn bộ chức năng khoảng cách/servo/đếm/còi |
| `tests/test_camera_ai.py` | Preprocessing, quyết định, state machine và Serial giả |
| `tests/test_firebase_http_bridge.py` | Snapshot, retry và tương thích caller cũ |
| `README.md`, `hardware/README_HTTP_BRIDGE.md` | Chạy AI/thủ công, cấu hình FPS, mapping, xử lý lỗi và tranh COM |

Giữ `backend/scoring.cjs`, worker và Rules hiện tại; chạy hồi quy để xác nhận không cần sửa hợp đồng. Rà tất cả caller, fixture, config và tài liệu tham chiếu giao thức trước khi sửa code. Không dùng `hardware/ei_bridge.py` làm entry point vì đó là ví dụ Edge Impulse chưa tích hợp firmware.

## 9. Trình tự thực hiện

- [x] Xác minh hash, metadata/nhãn/preprocessing và chạy model trên ảnh tổng hợp; độ chính xác ảnh rác thực tế vẫn cần nghiệm thu.
- [ ] Dry-run camera: 5 FPS, preview, ổn định nhãn, kiểm tra nền/clear và tải CPU.
- [x] Firmware: thêm parser/gating, giữ thông số cảm biến; harness thử ARM/ACK/DROP/DONE/timeout/mất ping và cả chế độ thủ công.
- [x] Tích hợp Python với bridge, snapshot phiên QR, queue và backend hiện tại; test Serial giả.
- [x] Unit tests Python/Node và Firebase emulator; không gửi event thử vào production.
- [ ] Thử thùng thật: khoảng cách cả bốn cảm biến, servo, còi, đếm, đúng/sai ngăn, mất kết nối và đổi phiên.
- [x] Cập nhật README setup từ đầu, thông tin model và cách chọn chế độ thủ công; cấu hình phần cứng đo thực tế còn chờ nghiệm thu.

Lệnh dự kiến, từ project root:

```powershell
py -m pip install -r hardware/requirements-camera.txt
py hardware/camera_ai.py --camera 0 --fps 5 --dry-run

# Hai cửa sổ riêng; không chạy thêm bridge USB cũ.
npm.cmd run backend
py hardware/camera_ai.py --camera 0 --fps 5 --port COM5
```

## 10. Kiểm thử và nghiệm thu

### Hồi quy toàn luồng web Firebase

- Học sinh đăng nhập, QR/config đúng binId, tạo phiên thành công; thùng bận không bị học sinh khác chiếm phiên.
- Camera không cấp quyền khi phiên chưa mở/đã hết hạn hoặc loại rác bị admin tắt; đọc settings và phiên trước ARM. Tài khoản hợp lệ/đang hoạt động được backend kiểm tra lại khi xử lý event. Bridge hiện không có quyền đọc tùy ý users: không giả định đã kiểm tra tài khoản trước mở và không mở rộng Rules hoặc chép service account vào camera để làm việc này.
- Kết thúc phiên/gia hạn/đổi phiên trên web trong khi có lượt phải được xử lý: đồng bộ hoặc polling phiên khi đang chờ; thu hồi quyền nếu phiên mất hiệu lực. Snapshot không được gán lượt sang học sinh khác.
- Xác nhận cảm biến -> event pending -> backend processed -> transaction và điểm xuất hiện đúng ở trang phiên, cá nhân, lớp, bảng xếp hạng tuần; lượt rejected hiển thị đúng lý do và 0 điểm.
- Đổi mức điểm/cooldown/tắt loại rác từ admin được áp dụng từ settings, không hardcode 2/3 điểm hoặc tự cộng trong Python.
- Đóng trang admin không dừng cộng điểm. Dừng backend thì pending chưa thành điểm; dừng bridge/camera thì không có nhận diện/đẩy lượt mới, web cloud vẫn truy cập được.
- Heartbeat hiện chỉ biểu thị bridge còn liên lạc Firebase, không chứng minh AI/camera/servo sẵn sàng. Không hứa trạng thái “AI sẵn sàng” trên web chỉ từ lastSeen; trạng thái chi tiết để preview/log bản đầu.

### Tự động

- Preprocessing RGB/NCHW/normalization; output lỗi không tạo ARM.
- Nhãn khác/không chắc chắn/frame cũ hoặc lặp không tạo lượt; ba frame hợp lệ chỉ tạo một ARM.
- ACK trễ, sai ID/ngăn, AI_DROP trước ACK, counter trùng, reboot, timeout và message legacy không gây event sai/trùng.
- Session đổi/hết hạn, queue đầy, sender lỗi, retry không thay học sinh hoặc ghi đè event đã xử lý.
- Luồng FSM firmware kiểm tra ngưỡng 10/6/8 cm, timeout siêu âm, timer đóng 2 giây, nhả cảm biến và chống đếm liên tục bằng test host hoặc test harness tối thiểu phù hợp toolchain. Nếu không chạy được host test phải ghi rõ và kiểm tra trên thiết bị.

```powershell
py -m unittest discover -s tests -p "test_*.py"
npm.cmd test
# Khi xác minh tích hợp Firebase:
npm.cmd run test:emulators
```

Compile bằng đúng board profile ESP32 thực tế. Test mock không thay kiểm tra khoảng cách, nhiễu siêu âm và cơ khí.

### Phần cứng và camera thật

- Chế độ thủ công: khoảng cách mở nắp, tự đóng, cả hai bộ đếm/hysteresis và còi hoạt động như trước.
- Chế độ AI: không có quyền thì tới gần không mở; đúng quyền + khoảng cách trong ngưỡng mới mở đúng ngăn; ngăn kia không mở. Đưa vật ra xa thì đóng theo timer, kể cả khi PC đã timeout/mất kết nối.
- Giữ vật ≤ 6 cm chỉ đếm một lần; ra > 8 cm mới đếm lại; timeout siêu âm không giả lập rác hoặc cho phép đếm lại.
- Giữ log/bộ đếm/còi khi rác qua cảm biến; chỉ lượt AI đúng ngăn có pending ID/phiên hợp lệ mới được gửi cộng điểm. Chỉ đưa chai trước camera hoặc chỉ mở nắp cho 0 điểm.
- Thử ít nhất 30 lượt chai, 30 lượt lon và 30 lượt âm tính. Mục tiêu ban đầu ≥ 90% lượt hợp lệ mở đúng ngăn, không mở sai hoặc mở cho vật âm tính trong bộ thử. Ghi cả lượt từ chối; chưa đạt thì hiệu chỉnh vị trí/ánh sáng/ngưỡng trước khi chạy tự động.
- Đo FPS, p95 suy luận và độ trễ ACK; mục tiêu khoảng 5 suy luận/giây, ACK trong 1 giây. Không đạt thì ghi FPS thực tế và giảm cấu hình, không bỏ polling cảm biến để bù.
- Thử giữ vật trước camera, sai ngăn, không thả rác, mất camera/USB/mạng, reset ESP32 và đổi phiên. Chạy liên tục 30 phút không backlog video, tăng RAM liên tục hoặc bỏ đọc Serial.

## 11. Giới hạn và phần chưa làm

- WasteWise nhận dạng bề ngoài, không đo chất liệu; một vật mỗi lượt, chưa có detector tách nhiều vật.
- Khoảng cách siêu âm và timer hiện tại không phải hệ thống chống kẹp được chứng nhận. Giữ nguyên chức năng không đồng nghĩa bảo đảm an toàn cơ khí; phải thử nắp/tay/vật cản và lực servo trên thùng thật.
- Chưa có persistent outbox hoặc xác thực phần cứng mới; giữ giới hạn hiện tại và ghi rõ lượt chưa gửi có thể mất khi chương trình dừng.
- Không thêm training pipeline, dashboard camera, lưu video, GPU hoặc cloud AI.
