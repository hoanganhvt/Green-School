#include <ESP32Servo.h>

// Test with lid linkages disconnected; separate servo power, shared GND, ECHO level-shifted to 3.3 V.
const int TRIG1 = 22, ECHO1 = 23, TRIG2 = 13, ECHO2 = 14; // Match Green-School.ino
const int CLOSED_US = 1200, OPEN_US = 1800;

struct TestBin {
  Servo servo;
  bool opened = false;
  int nearSamples = 0;
  unsigned long count = 0, lastOccupied = 0;
};
TestBin bin1, bin2;

float distanceCm(int trig, int echo) {
  digitalWrite(trig, LOW); delayMicroseconds(3);
  digitalWrite(trig, HIGH); delayMicroseconds(10);
  digitalWrite(trig, LOW);
  unsigned long pulse = pulseIn(echo, HIGH, 25000);
  return pulse ? pulse * 0.0343 / 2.0 : -1;
}

void updateBin(TestBin &bin, float distance, int number) {
  unsigned long now = millis();
  // HC-SR04 readings below 2 cm are outside its usable range, not valid drops.
  bool near = distance >= 2 && distance <= 6;
  bin.nearSamples = near ? bin.nearSamples + (bin.nearSamples < 2) : 0;
  if (!bin.opened && bin.nearSamples >= 2) {
    bin.count++;
    bin.servo.writeMicroseconds(OPEN_US);
    bin.opened = true;
    bin.lastOccupied = now;
    Serial.print("OPEN bin "); Serial.print(number);
    Serial.print(" | count="); Serial.println(bin.count);
  }
  if (bin.opened) {
    if (!(distance > 8)) bin.lastOccupied = now;
    else if (now - bin.lastOccupied >= 2000) {
      bin.servo.writeMicroseconds(CLOSED_US);
      bin.opened = false;
      Serial.print("CLOSE bin "); Serial.println(number);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG1, OUTPUT); pinMode(ECHO1, INPUT);
  pinMode(TRIG2, OUTPUT); pinMode(ECHO2, INPUT);
  digitalWrite(TRIG1, LOW); digitalWrite(TRIG2, LOW);
  bin1.servo.setPeriodHertz(50); bin2.servo.setPeriodHertz(50);
  bin1.servo.attach(18, 1000, 2000); bin2.servo.attach(19, 1000, 2000);
  bin1.servo.writeMicroseconds(CLOSED_US); bin2.servo.writeMicroseconds(CLOSED_US);
  Serial.println("TEST ONLY: target at 2-6 cm opens servo; >8 cm for 2s closes. No camera/Firebase.");
}

void loop() {
  float d1 = distanceCm(TRIG1, ECHO1); delay(60);
  float d2 = distanceCm(TRIG2, ECHO2); delay(60);
  updateBin(bin1, d1, 1); updateBin(bin2, d2, 2);
  Serial.print("cm1="); Serial.print(d1);
  Serial.print(" | cm2="); Serial.println(d2);
  delay(20);
}
