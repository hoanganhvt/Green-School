"""Run real ESP32 firmware on a PC; no COM, camera, model or cloud writes.

python hardware/simulate_esp.py --self-test
Requires g++ (C++17). The simulator reuses the firmware test hardware stubs.
"""

import argparse
import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

from camera_ai import TurnController
from firebase_http_bridge import FirebaseBridge

ROOT = Path(__file__).resolve().parents[1]


class FirmwareSimulator:
    def __init__(self):
        compiler = shutil.which('g++')
        if not compiler:
            raise RuntimeError('Install g++ with C++17 support to simulate the ESP32 firmware')
        executable = ROOT / '.cache' / ('esp-simulator.exe' if sys.platform == 'win32' else 'esp-simulator')
        executable.parent.mkdir(exist_ok=True)
        subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-I', str(ROOT / 'tests/firmware'),
                        str(ROOT / 'tests/firmware/esp_simulator.cpp'), '-o', str(executable)],
                       check=True, timeout=60)
        self.process = subprocess.Popen([str(executable)], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, text=True, bufsize=1)
        self.state = None

    def exchange(self, command):
        self.process.stdin.write(command + '\n')
        self.process.stdin.flush()
        messages = []
        for line in self.process.stdout:
            line = line.strip()
            if line.startswith('SIM_STATE '):
                ms, servo1, servo2, count1, count2 = map(int, line.split()[1:])
                self.state = dict(ms=ms, servo1=servo1, servo2=servo2, count1=count1, count2=count2)
                return messages
            messages.append(line)
        raise RuntimeError('Firmware simulator stopped unexpectedly')

    def step(self, first=20, second=20, ticks=1):
        return self.exchange(f'SIM_STEP {first} {second} {ticks}')

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def simulate_drop(firmware, label, session, settings, bin_id='BIN-01'):
    """Synthetic classification -> real controller -> real firmware -> real sender payload."""
    control = TurnController()
    now = time.monotonic()
    wall = int(time.time() * 1000)
    firmware.step()
    for line in firmware.exchange('GS_AI_HELLO 1'):
        control.message(line, now, wall)
    assert control.ready, 'Firmware did not accept the handshake'
    assert firmware.state['servo1'] == firmware.state['servo2'] == 1200

    def observe(present, clear):
        control.observe(label, 0.95, present, clear, session, settings, True, now, wall)

    # A QR session alone, or objects before clearing the camera, cannot open a lid.
    for _ in range(3):
        observe(True, False)
    assert control.turn is None
    observe(False, True)
    for _ in range(3):
        observe(True, False)
    assert control.turn, 'Camera gate refused a valid synthetic classification/session'
    turn = control.turn
    turn.sent = True
    for line in firmware.exchange(f'GS_AI_ARM {turn.id} {turn.sensor}'):
        control.message(line, now, wall)
    assert turn.ack
    expected = (1800, 1200) if turn.sensor == 1 else (1200, 1800)
    assert (firmware.state['servo1'], firmware.state['servo2']) == expected
    result = None
    for line in firmware.step(5 if turn.sensor == 1 else 20, 5 if turn.sensor == 2 else 20):
        result = control.message(line, now + 0.1, wall) or result
    assert result and turn.dropped, 'No confirmed drop'
    assert control.message(f'GS_AI_DROP {turn.id} {turn.sensor} 1', now + 0.2, wall) is None
    before = firmware.state[f'count{turn.sensor}']
    firmware.step(5 if turn.sensor == 1 else 20, 5 if turn.sensor == 2 else 20, 3)
    assert firmware.state[f'count{turn.sensor}'] == before, 'Counted a held object twice'
    for line in firmware.step(ticks=16):
        control.message(line, now + 2.5, wall)
    assert control.turn is None
    assert firmware.state['servo1'] == firmware.state['servo2'] == 1200

    # Exercise the actual HTTP sender without making network requests.
    events = []
    bridge = FirebaseBridge(bin_id)

    def db(method, path, body=None, headers=None):
        if method == 'GET':
            assert path == f'bins/{bin_id}/activeSession'
            return session
        assert method == 'PUT' and path.startswith('events/')
        assert headers == {'if-match': 'null_etag'}
        events.append(body)

    bridge.db = db
    with contextlib.redirect_stdout(io.StringIO()):
        assert bridge.send_drop(result[0], result[1], expected_session=result[2])
    assert len(events) == 1 and events[0]['type'] == label
    return events[0]


def self_test():
    wall = int(time.time() * 1000)
    session = dict(uid='sim-student', studentCode='SIM-001', username='sim_student',
                   startedAt=wall - 1000, expiresAt=wall + 180000)
    settings = {'rules': {'plastic': {'enabled': True}, 'metal': {'enabled': True}}}
    with FirmwareSimulator() as firmware:
        for label in ('plastic', 'metal'):
            event = simulate_drop(firmware, label, session, settings)
            print(f"PASS {label}: ACK -> 1800 us -> DROP -> 1200 us; event {event['type']}")
        # Occupied or missing ECHO cannot grant a new cycle.
        for distance in (5, 0):
            firmware.step(first=distance)
            assert 'GS_AI_READY 1' not in firmware.exchange('GS_AI_HELLO 1')
            assert firmware.state['servo1'] == firmware.state['servo2'] == 1200
        firmware.step()
        control = TurnController()
        for line in firmware.exchange('GS_AI_HELLO 1'):
            control.message(line, time.monotonic(), wall)
        assert control.ready
        for line in firmware.step(ticks=23):
            control.message(line, time.monotonic(), wall)
        assert not control.ready, 'PC still reports READY after the firmware link expired'
        for line in firmware.exchange('GS_AI_HELLO 1'):
            control.message(line, time.monotonic(), wall)
        assert control.ready
        print('PASS link timeout: PC leaves READY and can handshake again')
    print('PASS: no hardware, no camera/model inference, no production writes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--event-json', action='store_true', help='Read a local test fixture from stdin and emit one confirmed event')
    args = parser.parse_args()
    if args.event_json:
        fixture = json.load(sys.stdin)
        with FirmwareSimulator() as firmware:
            print(json.dumps(simulate_drop(firmware, fixture['type'], fixture['session'], fixture['settings'], fixture.get('binId', 'BIN-01'))))
    else:
        self_test()


if __name__ == '__main__':
    main()
