/* =========================================================================
   GREEN SCHOOL — CODE MẪU CHO ESP32 / ESP32-CAM (Arduino IDE)
   -------------------------------------------------------------------------
   Vai trò của ESP32 trong hệ thống:
   1. Nhận nhãn rác ("plastic" / "metal") từ máy tính chạy mô hình Edge Impulse
      qua cổng Serial (USB). Xem hardware/ei_bridge.py.
   2. Mở nắp bằng servo, bật LED theo loại rác.
   3. Chờ cảm biến hồng ngoại (IR) xác nhận rác đã rơi vào thùng.
   4. Đọc học sinh đang dùng thùng tại  /bins/<BIN_ID>/activeSession
      rồi gửi sự kiện lên Firebase tại  /events/<txId>  (status = "pending").
      Website tự cộng điểm theo quy tắc trong trang Cài đặt.
   5. Mỗi 30 giây gửi tín hiệu "còn hoạt động" tại /bins/<BIN_ID>/lastSeen.

   Thư viện cần cài (Library Manager): ArduinoJson (v7), ESP32Servo.
   Đây là code THAM KHẢO — các bạn chỉnh chân GPIO cho đúng mạch của mình.
   ========================================================================= */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---------- Cấu hình ----------
const char* WIFI_SSID     = "TEN_WIFI";
const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
// Lấy trong Firebase Console → Realtime Database (KHÔNG có dấu / ở cuối)
const char* DATABASE_URL  = "https://ten-du-an-default-rtdb.asia-southeast1.firebasedatabase.app";
// Trùng với Mã thùng tạo trong Trang quản trị → Thùng rác & QR
const char* BIN_ID        = "BIN-01";

// ---------- Chân kết nối (đổi theo mạch thật) ----------
const int PIN_SERVO      = 13;
const int PIN_IR_SENSOR  = 14;   // cảm biến hồng ngoại, LOW khi có vật đi qua
const int PIN_LED_PLASTIC = 25;  // LED xanh dương: nhựa
const int PIN_LED_METAL   = 26;  // LED vàng: kim loại
const int PIN_LED_ERROR   = 27;  // LED đỏ: lỗi / không có phiên

const int SERVO_CLOSED = 0;
const int SERVO_OPEN   = 90;
const unsigned long DROP_TIMEOUT_MS = 6000;   // thời gian chờ rác rơi vào thùng
const unsigned long HEARTBEAT_MS    = 30000;

Servo lid;
unsigned long lastBeat = 0;
unsigned long txCounter = 0;

// ---------- Tiện ích HTTP tới Firebase REST ----------
String fbUrl(const String& path) { return String(DATABASE_URL) + "/" + path + ".json"; }

int fbRequest(const char* method, const String& path, const String& body, String* out = nullptr) {
  WiFiClientSecure client;
  client.setInsecure();               // đơn giản cho dự án học sinh; có thể thay bằng chứng chỉ gốc
  HTTPClient http;
  http.begin(client, fbUrl(path));
  http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest(method, body);
  if (out) *out = http.getString();
  http.end();
  return code;
}

void setLeds(bool plastic, bool metal, bool err) {
  digitalWrite(PIN_LED_PLASTIC, plastic);
  digitalWrite(PIN_LED_METAL, metal);
  digitalWrite(PIN_LED_ERROR, err);
}

void blinkError() {
  for (int i = 0; i < 3; i++) { setLeds(false, false, true); delay(150); setLeds(false, false, false); delay(150); }
}

void heartbeat() {
  String body = String("{\"lastSeen\":{\".sv\":\"timestamp\"},\"ip\":\"") + WiFi.localIP().toString() + "\"}";
  int code = fbRequest("PATCH", String("bins/") + BIN_ID, body);
  Serial.printf("[heartbeat] %d\n", code);
}

/* Đọc phiên đăng nhập hiện tại trên thùng (học sinh vừa quét QR) */
bool readSession(String& studentCode, String& username) {
  String res;
  int code = fbRequest("GET", String("bins/") + BIN_ID + "/activeSession", "", &res);
  if (code != 200 || res == "null") return false;
  JsonDocument doc;
  if (deserializeJson(doc, res)) return false;
  studentCode = doc["studentCode"] | "";
  username    = doc["username"] | "";
  return studentCode.length() > 0;
}

/* Gửi 1 lượt bỏ rác lên /events/<txId> */
bool sendEvent(const String& type, const String& studentCode, const String& username) {
  String txId = String("TX") + String(BIN_ID) + "-" + String(millis(), 36) + "-" + String(++txCounter) + String(esp_random() % 1000);
  txId.replace("-", "");             // khoá Firebase không được chứa . # $ [ ] /
  JsonDocument doc;
  doc["txId"] = txId;
  doc["binId"] = BIN_ID;
  doc["type"] = type;                // phải trùng nhãn trong Cài đặt → Quy tắc tính điểm
  doc["studentCode"] = studentCode;
  doc["username"] = username;
  doc["ts"][".sv"] = "timestamp";    // để máy chủ Firebase gắn thời gian
  doc["status"] = "pending";
  doc["source"] = "esp32";
  String body; serializeJson(doc, body);
  int code = fbRequest("PUT", String("events/") + txId, body);
  Serial.printf("[event] %s %s -> %d\n", txId.c_str(), type.c_str(), code);
  return code == 200;
}

/* Quy trình khi máy tính báo đã nhận diện được 1 loại rác */
void handleTrash(const String& type) {
  String studentCode, username;
  if (!readSession(studentCode, username)) {
    Serial.println("[warn] Chưa có học sinh quét QR trên thùng này");
    blinkError();
    return;                          // vẫn có thể mở nắp nếu muốn, nhưng không tính điểm
  }
  setLeds(type == "plastic", type == "metal", false);
  lid.write(SERVO_OPEN);

  unsigned long t0 = millis();
  bool dropped = false;
  while (millis() - t0 < DROP_TIMEOUT_MS) {
    if (digitalRead(PIN_IR_SENSOR) == LOW) { dropped = true; break; }
    delay(10);
  }
  delay(400);
  lid.write(SERVO_CLOSED);

  if (dropped) {
    if (!sendEvent(type, studentCode, username)) blinkError();
  } else {
    Serial.println("[info] Hết thời gian, không thấy rác rơi vào thùng");
  }
  setLeds(false, false, false);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_IR_SENSOR, INPUT_PULLUP);
  pinMode(PIN_LED_PLASTIC, OUTPUT);
  pinMode(PIN_LED_METAL, OUTPUT);
  pinMode(PIN_LED_ERROR, OUTPUT);
  lid.attach(PIN_SERVO);
  lid.write(SERVO_CLOSED);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Đang kết nối Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf("\nĐã kết nối, IP %s\n", WiFi.localIP().toString().c_str());
  heartbeat();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); delay(1000); return; }
  if (millis() - lastBeat > HEARTBEAT_MS) { lastBeat = millis(); heartbeat(); }

  // Máy tính gửi 1 dòng: "plastic" hoặc "metal"
  if (Serial.available()) {
    String label = Serial.readStringUntil('\n');
    label.trim(); label.toLowerCase();
    if (label == "plastic" || label == "metal") handleTrash(label);
  }
}
