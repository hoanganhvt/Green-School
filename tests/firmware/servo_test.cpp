#include "ESP32Servo.h"
#include "../../hardware/Servo-Test/Servo-Test.ino"

int main() {
  setup();
  assert(Serial.output.empty());
  loop();
  const std::string expected =
      "Servo 1 -> 1200 us\nServo 1 -> 1800 us\n"
      "Servo 2 -> 1200 us\nServo 2 -> 1800 us\n";
  assert(Serial.output == expected);
  const std::vector<int> pulses = {1200, 1800};
  assert(servo1.pulses == pulses && servo2.pulses == pulses);
  assert(clockMs == 9000);
  loop();
  assert(Serial.output == expected + expected);
  assert(servo1.pulses.size() == 4 && servo2.pulses.size() == 4);
  assert(clockMs == 17000);
  std::cout << "Servo test sequence passed\n";
}
