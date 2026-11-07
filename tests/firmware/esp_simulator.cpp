#include "ESP32Servo.h"
#include "../../hardware/Green-School/Green-School.ino"
#include <sstream>

// Runs the actual sketch, with virtual HC-SR04 readings and a virtual clock.
int main() {
  echoes[ECHO_DEM1] = echoes[ECHO_DEM2] = 1166; // 20 cm
  setup();
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.rfind("SIM_STEP ", 0) == 0) {
      std::istringstream input(line.substr(9));
      float first, second;
      int ticks;
      std::string extra;
      if (!(input >> first >> second >> ticks) || (input >> extra)
          || !(first >= 0 && first <= 400 && second >= 0 && second <= 400)
          || ticks < 1 || ticks > 1000) return 2;
      echoes[ECHO_DEM1] = (unsigned long)(first / 0.01715 + 0.5);
      echoes[ECHO_DEM2] = (unsigned long)(second / 0.01715 + 0.5);
      for (int i = 0; i < ticks; i++) loop();
    } else {
      Serial.feed(line + "\n");
      loop();
    }
    std::cout << Serial.output;
    Serial.output.clear();
    std::cout << "SIM_STATE " << millis() << " " << servo1.pulses.back()
              << " " << servo2.pulses.back() << " " << demRac1 << " " << demRac2 << "\n" << std::flush;
  }
}
