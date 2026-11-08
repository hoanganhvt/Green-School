#include "ESP32Servo.h"
#include "../../hardware/Sensor-Test/Sensor-Test.ino"
#include <cmath>

int main() {
  assert(TRIG1 == 22 && ECHO1 == 23 && TRIG2 == 13 && ECHO2 == 14);
  setup();
  assert(pins[TRIG1] == LOW && pins[TRIG2] == LOW);
  Serial.output.clear();
  echoes[ECHO1] = 1166; echoes[ECHO2] = 0;
  loop();
  assert(Serial.output.find("Sensor 1 | TRIG=22 ECHO=23 | pulse=1166 us | distance=") == 0);
  assert(Serial.output.find("Sensor 2 | TRIG=13 ECHO=14 | NO_ECHO:") != std::string::npos);
  auto start = Serial.output.find("distance=") + std::strlen("distance=");
  assert(std::abs(std::stod(Serial.output.substr(start)) - 20.0) < 0.1);
  assert(clockMs == 1310);
  Serial.output.clear();
  echoes[ECHO1] = 0; echoes[ECHO2] = 1166;
  loop();
  assert(Serial.output.find("Sensor 1 | TRIG=22 ECHO=23 | NO_ECHO:") == 0);
  assert(Serial.output.find("Sensor 2 | TRIG=13 ECHO=14 | pulse=1166 us") != std::string::npos);
  assert(pins[TRIG1] == LOW && pins[TRIG2] == LOW);
  std::cout << "Sensor test checks passed\n";
}
