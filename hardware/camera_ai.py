"""Local camera classifier + single-owner ESP32 USB bridge. See README.md.

Start with --check-model, then --dry-run. Keep the center square empty at
startup for automatic calibration. C recalibrates; Q/Esc stops the application.
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
EI_PATH = Path(__file__).with_name('models') / 'ei-trash-fomo.onnx'
EI_SHA256 = '881ab8bc0cd90f88ec663b615fbaacdb45b3313e3b1741616f3f503deee24dec'
EI_NAMES = {0: '_background', 1: 'kim loại', 2: 'rác nhựa'}
EI_LABELS = (None, 'metal', 'plastic')  # output channel -> bin label
EI_MIN_CELL = 0.5  # Edge Impulse's default FOMO cell threshold
FRAME_MAX_AGE = 1.0
SESSION_MAX_AGE = 2.5
TURN_SECONDS = 5.0
DROP_GRACE = 0.5
SETTINGS_REFRESH = 5.0
CAMERA_READ_GRACE = 1.0
BACKGROUND_ADAPT = 0.05
ID = r'[a-f0-9]{32}'


def preprocess(frame, size=224):
    import cv2
    import numpy as np
    h, w = frame.shape[:2]
    side = min(h, w)
    crop = frame[(h - side) // 2:(h + side) // 2, (w - side) // 2:(w + side) // 2]
    rgb = cv2.cvtColor(cv2.resize(crop, (size, size)), cv2.COLOR_BGR2RGB)
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


class EdgeImpulseFomo:
    """Edge Impulse FOMO detector: a 12x12 grid of background/metal/plastic probabilities."""
    def __init__(self, path=EI_PATH):
        import hashlib
        import onnxruntime as ort
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != EI_SHA256:
            raise ValueError('Edge Impulse model checksum mismatch; re-run convert_ei_model.py and update EI_SHA256')
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        self.session = ort.InferenceSession(str(path), sess_options=options,
                                           providers=['CPUExecutionProvider'])
        inputs, outputs = self.session.get_inputs(), self.session.get_outputs()
        if (len(inputs) != 1 or inputs[0].shape != [1, 3, 96, 96]
                or inputs[0].type != 'tensor(float)' or len(outputs) != 1
                or outputs[0].shape != [1, 3, 12, 12]):
            raise ValueError('Unsupported model input/output')
        meta = self.session.get_modelmeta().custom_metadata_map
        if meta.get('task') != 'fomo' or ast.literal_eval(meta.get('names', '{}')) != EI_NAMES:
            raise ValueError('Model labels/task do not match the Edge Impulse FOMO model')
        self.input_name = inputs[0].name
        print('MODEL OK: Edge Impulse FOMO, metal/plastic, CPU, 96x96. License metadata:', meta.get('license'))

    def predict(self, frame):
        import numpy as np
        grid = self.session.run(None, {self.input_name: preprocess(frame, 96)})[0]
        if (grid.shape != (1, 3, 12, 12) or not np.isfinite(grid).all()
                or np.min(grid) < 0 or np.max(grid) > 1
                or not np.allclose(grid.sum(axis=1), 1, atol=0.001)):
            raise ValueError('Invalid probability output; refusing hardware control')
        # The strongest metal/plastic cell decides; weaker cells are FOMO's normal halo.
        best = grid[0, 1:].reshape(2, -1).max(axis=1)
        channel = int(best.argmax())
        if best[channel] < EI_MIN_CELL:
            return 'background', float(1 - best[channel])
        return EI_LABELS[channel + 1], float(best[channel])


def load_model(kind, path=None):
    if kind == 'edge-impulse':
        return EdgeImpulseFomo(path or EI_PATH)
    return WasteWise(path or MODEL_PATH)


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
            self.calibrate(frame)
        small = self.small(frame)
        changed = float(np.mean(np.abs(small - self.background) > 0.10))
        clear = changed < 0.02
        if clear:
            # Follow slow daylight drift only while the ROI is empty; sudden changes still need C.
            self.background = (1 - BACKGROUND_ADAPT) * self.background + BACKGROUND_ADAPT * small
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
    def __init__(self, sensor1='plastic', sensor2='metal', threshold=0.75, stable=3):
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
        self.why = None  # why the latest frame could not count toward opening a lid

    def reset_frames(self):
        self.label, self.count = None, 0

    def observe(self, label, score, present, clear, session, settings, fresh, now, wall_ms):
        if self.turn is not None or not self.ready:
            self.why = None
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
        # First unmet condition, in plain words, so an operator can see why no lid opens.
        if not fresh:
            self.why = 'Firebase data is stale'
        elif not self.cleared:
            self.why = 'center square must be seen EMPTY first'
        elif not present:
            self.why = 'no object detected in the center square'
        elif label not in self.mapping:
            self.why = f'label {label} is not plastic/metal'
        elif not math.isfinite(score) or score < self.threshold:
            self.why = f'{label} score below {self.threshold:g}'
        elif not isinstance(rule, dict):
            self.why = f'no Firebase rule for {label}'
        elif rule.get('enabled') is False:
            self.why = f'Firebase rule for {label} is disabled'
        elif not valid_session(session, wall_ms + 6000, wall_ms):
            self.why = 'no student session with >= 6 s left; scan QR'
        elif not session.get('uid'):
            self.why = 'student session has no uid'
        elif (session.get('studentCode') == self.last_student
              and wall_ms - self.last_drop_ms < cooldown):
            self.why = 'cooldown after the last drop'
        else:
            self.why = None
        if self.why:
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
        if line == 'GS_AI_OFFLINE 1':
            self.ready = False
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
        failed_since = None
        while not self.stop.is_set():
            ok, frame = self.camera.read()
            if not ok:
                # USB webcams drop single frames; only a sustained failure means disconnected.
                now = time.monotonic()
                failed_since = failed_since or now
                if now - failed_since > CAMERA_READ_GRACE:
                    return
                self.stop.wait(0.02)
                continue
            failed_since = None
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
        # Inference runs at --fps; allow ~2 missed inferences before treating the camera as stale.
        self.frame_max_age = max(FRAME_MAX_AGE, 2.5 / args.fps)
        self.drops = queue.Queue(maxsize=100)
        self.blocked = set()
        self.error = None
        self.threads = []
        import serial
        try:
            self.esp = serial.Serial(args.port, 115200, timeout=0.05, write_timeout=1)
        except serial.SerialException as error:
            raise RuntimeError(
                f'Cannot open ESP32 port {args.port}: {error}. '
                'Close Serial Monitor/other bridge processes and check the COM port and USB connection.'
            ) from error
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
            self.error = str(error) if type(error) is RuntimeError else error_message(error)
            print('WORKER STOPPED:', self.error, flush=True)
            self.stop.set()

    def monitor(self):
        next_heartbeat = next_settings = 0
        while not self.stop.is_set():
            # Session freshness gates arming, so it is polled alone; settings change rarely and a
            # failed heartbeat must not mark a freshly read session as stale.
            try:
                session = self.bridge.db('GET', f'bins/{self.bridge.bin_id}/activeSession')
                with self.lock:
                    self.session = session
                    self.checked = time.monotonic()
            except (OSError, ValueError) as error:
                with self.lock:
                    self.checked = 0
                print('MONITOR:', error_message(error), flush=True)
            if time.monotonic() >= next_settings:
                try:
                    settings = self.bridge.db('GET', 'settings')
                    with self.lock:
                        self.settings = settings if isinstance(settings, dict) else {}
                    next_settings = time.monotonic() + SETTINGS_REFRESH
                except (OSError, ValueError) as error:
                    print('SETTINGS:', error_message(error), flush=True)
            if time.monotonic() >= next_heartbeat:
                try:
                    self.bridge.heartbeat()
                    next_heartbeat = time.monotonic() + 30
                except (OSError, ValueError) as error:
                    print('HEARTBEAT:', error_message(error), flush=True)
                    next_heartbeat = time.monotonic() + 5
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
                if self.blocked:
                    # Firmware refuses READY while a bin is full/stuck; wait for the operator.
                    handshake_started = now
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
                    stale = (now - self.frame_at > self.frame_max_age
                             or now - self.checked > SESSION_MAX_AGE)
                    known_bad = (not same_session(self.session, turn.session)
                                 or not valid_session(self.session, wall_ms)
                                 or not rule or rule.get('enabled') is False)
                    # Fresh data is required to open a lid. Once the lid is open, only a known
                    # session/rule change cancels; a slow request must not close it mid-drop
                    # (send_drop re-reads the session before writing the event).
                    invalid = known_bad or (stale and not turn.ack)
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
                        # Firmware starts its AI_TTL on receipt; never end the turn before it does.
                        turn.deadline = now + TURN_SECONDS + DROP_GRACE
                        print('ARM:', turn.id, self.bridge.types[turn.sensor], flush=True)
            chunk = self.esp.read(max(1, min(self.esp.in_waiting, 512)))
            for byte in chunk:
                if byte == 10:
                    if not overflow:
                        line = buffer.decode('ascii', errors='replace').strip()
                        with self.lock:
                            result = self.controller.message(line, time.monotonic(), int(time.time() * 1000))
                            if line in ('GS_AI_BOOT 1', 'GS_AI_OFFLINE 1'):
                                handshake_started = time.monotonic()
                            if line == 'GS_AI_BOOT 1':
                                self.blocked.clear()
                            blocked = re.fullmatch(r'GS_BIN_(BLOCKED|CLEAR) ([12])(?: (occupied|no_echo))?', line)
                            if blocked:
                                (self.blocked.add if blocked[1] == 'BLOCKED' else self.blocked.discard)(int(blocked[2]))
                                handshake_started = time.monotonic()
                            if result:
                                # The monitor can invalidate a session between inference and DROP.
                                # Stale data alone is not a reason to drop it: send_drop re-checks.
                                if (same_session(self.session, result[2])
                                        and valid_session(self.session, result[1])):
                                    if time.monotonic() - self.checked > SESSION_MAX_AGE:
                                        print('DROP: session data stale; sender will re-check it', flush=True)
                                    try:
                                        self.drops.put_nowait(result)
                                    except queue.Full:
                                        raise RuntimeError('HTTP queue full; confirmed drop not queued')
                                else:
                                    print('SKIPPED: session changed/offline at drop time', flush=True)
                        if line.startswith(('GS_AI_ACK', 'GS_AI_DROP', 'GS_AI_DONE', 'GS_AI_READY', 'GS_AI_OFFLINE',
                                            'GS_BIN_BLOCKED', 'GS_BIN_CLEAR', 'GS_LID', 'GS_FW')):
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
            if self.blocked and not self.controller.turn:
                return 'BIN_BLOCKED'
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
    parser.add_argument('--model-type', choices=('wastewise', 'edge-impulse'), default='wastewise',
                        help='wastewise: 8-class classifier; edge-impulse: metal/plastic FOMO detector')
    parser.add_argument('--model', type=Path, help='Model file; defaults to the pinned file for --model-type')
    parser.add_argument('--port')
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--sensor1', choices=('plastic', 'metal'), default='plastic')
    parser.add_argument('--sensor2', choices=('plastic', 'metal'), default='metal')
    parser.add_argument('--threshold', type=float, default=0.75)
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
    model = load_model(args.model_type, args.model)
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
    last_report, last_report_at = None, 0.0
    try:
        camera = CameraFrames(args.camera, stop)
        if not args.dry_run:
            runtime = CameraBridge(args, stop)
        print('Keep center square EMPTY at startup for automatic calibration; wait for CLEAR. C recalibrates; Q/Esc stops.', flush=True)
        while not stop.is_set():
            sample = camera.get()
            now = time.monotonic()
            if sample is None:
                if not camera.thread.is_alive() or now - started > 5:
                    raise RuntimeError('Camera has no frames')
                stop.wait(0.01)
                continue
            sequence, captured_at, frame = sample
            if now - captured_at > FRAME_MAX_AGE + CAMERA_READ_GRACE or not camera.thread.is_alive():
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
                with runtime.lock:
                    why = runtime.controller.why
                # Terminal trace of what blocks arming; throttled so a flickering frame cannot flood it.
                report = f'STATE {state}' + (f': {why}' if why and state == 'READY' else '')
                if report != last_report and after - last_report_at >= 0.5:
                    print(report, f'| {label} {score:.2f}', flush=True)
                    last_report, last_report_at = report, after
            display = frame.copy()
            h, w = frame.shape[:2]
            side = min(h, w)
            cv2.rectangle(display, ((w-side)//2, (h-side)//2), ((w+side)//2, (h+side)//2), (0, 220, 0), 2)
            text = f'{label} {score:.2f} | {state} | {1000*(after-before):.0f}ms | {actual_fps:.1f}/{args.fps:g}fps'
            cv2.putText(display, text, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 0), 1)
            status = 'CLEAR' if clear else 'OBJECT' if present else 'WAIT_CLEAR'
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
