"""Local camera classifier + single-owner ESP32 USB bridge. See README.md.

Start with --check-model, then --dry-run. In preview, remove all objects and
press C to calibrate the empty center square. Q/Esc stops the application.
"""

import argparse
import ast
from dataclasses import dataclass
import math
from pathlib import Path
import queue
import re
import threading
import time
import uuid

from download_camera_model import MODEL_PATH, verify_model
from firebase_http_bridge import (DEFAULT_CONFIG, FirebaseBridge, error_message,
                                  load_bin_id, same_session, valid_session)

LABELS = ('battery', 'biological', 'cardboard', 'glass', 'metal', 'paper', 'plastic', 'trash')
FRAME_MAX_AGE = 1.0
SESSION_MAX_AGE = 2.5
TURN_SECONDS = 5.0
ID = r'[a-f0-9]{32}'


def preprocess(frame):
    import cv2
    import numpy as np
    h, w = frame.shape[:2]
    side = min(h, w)
    crop = frame[(h - side) // 2:(h + side) // 2, (w - side) // 2:(w + side) // 2]
    rgb = cv2.cvtColor(cv2.resize(crop, (224, 224)), cv2.COLOR_BGR2RGB)
    return np.ascontiguousarray(rgb.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0


class WasteWise:
    def __init__(self, path):
        import onnxruntime as ort
        verify_model(path)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        self.session = ort.InferenceSession(str(path), sess_options=options,
                                           providers=['CPUExecutionProvider'])
        inputs, outputs = self.session.get_inputs(), self.session.get_outputs()
        if (len(inputs) != 1 or inputs[0].shape != [1, 3, 224, 224]
                or inputs[0].type != 'tensor(float)' or len(outputs) != 1
                or outputs[0].shape != [1, 8]):
            raise ValueError('Unsupported model input/output')
        meta = self.session.get_modelmeta().custom_metadata_map
        names = ast.literal_eval(meta.get('names', '{}'))
        if meta.get('task') != 'classify' or names != dict(enumerate(LABELS)):
            raise ValueError('Model labels/task do not match WasteWise')
        self.input_name = inputs[0].name
        print('MODEL OK: 8 classes, CPU, 224x224. License metadata:', meta.get('license'))

    def predict(self, frame):
        import numpy as np
        scores = self.session.run(None, {self.input_name: preprocess(frame)})[0]
        if (scores.shape != (1, 8) or not np.isfinite(scores).all()
                or np.min(scores) < 0 or np.max(scores) > 1
                or not np.isclose(scores.sum(), 1, atol=0.001)):
            raise ValueError('Invalid probability output; refusing hardware control')
        index = int(scores[0].argmax())
        return LABELS[index], float(scores[0, index])


class ClearGate:
    """Fixed-camera background check; never use model confidence as absence."""
    def __init__(self):
        self.background = None
        self.clear_since = None

    @staticmethod
    def small(frame):
        import cv2
        return cv2.cvtColor(preprocess(frame)[0].transpose(1, 2, 0), cv2.COLOR_RGB2GRAY)[::4, ::4]

    def calibrate(self, frame):
        self.background = self.small(frame)
        self.clear_since = None

    def observe(self, frame, now):
        import numpy as np
        if self.background is None:
            return False, False
        # shortcut: fixed background/lighting; recalibrate empty ROI when setup changes.
        changed = float(np.mean(np.abs(self.small(frame) - self.background) > 0.10))
        clear = changed < 0.02
        self.clear_since = (now if self.clear_since is None else self.clear_since) if clear else None
        return clear and now - self.clear_since >= 1.0, changed > 0.05


@dataclass
class Turn:
    id: str
    sensor: int
    session: dict
    deadline: float
    sent: bool = False
    ack: bool = False
    dropped: bool = False
    cancelled: bool = False
    cancel_sent: bool = False


class TurnController:
    """Pure decision state. Runtime serializes access with its lock."""
    def __init__(self, sensor1='plastic', sensor2='metal', threshold=0.85, stable=3):
        if {sensor1, sensor2} != {'plastic', 'metal'}:
            raise ValueError('Sensor mapping must contain plastic and metal exactly once')
        self.mapping = {sensor1: 1, sensor2: 2}
        self.threshold, self.stable = threshold, stable
        self.ready = False
        self.turn = None
        self.cleared = False
        self.label = None
        self.count = 0
        self.counters = {1: 0, 2: 0}
        self.last_drop_ms = 0
        self.last_student = None

    def reset_frames(self):
        self.label, self.count = None, 0

    def observe(self, label, score, present, clear, session, settings, fresh, now, wall_ms):
        if self.turn is not None or not self.ready:
            self.reset_frames()
            return
        if clear:
            self.cleared = True
        rules = settings.get('rules', {}) if isinstance(settings, dict) else {}
        rule = rules.get(label)
        try:
            cooldown = max(0, float(settings.get('cooldownSeconds', 3))) * 1000
        except (ValueError, TypeError):
            cooldown = 3000
        if (not fresh or not self.cleared or not present or label not in self.mapping
                or not math.isfinite(score) or score < self.threshold
                or not isinstance(rule, dict) or rule.get('enabled') is False
                or not valid_session(session, wall_ms + 6000, wall_ms)
                or not session.get('uid')
                or (session.get('studentCode') == self.last_student
                    and wall_ms - self.last_drop_ms < cooldown)):
            self.reset_frames()
            return
        self.count = self.count + 1 if self.label == label else 1
        self.label = label
        if self.count >= self.stable:
            self.turn = Turn(uuid.uuid4().hex, self.mapping[label], dict(session), now + TURN_SECONDS)
            self.cleared = False
            self.reset_frames()

    def cancel(self):
        if self.turn:
            self.turn.cancelled = True
        self.cleared = False
        self.reset_frames()

    def message(self, line, now, wall_ms):
        if line == 'GS_AI_MANUAL 1':
            raise RuntimeError('Firmware is in manual mode; upload AI_CONTROL_ENABLED=1')
        if line == 'GS_AI_BOOT 1':
            self.ready = False
            self.turn = None
            self.counters = {1: 0, 2: 0}
            self.cancel()
            return None
        if line == 'GS_AI_READY 1':
            if self.turn is None:
                self.ready = True
                self.cleared = False
            return None
        turn = self.turn
        if not turn:
            return None
        if line == f'GS_AI_ACK {turn.id} {turn.sensor}':
            if turn.sent and not turn.cancelled and now < turn.deadline:
                turn.ack = True
            return None
        drop = re.fullmatch(rf'GS_AI_DROP ({ID}) ([12]) ([0-9]{{1,10}})', line)
        if drop and drop[1] == turn.id and int(drop[2]) == turn.sensor:
            count = int(drop[3])
            if (turn.sent and turn.ack and not turn.cancelled and not turn.dropped
                    and now < turn.deadline and self.counters[turn.sensor] < count <= 0xFFFFFFFF):
                turn.dropped = True
                self.counters[turn.sensor] = count
                self.last_drop_ms = wall_ms
                self.last_student = turn.session['studentCode']
                return turn.sensor, wall_ms, dict(turn.session)
        done = re.fullmatch(rf'GS_AI_DONE ({ID}) (drop|timeout|cancel|link_lost)', line)
        if done and done[1] == turn.id:
            self.turn = None
            self.cleared = False
            self.reset_frames()
        return None


class CameraFrames:
    def __init__(self, camera, stop):
        import cv2
        self.camera = cv2.VideoCapture(camera)
        if not self.camera.isOpened():
            self.camera.release()
            raise RuntimeError('Cannot open camera; check index, permissions and other apps')
        self.stop = stop
        self.lock = threading.Lock()
        self.latest = None
        self.sequence = 0
        self.thread = threading.Thread(target=self.capture, daemon=True)
        self.thread.start()

    def capture(self):
        while not self.stop.is_set():
            ok, frame = self.camera.read()
            if not ok:
                return
            with self.lock:
                self.sequence += 1
                self.latest = (self.sequence, time.monotonic(), frame)

    def get(self):
        with self.lock:
            return self.latest

    def close(self):
        self.stop.set()
        self.thread.join(timeout=1)
        self.camera.release()


class CameraBridge:
    def __init__(self, args, stop):
        self.stop = stop
        self.lock = threading.Lock()
        self.controller = TurnController(args.sensor1, args.sensor2, args.threshold, args.stable_frames)
        self.bridge = FirebaseBridge(load_bin_id(args.config), args.sensor1, args.sensor2)
        self.bridge.check_bin()
        self.session, self.settings, self.checked = None, {}, 0
        self.frame_at = 0
        self.drops = queue.Queue(maxsize=100)
        self.error = None
        self.threads = []
        import serial
        self.esp = serial.Serial(args.port, 115200, timeout=0.05, write_timeout=1)
        try:
            for job in (self.monitor, self.sender, self.serial_loop):
                worker = threading.Thread(target=self.run_worker, args=(job,), daemon=True)
                self.threads.append(worker)
                worker.start()
        except BaseException:
            self.close()
            raise

    def run_worker(self, job):
        try:
            job()
        except Exception as error:
            self.error = error_message(error)
            print('WORKER STOPPED:', self.error, flush=True)
            self.stop.set()

    def monitor(self):
        next_heartbeat = 0
        while not self.stop.is_set():
            try:
                session = self.bridge.db('GET', f'bins/{self.bridge.bin_id}/activeSession')
                settings = self.bridge.db('GET', 'settings')
                with self.lock:
                    self.session, self.settings = session, settings if isinstance(settings, dict) else {}
                    self.checked = time.monotonic()
                if time.monotonic() >= next_heartbeat:
                    self.bridge.heartbeat()
                    next_heartbeat = time.monotonic() + 30
            except (OSError, ValueError) as error:
                with self.lock:
                    self.checked = 0
                print('MONITOR:', error_message(error), flush=True)
            self.stop.wait(0.5)

    def sender(self):
        while not self.stop.is_set():
            try:
                sensor, captured, session = self.drops.get(timeout=0.2)
            except queue.Empty:
                continue
            self.bridge.send_drop(sensor, captured, self.stop, expected_session=session)

    def serial_loop(self):
        buffer = bytearray()
        overflow = False
        last_hello = last_ping = 0
        handshake_started = time.monotonic()
        while not self.stop.is_set():
            now, wall_ms = time.monotonic(), int(time.time() * 1000)
            with self.lock:
                control = self.controller
                if not control.ready and now - handshake_started > 15:
                    raise RuntimeError('No AI_READY after 15s; check firmware, clear sensors and COM')
                if not control.ready and now - last_hello >= 1:
                    self.esp.write(b'GS_AI_HELLO 1\n')
                    last_hello = now
                if control.ready and now - last_ping >= 1:
                    self.esp.write(b'GS_AI_PING\n')
                    last_ping = now
                turn = control.turn
                if turn:
                    rule = self.settings.get('rules', {}).get(self.bridge.types[turn.sensor], {})
                    invalid = (now - self.frame_at > FRAME_MAX_AGE
                               or now - self.checked > SESSION_MAX_AGE
                               or not same_session(self.session, turn.session)
                               or not valid_session(self.session, wall_ms)
                               or not rule or rule.get('enabled') is False)
                    if not turn.dropped and (invalid or now >= turn.deadline
                                             or (turn.sent and not turn.ack and now >= turn.deadline - 4)):
                        control.cancel()
                    if turn.cancelled and not turn.cancel_sent:
                        if turn.sent:
                            self.esp.write(f'GS_AI_CANCEL {turn.id}\n'.encode())
                            turn.cancel_sent = True
                            if not turn.ack:
                                control.turn = None
                                control.ready = False
                                handshake_started = now
                        else:
                            control.turn = None
                    elif not turn.sent and not turn.cancelled:
                        self.esp.write(f'GS_AI_ARM {turn.id} {turn.sensor}\n'.encode())
                        turn.sent = True
                        print('ARM:', turn.id, self.bridge.types[turn.sensor], flush=True)
            chunk = self.esp.read(max(1, min(self.esp.in_waiting, 512)))
            for byte in chunk:
                if byte == 10:
                    if not overflow:
                        line = buffer.decode('ascii', errors='replace').strip()
                        with self.lock:
                            result = self.controller.message(line, time.monotonic(), int(time.time() * 1000))
                            if line == 'GS_AI_BOOT 1':
                                handshake_started = time.monotonic()
                            if result:
                                # The monitor can invalidate a session between inference and DROP.
                                if (time.monotonic() - self.checked <= SESSION_MAX_AGE
                                        and same_session(self.session, result[2])
                                        and valid_session(self.session, result[1])):
                                    try:
                                        self.drops.put_nowait(result)
                                    except queue.Full:
                                        raise RuntimeError('HTTP queue full; confirmed drop not queued')
                                else:
                                    print('SKIPPED: session changed/offline at drop time', flush=True)
                        if line.startswith(('GS_AI_ACK', 'GS_AI_DROP', 'GS_AI_DONE', 'GS_AI_READY')):
                            print(line, flush=True)
                    buffer.clear()
                    overflow = False
                elif byte != 13:
                    if len(buffer) < 255 and not overflow:
                        buffer.append(byte)
                    else:
                        overflow = True

    def observe(self, label, score, present, clear, frame_at):
        with self.lock:
            self.frame_at = frame_at
            now = time.monotonic()
            fresh = now - self.checked <= SESSION_MAX_AGE
            self.controller.observe(label, score, present, clear, self.session, self.settings,
                                    fresh and not self.drops.full(),
                                    now, int(time.time() * 1000))
            if not self.controller.ready:
                return 'WAIT_FIRMWARE'
            if self.controller.turn:
                turn = self.controller.turn
                return 'WAIT_DONE' if turn.dropped or turn.cancelled else 'WAIT_DROP' if turn.ack else 'WAIT_ACK'
            if not fresh:
                return 'WAIT_FIREBASE'
            if not valid_session(self.session, time.time() * 1000 + 6000):
                return 'SCAN_QR'
            return 'READY' if self.controller.cleared else 'WAIT_CLEAR'

    def close(self):
        self.stop.set()
        with self.lock:
            turn = self.controller.turn
            if turn and turn.sent:
                try:
                    self.esp.write(f'GS_AI_CANCEL {turn.id}\n'.encode())
                except OSError:
                    pass
        for worker in self.threads:
            worker.join(timeout=6)
        self.esp.close()


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--camera', type=int, default=0)
    parser.add_argument('--fps', type=float, default=5)
    parser.add_argument('--model', type=Path, default=MODEL_PATH)
    parser.add_argument('--port')
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--sensor1', choices=('plastic', 'metal'), default='plastic')
    parser.add_argument('--sensor2', choices=('plastic', 'metal'), default='metal')
    parser.add_argument('--threshold', type=float, default=0.85)
    parser.add_argument('--stable-frames', type=int, default=3)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--check-model', action='store_true')
    parser.add_argument('--image', type=Path, help='Classify one local image, no hardware/Firebase')
    args = parser.parse_args(argv)
    if not math.isfinite(args.fps) or args.fps <= 0:
        parser.error('--fps must be finite and > 0')
    if not math.isfinite(args.threshold) or not 0 < args.threshold <= 1:
        parser.error('--threshold must be in (0, 1]')
    if args.stable_frames < 1 or args.camera < 0 or args.sensor1 == args.sensor2:
        parser.error('Invalid camera, stable frames or duplicate sensor mapping')
    if not (args.dry_run or args.check_model or args.image) and not args.port:
        parser.error('--port is required unless --dry-run, --image or --check-model')
    return args


def main(argv=None):
    args = arguments(argv)
    model = WasteWise(args.model)
    if args.check_model:
        return
    import cv2
    if args.image:
        frame = cv2.imread(str(args.image))
        if frame is None:
            raise ValueError('Cannot read image')
        print(model.predict(frame))
        return
    stop = threading.Event()
    camera = runtime = None
    gate = ClearGate()
    last_sequence = 0
    next_inference = time.monotonic()
    started = next_inference
    previous_inference = None
    try:
        camera = CameraFrames(args.camera, stop)
        if not args.dry_run:
            runtime = CameraBridge(args, stop)
        print('Remove objects from center square; press C to calibrate. Q/Esc stops.', flush=True)
        while not stop.is_set():
            sample = camera.get()
            now = time.monotonic()
            if sample is None:
                if not camera.thread.is_alive() or now - started > 5:
                    raise RuntimeError('Camera has no frames')
                stop.wait(0.01)
                continue
            sequence, captured_at, frame = sample
            if now - captured_at > FRAME_MAX_AGE or not camera.thread.is_alive():
                raise RuntimeError('Camera frames are stale/disconnected; cancelling AI turn')
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord('q')):
                break
            if key == ord('c'):
                if runtime:
                    with runtime.lock:
                        if runtime.controller.turn:
                            print('Cannot recalibrate during a turn', flush=True)
                            continue
                        runtime.controller.cleared = False
                        runtime.controller.reset_frames()
                gate.calibrate(frame)
            if sequence == last_sequence or now < next_inference:
                stop.wait(0.005)
                continue
            last_sequence = sequence
            before = time.monotonic()
            label, score = model.predict(frame)
            after = time.monotonic()
            actual_fps = 0 if previous_inference is None else 1 / max(0.001, before - previous_inference)
            previous_inference = before
            next_inference = max(before + 1 / args.fps, after)
            clear, present = gate.observe(frame, after)
            if after - captured_at > FRAME_MAX_AGE:
                raise RuntimeError('Inference used a stale frame; lower load/resolution')
            state = 'DRY_RUN'
            if runtime:
                state = runtime.observe(label, score, present, clear, captured_at)
            display = frame.copy()
            h, w = frame.shape[:2]
            side = min(h, w)
            cv2.rectangle(display, ((w-side)//2, (h-side)//2), ((w+side)//2, (h+side)//2), (0, 220, 0), 2)
            text = f'{label} {score:.2f} | {state} | {1000*(after-before):.0f}ms | {actual_fps:.1f}/{args.fps:g}fps'
            cv2.putText(display, text, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 0), 1)
            status = 'C: calibrate EMPTY square' if gate.background is None else 'CLEAR' if clear else 'OBJECT' if present else 'WAIT_CLEAR'
            cv2.putText(display, status + ' | Q: quit', (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 0), 1)
            cv2.imshow('Green School Camera AI', display)
        if runtime and runtime.error:
            raise RuntimeError('Camera bridge worker stopped: ' + runtime.error)
    finally:
        stop.set()
        if runtime:
            runtime.close()
        if camera:
            camera.close()
        cv2.destroyAllWindows()
        print('Stopped. Unsent drops in RAM are discarded.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('Stopped.')
    except Exception as error:
        print('STOPPED:', error_message(error) if isinstance(error, OSError) else str(error), flush=True)
        raise SystemExit(1)
