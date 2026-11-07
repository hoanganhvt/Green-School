#include "ESP32Servo.h"
#include "../../hardware/Green-School/Green-School.ino"
#include <iostream>

void distance(int echo, float cm) { echoes[echo] = cm <= 0 ? 0 : (unsigned long)(cm / 0.01715 + 0.5); }
void tick(int count = 1) { for (int i = 0; i < count; i++) loop(); }
void command(const std::string &text) { Serial.feed(text + "\n"); readCommands(); }
void reset() {
  clockMs = 0; Serial = FakeSerial();
  servo1 = Servo(); servo2 = Servo();
  demRac1 = demRac2 = 0; daDemRac1 = daDemRac2 = false;
  nap1Mo = nap2Mo = coiDangKeu = false;
  countSensorsClear = false;
  giuNap1Luc = giuNap2Luc = tatCoiLuc = 0;
  aiId[0] = lastId[0] = 0; aiArmed = aiOpened = aiDropped = aiLinked = false;
  aiSensor = 0; serialLength = 0; serialOverflow = false;
  for (int pin : {ECHO_DEM1, ECHO_DEM2}) distance(pin, 20);
  setup();
  tick();
}
const std::string id(32, 'a');
int main() {
  assert(SERVO1_PIN == 18 && SERVO2_PIN == 19);
  assert(TRIG_DEM1 == 23 && ECHO_DEM1 == 34 && TRIG_DEM2 == 22 && ECHO_DEM2 == 35);
  reset();
  assert(servo1.pin == 18 && servo2.pin == 19);
  assert(servo1.periodHertz == 50 && servo2.periodHertz == 50);
  assert(servo1.minUs == 1000 && servo1.maxUs == 2000);
  assert(servo2.minUs == 1000 && servo2.maxUs == 2000);
  assert(servo1.pulses == std::vector<int>({1200}) && servo2.pulses == std::vector<int>({1200}));
  assert(pins[BUZZER_PIN] == HIGH);
#if AI_CONTROL_ENABLED
  tick(); assert(!nap1Mo && !nap2Mo);
  command("GS_AI_HELLO 1"); assert(aiLinked);
  command("GS_AI_ARM " + id + " 1"); assert(aiArmed);
  auto start = aiStarted;
  clockMs += 100; command("GS_AI_ARM " + id + " 1"); assert(aiStarted == start);
  tick(); assert(nap1Mo && !nap2Mo);
  assert(servo1.pulses == std::vector<int>({1200, 1800}));
  assert(servo2.pulses == std::vector<int>({1200}));
  distance(ECHO_DEM1, 5); tick();
  assert(demRac1 == 1 && aiDropped && !aiArmed && coiDangKeu);
  assert(Serial.output.find("GS_AI_DROP " + id + " 1 1") != std::string::npos);
  tick(3); assert(demRac1 == 1 && !coiDangKeu);
  distance(ECHO_DEM1, 7); tick(); assert(daDemRac1);
  distance(ECHO_DEM1, 0); tick(); assert(daDemRac1);
  distance(ECHO_DEM1, 9); tick(); assert(!daDemRac1);
  tick(16); assert(!nap1Mo && aiId[0] == 0);
  assert(servo1.pulses == std::vector<int>({1200, 1800, 1200}));
  assert(Serial.output.find("GS_AI_DONE " + id + " drop") != std::string::npos);
  command("GS_AI_ARM " + id + " 1"); assert(!aiArmed);
  reset(); command("GS_AI_HELLO 1");
  command("GS_AI_ARM " + id + " 1 extra"); assert(!aiArmed);
  Serial.feed(std::string(150, 'x') + "\nGS_AI_ARM " + id + " 2\n"); readCommands(); readCommands();
  assert(aiArmed && aiSensor == 2);
  tick(); assert(nap2Mo && !nap1Mo);
  assert(servo2.pulses == std::vector<int>({1200, 1800}));
  assert(servo1.pulses == std::vector<int>({1200}));
  distance(ECHO_DEM1, 5); tick(); assert(demRac1 == 1 && !aiDropped);
  distance(ECHO_DEM2, 0);
  clockMs += 3100; tick(); assert(!aiArmed && !aiLinked && nap2Mo);
  assert(Serial.output.find("GS_AI_OFFLINE 1") != std::string::npos);
  distance(ECHO_DEM2, 0); tick(16); assert(nap2Mo); // missing echo holds the lid
  distance(ECHO_DEM2, 20); distance(ECHO_DEM1, 20); tick(16); assert(!nap2Mo && !aiId[0]);
  assert(servo2.pulses == std::vector<int>({1200, 1800, 1200}));
  reset(); command("GS_AI_HELLO 1"); command("GS_AI_ARM " + id + " 1");
  distance(ECHO_DEM1, 5); tick();
  assert(nap1Mo && demRac1 == 1 && !aiDropped); // pre-existing count on opening is not a drop
  reset(); command("GS_AI_HELLO 1"); command("GS_AI_ARM " + id + " 1");
  tick();
  clockMs += 2000; command("GS_AI_PING"); tick();
  clockMs += 2000; command("GS_AI_PING"); tick();
  clockMs += 1000; tick(); assert(!aiArmed && nap1Mo);
  tick(16); assert(!nap1Mo && !aiId[0]);
  assert(Serial.output.find(" timeout") != std::string::npos);
  reset(); command("GS_AI_HELLO 1"); command("GS_AI_ARM " + id + " 1"); tick();
  command("GS_AI_CANCEL " + id); tick(); assert(nap1Mo && !aiArmed);
  tick(16); assert(!nap1Mo && !aiId[0]);
  assert(Serial.output.find(" cancel") != std::string::npos);
  reset(); distance(ECHO_DEM1, 0); tick();
  command("GS_AI_HELLO 1"); assert(!aiLinked);
  reset(); distance(ECHO_DEM1, 5); tick(); command("GS_AI_HELLO 1");
  command("GS_AI_ARM " + id + " 1"); tick(); assert(!aiArmed && !nap1Mo);
#else
  distance(ECHO_DEM1, 5); distance(ECHO_DEM2, 5); tick(); assert(demRac1 == 1 && demRac2 == 1);
  tick(2); assert(demRac1 == 1 && demRac2 == 1 && !nap1Mo && !nap2Mo);
  assert(servo1.pulses == std::vector<int>({1200}) && servo2.pulses == std::vector<int>({1200}));
  command("GS_AI_HELLO 1"); assert(Serial.output.find("GS_AI_MANUAL 1") != std::string::npos);
#endif
  std::cout << "Firmware checks passed (AI=" << AI_CONTROL_ENABLED << ")\n";
}
