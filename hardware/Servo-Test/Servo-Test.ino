#include <ESP32Servo.h>

// Disconnect lid linkages before testing; power servos separately with a shared GND.
Servo servo1, servo2;

void testServo(Servo &servo, int number) {
  const int pulses[] = {1200, 1800};
  for (int pulse : pulses) {
    Serial.print("Servo "); Serial.print(number);
    Serial.print(" -> "); Serial.print(pulse); Serial.println(" us");
    servo.writeMicroseconds(pulse);
    delay(2000);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  servo1.setPeriodHertz(50);
  servo2.setPeriodHertz(50);
  servo1.attach(18, 1000, 2000);
  servo2.attach(19, 1000, 2000);
}

void loop() {
  testServo(servo1, 1);
  testServo(servo2, 2);
}
