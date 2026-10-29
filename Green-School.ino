
#include <ESP32Servo.h>

// ==================================================
// 1. HAI CAM BIEN CU: DIEU KHIEN MO NAP
// ==================================================
#define TRIG_NAP1 5
#define ECHO_NAP1 18

#define TRIG_NAP2 17
#define ECHO_NAP2 16

// ==================================================
// 2. HAI CAM BIEN MOI: PHAT HIEN VA DEM RAC
// ==================================================
#define TRIG_DEM1 22
#define ECHO_DEM1 23

#define TRIG_DEM2 13
#define ECHO_DEM2 14

// ==================================================
// 3. SERVO VA COI
// ==================================================
#define SERVO1_PIN 19
#define SERVO2_PIN 21
#define BUZZER_PIN 27

Servo servo1;
Servo servo2;

// Goc servo
const int GOC_DONG = 0;
const int GOC_MO = 90;

// ==================================================
// 4. CAC NGUONG KHOANG CACH (cm)
// ==================================================
const float NGUONG_MO_NAP = 10.0;
const float NGUONG_DEM_RAC = 6.0;
const float NGUONG_NHA_DEM = 8.0;

// ==================================================
// 5. THOI GIAN (ms)
// ==================================================
const unsigned long THOI_GIAN_DONG_NAP = 2000;
const unsigned long THOI_GIAN_COI = 200;

// ==================================================
// 6. BIEN DEM RAC VA TRANG THAI
// ==================================================
unsigned long demRac1 = 0;
unsigned long demRac2 = 0;

bool daDemRac1 = false;
bool daDemRac2 = false;

unsigned long lanPhatHienNap1 = 0;
unsigned long lanPhatHienNap2 = 0;

unsigned long tatCoiLuc = 0;
bool coiDangKeu = false;

// ==================================================
// 7. HAM DOC KHOANG CACH CAM BIEN SIÊU AM
// ==================================================
float docKhoangCach(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(3);

  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);

  unsigned long thoiGian = pulseIn(echo, HIGH, 25000);

  if (thoiGian == 0) {
    return -1.0;
  }

  float khoangCach = thoiGian * 0.0343 / 2.0;
  return khoangCach;
}

// ==================================================
// 8. HAM BAT COI
// Module coi gia dinh kich LOW
// ==================================================
void baoCoi() {
  if (!coiDangKeu) {
    digitalWrite(BUZZER_PIN, LOW);
    coiDangKeu = true;
    tatCoiLuc = millis() + THOI_GIAN_COI;
  }
}

// ==================================================
// 9. SETUP
// ==================================================
void setup() {
  Serial.begin(115200);

  // Cam bien mo nap 1
  pinMode(TRIG_NAP1, OUTPUT);
  pinMode(ECHO_NAP1, INPUT);

  // Cam bien mo nap 2
  pinMode(TRIG_NAP2, OUTPUT);
  pinMode(ECHO_NAP2, INPUT);

  // Cam bien dem rac 1
  pinMode(TRIG_DEM1, OUTPUT);
  pinMode(ECHO_DEM1, INPUT);

  // Cam bien dem rac 2
  pinMode(TRIG_DEM2, OUTPUT);
  pinMode(ECHO_DEM2, INPUT);

  // Khoi tao coi o trang thai tat
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH);

  // Khoi tao servo
  servo1.setPeriodHertz(50);
  servo2.setPeriodHertz(50);

  servo1.attach(SERVO1_PIN, 500, 2400);
  servo2.attach(SERVO2_PIN, 500, 2400);

  // Dong hai nap khi khoi dong
  servo1.write(GOC_DONG);
  servo2.write(GOC_DONG);

  Serial.println("================================");
  Serial.println("THUNG RAC ESP32 SAN SANG");
  Serial.println("Cam bien cu: MO NAP");
  Serial.println("Cam bien moi: DEM RAC");
  Serial.println("================================");
}

// ==================================================
// 10. LOOP
// ==================================================
void loop() {
  // -----------------------------------------------
  // DOC 4 CAM BIEN LAN LUOT
  // -----------------------------------------------
  float kcNap1 = docKhoangCach(TRIG_NAP1, ECHO_NAP1);
  delay(60);

  float kcNap2 = docKhoangCach(TRIG_NAP2, ECHO_NAP2);
  delay(60);

  float kcDem1 = docKhoangCach(TRIG_DEM1, ECHO_DEM1);
  delay(60);

  float kcDem2 = docKhoangCach(TRIG_DEM2, ECHO_DEM2);
  delay(60);

  unsigned long hienTai = millis();

  // ===============================================
  // A. CAM BIEN CU 1: MO NAP 1
  // ===============================================
  if (kcNap1 > 0 && kcNap1 <= NGUONG_MO_NAP) {
    servo1.write(GOC_MO);
    lanPhatHienNap1 = hienTai;
  } else {
    if (hienTai - lanPhatHienNap1 >= THOI_GIAN_DONG_NAP) {
      servo1.write(GOC_DONG);
    }
  }

  // ===============================================
  // B. CAM BIEN CU 2: MO NAP 2
  // ===============================================
  if (kcNap2 > 0 && kcNap2 <= NGUONG_MO_NAP) {
    servo2.write(GOC_MO);
    lanPhatHienNap2 = hienTai;
  } else {
    if (hienTai - lanPhatHienNap2 >= THOI_GIAN_DONG_NAP) {
      servo2.write(GOC_DONG);
    }
  }

  // ===============================================
  // C. CAM BIEN MOI 1: PHAT HIEN RAC O 6 CM
  // ===============================================
  bool coRac1 =
      (kcDem1 > 0 && kcDem1 <= NGUONG_DEM_RAC);

  if (coRac1 && !daDemRac1) {
    demRac1++;
    daDemRac1 = true;

    Serial.print("RAC QUA CAM BIEN MOI 1 - So lan: ");
    Serial.println(demRac1);
    // Machine-readable USB message; sensor-to-material mapping lives in the bridge.
    Serial.print("GS_DROP 1 ");
    Serial.println(demRac1);

    baoCoi();
  }

  // Chi cho dem lai khi vat ra xa hon 8 cm
  if (kcDem1 > NGUONG_NHA_DEM) {
    daDemRac1 = false;
  }

  // ===============================================
  // D. CAM BIEN MOI 2: PHAT HIEN RAC O 6 CM
  // ===============================================
  bool coRac2 =
      (kcDem2 > 0 && kcDem2 <= NGUONG_DEM_RAC);

  if (coRac2 && !daDemRac2) {
    demRac2++;
    daDemRac2 = true;

    Serial.print("RAC QUA CAM BIEN MOI 2 - So lan: ");
    Serial.println(demRac2);
    Serial.print("GS_DROP 2 ");
    Serial.println(demRac2);

    baoCoi();
  }

  // Chi cho dem lai khi vat ra xa hon 8 cm
  if (kcDem2 > NGUONG_NHA_DEM) {
    daDemRac2 = false;
  }

  // ===============================================
  // E. TU DONG TAT COI SAU 200 ms
  // ===============================================
  if (coiDangKeu &&
      (long)(millis() - tatCoiLuc) >= 0) {
    digitalWrite(BUZZER_PIN, HIGH);
    coiDangKeu = false;
  }

  // ===============================================
  // F. IN KHOANG CACH VA TONG SO LAN DEM
  // ===============================================
  Serial.print("Nap 1: ");
  Serial.print(kcNap1);
  Serial.print(" cm | Nap 2: ");
  Serial.print(kcNap2);

  Serial.print(" cm | Dem rac 1: ");
  Serial.print(kcDem1);

  Serial.print(" cm | Dem rac 2: ");
  Serial.print(kcDem2);

  //dumb ass nigga
  Serial.print(" cm | Tong so lan dem: ");
  Serial.println(demRac1 + demRac2);

  delay(20);
}
