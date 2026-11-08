// new ver

#include <ESP32Servo.h>

// Set to 0 for count-only USB bridge mode; servos stay detached so lids can be opened by hand.
#ifndef AI_CONTROL_ENABLED
#define AI_CONTROL_ENABLED 1
#endif

#define TRIG_DEM1 22 // Plastic bin HC-SR04
#define ECHO_DEM1 23 // via 1k/2k divider to 3.3 V
#define TRIG_DEM2 13 // Metal bin HC-SR04
#define ECHO_DEM2 14 // via 1k/2k divider to 3.3 V
#define SERVO1_PIN 18 // Plastic bin
#define SERVO2_PIN 19 // Metal bin
#define BUZZER_PIN 27

Servo servo1, servo2;
// Pulses verified with Servo-Test; confirm closed/open direction on the actual lids.
const int XUNG_DONG_US = 1200, XUNG_MO_US = 1800;
const float KHOANG_CACH_TOI_THIEU = 2.0, NGUONG_DEM_RAC = 6.0, NGUONG_NHA_DEM = 8.0;
const unsigned long THOI_GIAN_DONG_NAP = 2000, THOI_GIAN_COI = 200;
const unsigned long AI_TTL = 5000, AI_LINK_TIMEOUT = 3000;
// A falling item crosses the beam in tens of ms, so each sensor is sampled every ~2 gaps.
// Raise the gap if ghost echoes appear on the real bin (HC-SR04 datasheet suggests 60 ms).
const unsigned long KHOANG_CACH_DO_MS = 15;
const unsigned long THOI_GIAN_BAO_KET = 10000, CHU_KY_LOG = 500;
bool ket1 = false, ket2 = false, daBaoKet1 = false, daBaoKet2 = false;
unsigned long ketTu1 = 0, ketTu2 = 0, logLuc = 0;
unsigned long demRac1 = 0, demRac2 = 0;
bool daDemRac1 = false, daDemRac2 = false;
unsigned long giuNap1Luc = 0, giuNap2Luc = 0;
bool nap1Mo = false, nap2Mo = false, coiDangKeu = false;
bool countSensorsClear = false;
bool baoNap1Mo = false, baoNap2Mo = false; // last lid state printed as GS_LID
unsigned long tatCoiLuc = 0;

char aiId[33] = "", lastId[33] = "";
int aiSensor = 0;
bool aiArmed = false, aiOpened = false, aiDropped = false, aiLinked = false;
unsigned long aiStarted = 0, lastPing = 0;
const char *aiReason = "cancel";
char serialLine[96];
size_t serialLength = 0;
bool serialOverflow = false;

float docKhoangCach(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(3);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  unsigned long duration = pulseIn(echo, HIGH, 25000);
  float cm = duration * 0.0343 / 2.0;
  // HC-SR04 cannot measure below ~2 cm; such pulses are noise from a floating/miswired ECHO.
  // Report them as a missing echo: no false drop, lid held, GS_BIN_BLOCKED ... no_echo.
  return cm >= KHOANG_CACH_TOI_THIEU ? cm : -1.0;
}

void baoCoi() {
  if (!coiDangKeu) {
    digitalWrite(BUZZER_PIN, LOW);
    coiDangKeu = true;
    tatCoiLuc = millis() + THOI_GIAN_COI;
  }
}

bool validId(const char *id) {
  if (strlen(id) != 32) return false;
  for (int i = 0; i < 32; i++) {
    if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f'))) return false;
  }
  return true;
}

void aiAck() {
  Serial.print("GS_AI_ACK "); Serial.print(aiId); Serial.print(" "); Serial.println(aiSensor);
}

void handleLine(const char *line) {
  if (!AI_CONTROL_ENABLED) {
    if (strcmp(line, "GS_AI_HELLO 1") == 0) Serial.println("GS_AI_MANUAL 1");
    return;
  }
  if (strcmp(line, "GS_AI_HELLO 1") == 0) {
    // A new controller must not inherit a previous controller's open cycle.
    if (aiId[0]) { aiArmed = false; aiReason = "cancel"; }
    if (!aiId[0] && !nap1Mo && !nap2Mo && countSensorsClear && !daDemRac1 && !daDemRac2) {
      aiLinked = true;
      lastPing = millis();
      Serial.println("GS_AI_READY 1");
    }
    return;
  }
  if (strcmp(line, "GS_AI_PING") == 0) { if (aiLinked) lastPing = millis(); return; }
  if (strncmp(line, "GS_AI_CANCEL ", 13) == 0) {
    if (aiId[0] && strcmp(line + 13, aiId) == 0) { aiArmed = false; aiReason = "cancel"; }
    return;
  }
  // Exact message length prevents accepting trailing tokens or truncated IDs.
  if (strlen(line) != 44 || strncmp(line, "GS_AI_ARM ", 10) != 0 || line[42] != ' '
      || (line[43] != '1' && line[43] != '2')) return;
  char id[33]; memcpy(id, line + 10, 32); id[32] = 0;
  if (!validId(id)) return;
  int sensor = line[43] - '0';
  if (aiId[0]) {
    if (strcmp(id, aiId) == 0 && sensor == aiSensor && aiArmed) aiAck();
    return;
  }
  if (!aiLinked || millis() - lastPing > AI_LINK_TIMEOUT || strcmp(id, lastId) == 0
      || nap1Mo || nap2Mo || !countSensorsClear || daDemRac1 || daDemRac2) return;
  strcpy(aiId, id); strcpy(lastId, id);
  aiSensor = sensor; aiArmed = true; aiOpened = false; aiDropped = false;
  aiStarted = millis(); aiReason = "timeout";
  aiAck();
}

void readCommands() {
  // Bound work per pass so malformed input cannot starve the distance sensors.
  for (int budget = 0; budget < 256 && Serial.available(); budget++) {
    char c = Serial.read();
    if (c == '\n') {
      if (!serialOverflow) { serialLine[serialLength] = 0; handleLine(serialLine); }
      serialLength = 0; serialOverflow = false;
    } else if (c != '\r') {
      if (serialLength < sizeof(serialLine) - 1 && !serialOverflow) serialLine[serialLength++] = c;
      else serialOverflow = true;
    }
  }
}

void updateLid(Servo &servo, bool &opened, unsigned long &lastActive, float countDistance,
               bool allowOpen, unsigned long now) {
  if (allowOpen) {
    if (!opened) servo.writeMicroseconds(XUNG_MO_US);
    opened = true;
    lastActive = now;
  } else if (opened && (countDistance <= NGUONG_NHA_DEM)) {
    // Hold on occupied or missing echo; this sensor cannot monitor the lid path.
    lastActive = now;
  } else if (opened && now - lastActive >= THOI_GIAN_DONG_NAP) {
    servo.writeMicroseconds(XUNG_DONG_US);
    opened = false;
  }
}

void reportLid(int sensor, bool opened, bool &reported) {
  if (opened == reported) return;
  reported = opened;
  Serial.print("GS_LID "); Serial.print(sensor); Serial.print(opened ? " open " : " closed ");
  Serial.println(opened ? XUNG_MO_US : XUNG_DONG_US);
}

void recordDrop(int sensor, float distance, bool &latched, unsigned long &counter) {
  // AI mode counts only into the lid the camera opened. Anything else near a sensor (a hand,
  // a full bin, the other bin) just latches, so it cannot later count as a fresh drop.
  bool counting = !AI_CONTROL_ENABLED || (aiArmed && aiOpened && !aiDropped && sensor == aiSensor);
  if (distance > 0 && distance <= NGUONG_DEM_RAC && !latched) {
    latched = true;
    if (!counting) return;
    counter++;
    Serial.print("GS_DROP "); Serial.print(sensor); Serial.print(" "); Serial.println(counter);
    baoCoi();
    if (AI_CONTROL_ENABLED) {
      aiDropped = true; aiArmed = false; aiReason = "drop";
      Serial.print("GS_AI_DROP "); Serial.print(aiId); Serial.print(" ");
      Serial.print(sensor); Serial.print(" "); Serial.println(counter);
    }
  }
  if (distance > NGUONG_NHA_DEM) latched = false;
}

// A full bin, a stuck item or a lost ECHO holds the lid and blocks new AI cycles; say so once.
void watchBlocked(int sensor, float distance, bool &blocked, unsigned long &since, bool &reported,
                  unsigned long now) {
  if (distance > NGUONG_NHA_DEM) {
    if (reported) { Serial.print("GS_BIN_CLEAR "); Serial.println(sensor); }
    blocked = reported = false;
    return;
  }
  if (!blocked) { blocked = true; since = now; }
  if (!reported && now - since >= THOI_GIAN_BAO_KET) {
    reported = true;
    Serial.print("GS_BIN_BLOCKED "); Serial.print(sensor);
    Serial.println(distance > 0 ? " occupied" : " no_echo");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_DEM1, OUTPUT); pinMode(ECHO_DEM1, INPUT);
  pinMode(TRIG_DEM2, OUTPUT); pinMode(ECHO_DEM2, INPUT);
  digitalWrite(TRIG_DEM1, LOW); digitalWrite(TRIG_DEM2, LOW);
  pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, HIGH);
  if (AI_CONTROL_ENABLED) {
    servo1.setPeriodHertz(50); servo2.setPeriodHertz(50);
    servo1.attach(SERVO1_PIN, 1000, 2000); servo2.attach(SERVO2_PIN, 1000, 2000);
    servo1.writeMicroseconds(XUNG_DONG_US); servo2.writeMicroseconds(XUNG_DONG_US);
  }
  // Build time identifies which copy of this sketch is actually on the board.
  Serial.println("GS_FW " __DATE__ " " __TIME__);
  Serial.println(AI_CONTROL_ENABLED ? "GS_AI_BOOT 1" : "GS_AI_MANUAL 1");
}

void loop() {
  readCommands();
  float kcDem1 = docKhoangCach(TRIG_DEM1, ECHO_DEM1); delay(KHOANG_CACH_DO_MS);
  float kcDem2 = docKhoangCach(TRIG_DEM2, ECHO_DEM2); delay(KHOANG_CACH_DO_MS);
  countSensorsClear = kcDem1 > NGUONG_NHA_DEM && kcDem2 > NGUONG_NHA_DEM;
  readCommands();
  unsigned long now = millis();
  if (AI_CONTROL_ENABLED && aiLinked && now - lastPing > AI_LINK_TIMEOUT) {
    aiLinked = false; aiArmed = false;
    if (!aiDropped) aiReason = "link_lost";
    Serial.println("GS_AI_OFFLINE 1");
  }
  if (aiArmed && now - aiStarted >= AI_TTL) { aiArmed = false; aiReason = "timeout"; }
  updateLid(servo1, nap1Mo, giuNap1Luc, kcDem1,
            AI_CONTROL_ENABLED && aiArmed && aiSensor == 1, now);
  updateLid(servo2, nap2Mo, giuNap2Luc, kcDem2,
            AI_CONTROL_ENABLED && aiArmed && aiSensor == 2, now);
  // Report every lid command so a lid that does not move can be told apart from one never commanded.
  reportLid(1, nap1Mo, baoNap1Mo);
  reportLid(2, nap2Mo, baoNap2Mo);
  recordDrop(1, kcDem1, daDemRac1, demRac1);
  recordDrop(2, kcDem2, daDemRac2, demRac2);
  // Count only a new edge after an earlier sampling cycle opened the lid.
  if (aiArmed && (aiSensor == 1 ? nap1Mo : nap2Mo)) aiOpened = true;
  if (coiDangKeu && (long)(now - tatCoiLuc) >= 0) {
    digitalWrite(BUZZER_PIN, HIGH); coiDangKeu = false;
  }
  if (aiId[0] && !aiArmed && !nap1Mo && !nap2Mo && countSensorsClear) {
    Serial.print("GS_AI_DONE "); Serial.print(aiId); Serial.print(" "); Serial.println(aiReason);
    aiId[0] = 0; aiSensor = 0;
  }
  watchBlocked(1, kcDem1, ket1, ketTu1, daBaoKet1, now);
  watchBlocked(2, kcDem2, ket2, ketTu2, daBaoKet2, now);
  // Throttled so the debug line does not fill the USB buffer at the faster sampling rate.
  if (now - logLuc >= CHU_KY_LOG) {
    logLuc = now;
    Serial.print("Dem rac 1: "); Serial.print(kcDem1); Serial.print(" cm | Dem rac 2: "); Serial.print(kcDem2);
    Serial.print(" cm | Tong so lan dem: "); Serial.println(demRac1 + demRac2);
  }
}
