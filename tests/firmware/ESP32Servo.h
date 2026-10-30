#pragma once
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <sstream>
#include <deque>
#include <cassert>
#include <cstdlib>
#include <iostream>
#undef assert
#define assert(condition) do { if (!(condition)) { std::cerr << "Check failed at line " << __LINE__ << ": " << #condition << "\n"; std::exit(1); } } while (0)
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
inline unsigned long clockMs = 0;
inline std::map<int, unsigned long> echoes;
inline std::map<int, int> pins;
inline unsigned long millis() { return clockMs; }
inline void delay(unsigned long ms) { clockMs += ms; }
inline void delayMicroseconds(unsigned long) {}
inline void pinMode(int, int) {}
inline void digitalWrite(int pin, int value) { pins[pin] = value; }
inline unsigned long pulseIn(int pin, int, unsigned long) { return echoes[pin]; }
class Servo {
public:
  int angle = -1;
  void setPeriodHertz(int) {}
  void attach(int, int, int) {}
  void write(int value) { angle = value; }
};
class FakeSerial {
public:
  std::deque<char> input;
  std::string output;
  void begin(int) {}
  int available() { return (int)input.size(); }
  char read() { char c = input.front(); input.pop_front(); return c; }
  template<class T> void print(T value) { std::ostringstream s; s << value; output += s.str(); }
  template<class T> void println(T value) { print(value); output += '\n'; }
  void feed(const std::string &text) { for (char c : text) input.push_back(c); }
} inline Serial;
