#include <ESP32Servo.h>

// Set to 0 and re-upload to use the original distance-only USB bridge.
#ifndef AI_CONTROL_ENABLED
#define AI_CONTROL_ENABLED 1
#endif

#define TRIG_NAP1 5
#define ECHO_NAP1 18
#define TRIG_NAP2 17
#define ECHO_NAP2 16
#define TRIG_DEM1 22
#define ECHO_DEM1 23
#define TRIG_DEM2 13
#define ECHO_DEM2 14
#define SERVO1_PIN 19
#define SERVO2_PIN 21
#define BUZZER_PIN 27

Servo servo1, servo2;
const int GOC_DONG = 0, GOC_MO = 90;
const float NGUONG_MO_NAP = 10.0, NGUONG_DEM_RAC = 6.0, NGUONG_NHA_DEM = 8.0;
const unsigned long THOI_GIAN_DONG_NAP = 2000, THOI_GIAN_COI = 200;
const unsigned long AI_TTL = 5000, AI_LINK_TIMEOUT = 3000;
unsigned long demRac1 = 0, demRac2 = 0;
bool daDemRac1 = false, daDemRac2 = false;
unsigned long lanPhatHienNap1 = 0, lanPhatHienNap2 = 0;
bool nap1Mo = false, nap2Mo = false, coiDangKeu = false;
bool countSensorsClear = false;
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
  return duration ? duration * 0.0343 / 2.0 : -1.0;
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

void updateLid(Servo &servo, bool &opened, unsigned long &lastNear, float distance,
               bool allowOpen, unsigned long now) {
  bool near = distance > 0 && distance <= NGUONG_MO_NAP;
  if (near && (allowOpen || opened)) {
    if (!opened) servo.write(GOC_MO);
    opened = true;
    lastNear = now;
  } else if (opened && distance > NGUONG_MO_NAP && now - lastNear >= THOI_GIAN_DONG_NAP) {
    // An ultrasonic timeout is not proof the lid path is clear.
    servo.write(GOC_DONG);
    opened = false;
  }
}

void recordDrop(int sensor, float distance, bool &latched, unsigned long &counter) {
  if (distance > 0 && distance <= NGUONG_DEM_RAC && !latched) {
    latched = true; counter++;
    Serial.print("GS_DROP "); Serial.print(sensor); Serial.print(" "); Serial.println(counter);
    baoCoi();
    if (AI_CONTROL_ENABLED && aiArmed && aiOpened && !aiDropped && sensor == aiSensor) {
      aiDropped = true; aiArmed = false; aiReason = "drop";
      Serial.print("GS_AI_DROP "); Serial.print(aiId); Serial.print(" ");
      Serial.print(sensor); Serial.print(" "); Serial.println(counter);
    }
  }
  if (distance > NGUONG_NHA_DEM) latched = false;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_NAP1, OUTPUT); pinMode(ECHO_NAP1, INPUT);
  pinMode(TRIG_NAP2, OUTPUT); pinMode(ECHO_NAP2, INPUT);
  pinMode(TRIG_DEM1, OUTPUT); pinMode(ECHO_DEM1, INPUT);
  pinMode(TRIG_DEM2, OUTPUT); pinMode(ECHO_DEM2, INPUT);
  pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, HIGH);
  servo1.setPeriodHertz(50); servo2.setPeriodHertz(50);
  servo1.attach(SERVO1_PIN, 500, 2400); servo2.attach(SERVO2_PIN, 500, 2400);
  servo1.write(GOC_DONG); servo2.write(GOC_DONG);
  Serial.println(AI_CONTROL_ENABLED ? "GS_AI_BOOT 1" : "GS_AI_MANUAL 1");
}

void loop() {
  readCommands();
  float kcNap1 = docKhoangCach(TRIG_NAP1, ECHO_NAP1); delay(60);
  float kcNap2 = docKhoangCach(TRIG_NAP2, ECHO_NAP2); delay(60);
  float kcDem1 = docKhoangCach(TRIG_DEM1, ECHO_DEM1); delay(60);
  float kcDem2 = docKhoangCach(TRIG_DEM2, ECHO_DEM2); delay(60);
  countSensorsClear = kcDem1 > NGUONG_NHA_DEM && kcDem2 > NGUONG_NHA_DEM;
  readCommands();
  unsigned long now = millis();
  if (AI_CONTROL_ENABLED && aiLinked && now - lastPing > AI_LINK_TIMEOUT) {
    aiLinked = false; aiArmed = false;
    if (!aiDropped) aiReason = "link_lost";
  }
  if (aiArmed && now - aiStarted >= AI_TTL) { aiArmed = false; aiReason = "timeout"; }
  updateLid(servo1, nap1Mo, lanPhatHienNap1, kcNap1,
            !AI_CONTROL_ENABLED || (aiArmed && aiSensor == 1), now);
  updateLid(servo2, nap2Mo, lanPhatHienNap2, kcNap2,
            !AI_CONTROL_ENABLED || (aiArmed && aiSensor == 2), now);
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
  Serial.print("Nap 1: "); Serial.print(kcNap1); Serial.print(" cm | Nap 2: "); Serial.print(kcNap2);
  Serial.print(" cm | Dem rac 1: "); Serial.print(kcDem1); Serial.print(" cm | Dem rac 2: "); Serial.print(kcDem2);
  Serial.print(" cm | Tong so lan dem: "); Serial.println(demRac1 + demRac2);
  delay(20);
}
