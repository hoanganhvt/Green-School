#include "ESP32Servo.h"
#include "../../hardware/Sensor-Servo-Test/Sensor-Servo-Test.ino"

int main() {
  setup();
  assert(bin1.servo.pin == 18 && bin2.servo.pin == 19);
  assert(bin1.servo.pulses.back() == 1200);
  for (float bad : {-1.0f, 0.02f, 1.9f, 20.0f}) {
    updateBin(bin1, bad, 1); updateBin(bin1, bad, 1);
    assert(bin1.count == 0);
  }
  updateBin(bin1, 5, 1);
  updateBin(bin1, 20, 1);
  updateBin(bin1, 5, 1);
  assert(!bin1.opened);
  updateBin(bin1, 5, 1);
  assert(bin1.opened && bin1.count == 1 && bin1.servo.pulses.back() == 1800);
  updateBin(bin1, 5, 1);
  assert(bin1.count == 1 && bin2.count == 0);
  delay(3000); updateBin(bin1, -1, 1);
  assert(bin1.opened);
  delay(1999); updateBin(bin1, 20, 1);
  assert(bin1.opened);
  delay(1); updateBin(bin1, 20, 1);
  assert(!bin1.opened && bin1.servo.pulses.back() == 1200);
  updateBin(bin1, 5, 1); updateBin(bin1, 5, 1);
  updateBin(bin2, 5, 2); updateBin(bin2, 5, 2);
  assert(bin1.count == 2 && bin2.count == 1 && bin2.servo.pulses.back() == 1800);
  std::cout << "Sensor-servo checks passed\n";
}
