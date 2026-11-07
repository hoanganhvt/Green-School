// HC-SR04: share GND with ESP32; level-shift 5 V ECHO to 3.3 V.
const int TRIG1 = 23, ECHO1 = 34;
const int TRIG2 = 22, ECHO2 = 35;

void testSensor(int number, int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(3);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  unsigned long duration = pulseIn(echo, HIGH, 25000);

  Serial.print("Sensor "); Serial.print(number);
  Serial.print(" | TRIG="); Serial.print(trig);
  Serial.print(" ECHO="); Serial.print(echo);
  if (duration == 0) {
    Serial.println(" | NO_ECHO: no complete pulse within 25 ms");
  } else {
    Serial.print(" | pulse="); Serial.print(duration); Serial.print(" us");
    Serial.print(" | distance="); Serial.print(duration * 0.0343 / 2.0);
    Serial.println(" cm");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG1, OUTPUT); pinMode(ECHO1, INPUT);
  pinMode(TRIG2, OUTPUT); pinMode(ECHO2, INPUT);
  digitalWrite(TRIG1, LOW); digitalWrite(TRIG2, LOW);
  delay(1000);
  Serial.println("Place a flat target about 20 cm in front of each sensor.");
}

void loop() {
  testSensor(1, TRIG1, ECHO1);
  delay(60); // Separate triggers to reduce interference between sensors.
  testSensor(2, TRIG2, ECHO2);
  delay(250);
}
