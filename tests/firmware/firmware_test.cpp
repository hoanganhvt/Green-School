#include "ESP32Servo.h"
#include "../../hardware/Green-School/Green-School.ino"
#include <iostream>

void distance(int echo, float cm) { echoes[echo] = cm <= 0 ? 0 : (unsigned long)(cm / 0.01715 + 0.5); }
void tick(int count = 1) { for (int i = 0; i < count; i++) loop(); }
void command(const std::string &text) { Serial.feed(text + "\n"); readCommands(); }
void reset() {
  clockMs = 0; Serial = FakeSerial();
  demRac1 = demRac2 = 0; daDemRac1 = daDemRac2 = false;
  nap1Mo = nap2Mo = coiDangKeu = false;
  countSensorsClear = false;
  lanPhatHienNap1 = lanPhatHienNap2 = tatCoiLuc = 0;
  aiId[0] = lastId[0] = 0; aiArmed = aiOpened = aiDropped = aiLinked = false;
  aiSensor = 0; serialLength = 0; serialOverflow = false;
  for (int pin : {ECHO_NAP1, ECHO_NAP2, ECHO_DEM1, ECHO_DEM2}) distance(pin, 20);
  setup();
  tick();
}
const std::string id(32, 'a');
int main() {
  reset();
  assert(servo1.angle == 0 && servo2.angle == 0 && pins[BUZZER_PIN] == HIGH);
#if AI_CONTROL_ENABLED
  distance(ECHO_NAP1, 5); tick(); assert(!nap1Mo);
  command("GS_AI_HELLO 1"); assert(aiLinked);
  command("GS_AI_ARM " + id + " 1"); assert(aiArmed);
  auto start = aiStarted;
  clockMs += 100; command("GS_AI_ARM " + id + " 1"); assert(aiStarted == start);
  distance(ECHO_NAP2, 5); tick(); assert(nap1Mo && !nap2Mo);
  distance(ECHO_DEM1, 5); tick();
  assert(demRac1 == 1 && aiDropped && !aiArmed && coiDangKeu);
  assert(Serial.output.find("GS_AI_DROP " + id + " 1 1") != std::string::npos);
  tick(3); assert(demRac1 == 1 && !coiDangKeu);
  distance(ECHO_DEM1, 7); tick(); assert(daDemRac1);
  distance(ECHO_DEM1, 0); tick(); assert(daDemRac1);
  distance(ECHO_DEM1, 9); tick(); assert(!daDemRac1);
  distance(ECHO_NAP1, 20); tick(9); assert(!nap1Mo && aiId[0] == 0);
  assert(Serial.output.find("GS_AI_DONE " + id + " drop") != std::string::npos);
  command("GS_AI_ARM " + id + " 1"); assert(!aiArmed);
  reset(); command("GS_AI_HELLO 1");
  command("GS_AI_ARM " + id + " 1 extra"); assert(!aiArmed);
  Serial.feed(std::string(150, 'x') + "\nGS_AI_ARM " + id + " 2\n"); readCommands(); readCommands();
  assert(aiArmed && aiSensor == 2);
  distance(ECHO_NAP2, 5); tick(); assert(nap2Mo);
  distance(ECHO_DEM1, 5); tick(); assert(demRac1 == 1 && !aiDropped);
  clockMs += 3100; tick(); assert(!aiArmed && !aiLinked && nap2Mo);
  distance(ECHO_NAP2, 0); tick(10); assert(nap2Mo); // missing echo is not a clear path
  distance(ECHO_NAP2, 20); distance(ECHO_DEM1, 20); tick(); assert(!nap2Mo && !aiId[0]);
  reset(); command("GS_AI_HELLO 1"); command("GS_AI_ARM " + id + " 1");
  distance(ECHO_NAP1, 5); distance(ECHO_DEM1, 5); tick();
  assert(nap1Mo && demRac1 == 1 && !aiDropped); // pre-existing count on opening is not a drop
  reset(); command("GS_AI_HELLO 1"); command("GS_AI_ARM " + id + " 1");
  clockMs += 2000; command("GS_AI_PING");
  clockMs += 2000; command("GS_AI_PING");
  clockMs += 1000; tick(); assert(!aiArmed && !aiId[0]);
  assert(Serial.output.find(" timeout") != std::string::npos);
#else
  distance(ECHO_NAP1, 5); distance(ECHO_NAP2, 5); tick(); assert(nap1Mo && nap2Mo);
  distance(ECHO_NAP1, 20); distance(ECHO_NAP2, 20); tick(9); assert(!nap1Mo && !nap2Mo);
  distance(ECHO_DEM1, 5); distance(ECHO_DEM2, 5); tick(); assert(demRac1 == 1 && demRac2 == 1);
  tick(2); assert(demRac1 == 1 && demRac2 == 1);
  command("GS_AI_HELLO 1"); assert(Serial.output.find("GS_AI_MANUAL 1") != std::string::npos);
#endif
  std::cout << "Firmware checks passed (AI=" << AI_CONTROL_ENABLED << ")\n";
}
