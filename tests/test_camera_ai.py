import hashlib
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import queue
import threading
import time
import io
from contextlib import redirect_stderr

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'hardware'))
import camera_ai as camera
from download_camera_model import SHA256, MODEL_PATH, verify_model


class ControllerTests(unittest.TestCase):
    def test_serial_open_error_includes_port_and_reason(self):
        serial = SimpleNamespace(SerialException=OSError,
                                 Serial=Mock(side_effect=OSError('Access is denied')))
        with patch.dict(sys.modules, serial=serial), \
                patch.object(camera, 'FirebaseBridge'), patch.object(camera, 'load_bin_id', return_value='BIN-01'):
            with self.assertRaisesRegex(RuntimeError, 'Cannot open ESP32 port COM6: Access is denied'):
                camera.CameraBridge(camera.arguments(['--port', 'COM6']), threading.Event())

    def test_worker_preserves_runtime_error_reason(self):
        runtime = camera.CameraBridge.__new__(camera.CameraBridge)
        runtime.stop = threading.Event()

        def fail():
            raise RuntimeError('No AI_READY after 15s; check firmware, clear sensors and COM')

        runtime.run_worker(fail)
        self.assertIn('No AI_READY after 15s', runtime.error)
        self.assertTrue(runtime.stop.is_set())

    def setUp(self):
        self.control = camera.TurnController()
        self.control.ready = True
        self.session = {'uid': 'u1', 'studentCode': 'S1', 'username': 's1',
                        'startedAt': 9000, 'expiresAt': 100000}
        self.settings = {'rules': {'plastic': {'enabled': True}, 'metal': {'enabled': True}},
                         'cooldownSeconds': 3}

    def observe(self, label='plastic', score=0.95, present=True, clear=False, fresh=True):
        self.control.observe(label, score, present, clear, self.session, self.settings, fresh, 10, 10000)

    def arm(self):
        self.observe(present=False, clear=True)
        for _ in range(3):
            self.observe()
        self.assertIsNotNone(self.control.turn)
        self.control.turn.sent = True
        return self.control.turn

    def test_needs_clear_stable_supported_label_and_session(self):
        for _ in range(5):
            self.observe()
        self.assertIsNone(self.control.turn)
        self.observe(present=False, clear=True)
        for label, score in [('plastic', 0.9), ('plastic', 0.1), ('paper', 0.99), ('metal', 0.9)]:
            self.observe(label, score)
        self.assertIsNone(self.control.turn)
        self.observe(fresh=False)
        self.observe(); self.observe()
        self.assertIsNone(self.control.turn)
        self.observe()
        self.assertEqual(self.control.turn.sensor, 1)

    def test_default_threshold_accepts_075_after_three_frames(self):
        self.assertEqual(camera.arguments(['--port', 'COM6']).threshold, 0.75)
        self.observe(present=False, clear=True)
        for _ in range(3):
            self.observe(score=0.749)
        self.assertIsNone(self.control.turn)
        for _ in range(2):
            self.observe(score=0.75)
        self.assertIsNone(self.control.turn)
        self.observe(score=0.75)
        self.assertEqual(self.control.turn.sensor, 1)

    def test_drop_requires_ack_matching_request_sensor_and_new_counter(self):
        turn = self.arm()
        msg = f'GS_AI_DROP {turn.id} 1 1'
        self.assertIsNone(self.control.message(msg, 10, 10000))
        self.control.message(f'GS_AI_ACK {turn.id} 1', 10, 10000)
        for bad in (f'GS_AI_DROP {turn.id} 2 1', 'GS_DROP 1 1',
                    f"GS_AI_DROP {'b'*32} 1 1", f'GS_AI_DROP {turn.id} 1 0'):
            self.assertIsNone(self.control.message(bad, 10, 10000))
        result = self.control.message(msg, 10, 10001)
        self.assertEqual(result, (1, 10001, self.session))
        self.assertIsNone(self.control.message(msg, 10, 10002))
        self.control.message(f'GS_AI_DONE {turn.id} drop', 11, 11000)
        for _ in range(5):
            self.observe()
        self.assertIsNone(self.control.turn)

    def test_cancel_timeout_and_reboot_cannot_score(self):
        turn = self.arm()
        self.control.message(f'GS_AI_ACK {turn.id} 1', 10, 10000)
        self.assertIsNone(self.control.message(f'GS_AI_DROP {turn.id} 1 1', 16, 16000))
        self.control.cancel()
        self.assertIsNone(self.control.message(f'GS_AI_DROP {turn.id} 1 1', 11, 11000))
        self.control.message('GS_AI_BOOT 1', 11, 11000)
        self.assertFalse(self.control.ready)
        self.assertIsNone(self.control.turn)
        with self.assertRaises(RuntimeError):
            self.control.message('GS_AI_MANUAL 1', 11, 11000)

    def test_disabled_rule_and_expired_session_do_not_arm(self):
        self.control.cleared = True
        self.settings['rules']['plastic']['enabled'] = False
        for _ in range(3): self.observe()
        self.assertIsNone(self.control.turn)
        self.settings['rules']['plastic']['enabled'] = True
        self.session['expiresAt'] = 14000
        for _ in range(3): self.observe()
        self.assertIsNone(self.control.turn)

    def test_link_timeout_revokes_ready_and_current_turn(self):
        turn = self.arm()
        self.control.message(f'GS_AI_ACK {turn.id} 1', 10, 10000)
        self.control.message('GS_AI_OFFLINE 1', 10.5, 10500)
        self.assertFalse(self.control.ready)
        self.assertTrue(turn.cancelled)
        self.assertIsNone(self.control.message(f'GS_AI_DROP {turn.id} 1 1', 11, 11000))
        self.control.message(f'GS_AI_DONE {turn.id} link_lost', 12, 12000)
        self.control.message('GS_AI_READY 1', 13, 13000)
        self.assertTrue(self.control.ready)
        self.assertFalse(self.control.cleared)

    def test_swapped_mapping_and_cli_validation(self):
        self.assertEqual(camera.TurnController('metal', 'plastic').mapping['plastic'], 2)
        for args in (['--dry-run', '--fps', 'nan'], ['--dry-run', '--threshold', '2'],
                     ['--dry-run', '--stable-frames', '0'], ['--sensor2', 'plastic'], []):
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): camera.arguments(args)
        self.assertTrue(camera.arguments(['--check-model']).check_model)


class SerialIntegrationTests(unittest.TestCase):
    def runtime(self):
        runtime = camera.CameraBridge.__new__(camera.CameraBridge)
        runtime.stop = threading.Event()
        runtime.lock = threading.Lock()
        runtime.controller = camera.TurnController()
        runtime.controller.ready = True
        wall_ms = int(time.time() * 1000)
        runtime.session = {'uid': 'u1', 'studentCode': 'S1', 'username': 's1',
                           'startedAt': wall_ms - 1000, 'expiresAt': wall_ms + 60000}
        runtime.settings = {'rules': {'plastic': {'enabled': True}}}
        runtime.bridge = type('Bridge', (), {'types': {1: 'plastic', 2: 'metal'}, 'bin_id': 'BIN-01'})()
        runtime.frame_at = runtime.checked = time.monotonic()
        runtime.drops = queue.Queue(maxsize=100)
        runtime.blocked = set()
        runtime.frame_max_age = camera.FRAME_MAX_AGE
        runtime.controller.turn = camera.Turn('a' * 32, 1, dict(runtime.session), time.monotonic() + 5)
        return runtime

    def port(self, runtime, lines):
        class Port:
            in_waiting = 1
            def __init__(self): self.written = []
            def write(self, data): self.written.append(data)
            def read(self, size):
                if lines: return lines.pop(0)
                runtime.stop.set()
                return b''
        return Port()

    def test_serial_arm_ack_confirm_and_done_queue_one_legacy_compatible_event(self):
        runtime = self.runtime()
        rid = runtime.controller.turn.id
        lines = [f'GS_AI_ACK {rid} 1\n'.encode(), b'GS_DROP 1 1\n',
                 f'GS_AI_DROP {rid} 1 1\nGS_AI_DROP {rid} 1 1\n'.encode(),
                 f'GS_AI_DONE {rid} drop\n'.encode()]
        runtime.esp = self.port(runtime, lines)
        runtime.serial_loop()
        self.assertIn(f'GS_AI_ARM {rid} 1\n'.encode(), runtime.esp.written)
        self.assertEqual(runtime.drops.qsize(), 1)
        sensor, captured, snapshot = runtime.drops.get()
        self.assertEqual(sensor, 1)
        self.assertEqual(snapshot, runtime.session)
        self.assertIsNone(runtime.controller.turn)

    def test_changed_session_or_stale_frame_prevents_arm(self):
        for stale in (False, True):
            runtime = self.runtime()
            if stale: runtime.frame_at -= 2
            else: runtime.session = dict(runtime.session, uid='another')
            runtime.esp = self.port(runtime, [])
            runtime.serial_loop()
            self.assertFalse(any(b'GS_AI_ARM' in message for message in runtime.esp.written))
            self.assertEqual(runtime.drops.qsize(), 0)

    def test_wrong_old_and_overlong_lines_do_not_confirm_drop(self):
        runtime = self.runtime()
        rid = runtime.controller.turn.id
        runtime.esp = self.port(runtime, [b'x' * 300 + b'\n',
                                        f'GS_AI_DROP {rid} 1 1\n'.encode()])
        runtime.serial_loop()
        self.assertEqual(runtime.drops.qsize(), 0)

    def test_preview_waits_for_firebase_and_qr(self):
        runtime = self.runtime()
        runtime.controller.turn = None
        runtime.checked = 0
        self.assertEqual(runtime.observe('paper', 0.9, False, False, time.monotonic()), 'WAIT_FIREBASE')
        runtime.checked = time.monotonic()
        runtime.session = None
        self.assertEqual(runtime.observe('paper', 0.9, False, False, time.monotonic()), 'SCAN_QR')

    def test_serial_rehandshakes_after_firmware_link_timeout(self):
        runtime = self.runtime()
        runtime.controller.turn = None
        runtime.esp = self.port(runtime, [b'GS_AI_OFFLINE 1\n', b'GS_AI_READY 1\n'])
        runtime.serial_loop()
        self.assertIn(b'GS_AI_HELLO 1\n', runtime.esp.written)
        self.assertTrue(runtime.controller.ready)
        self.assertFalse(runtime.controller.cleared)
        self.assertEqual(runtime.drops.qsize(), 0)

    def test_slow_firebase_after_ack_keeps_lid_turn_and_queues_drop(self):
        runtime = self.runtime()
        rid = runtime.controller.turn.id
        runtime.controller.turn.sent = runtime.controller.turn.ack = True
        runtime.checked = 0  # monitor request failed/slow after the lid opened
        runtime.frame_at -= 5
        runtime.esp = self.port(runtime, [f'GS_AI_DROP {rid} 1 1\n'.encode()])
        with patch('builtins.print'):
            runtime.serial_loop()
        self.assertFalse(any(b'GS_AI_CANCEL' in m for m in runtime.esp.written))
        self.assertEqual(runtime.drops.qsize(), 1)

    def test_known_session_change_after_ack_still_cancels(self):
        runtime = self.runtime()
        runtime.controller.turn.sent = runtime.controller.turn.ack = True
        runtime.session = dict(runtime.session, uid='another')
        runtime.esp = self.port(runtime, [])
        runtime.serial_loop()
        self.assertIn(f'GS_AI_CANCEL {"a" * 32}\n'.encode(), runtime.esp.written)

    def test_low_fps_does_not_mark_camera_stale(self):
        args = camera.arguments(['--port', 'COM6', '--fps', '0.5'])
        with patch.dict(sys.modules, serial=SimpleNamespace(SerialException=OSError, Serial=Mock())), \
                patch.object(camera, 'FirebaseBridge'), patch.object(camera, 'load_bin_id', return_value='BIN-01'), \
                patch.object(camera.threading, 'Thread'):
            runtime = camera.CameraBridge(args, threading.Event())
        self.assertGreaterEqual(runtime.frame_max_age, 2 / args.fps)

    def test_heartbeat_failure_keeps_session_fresh(self):
        runtime = self.runtime()
        runtime.checked = 0
        calls = []

        def db(method, path, body=None, headers=None):
            calls.append(path)
            if path == 'settings':
                return {'rules': {}}
            return runtime.session

        def heartbeat():
            runtime.stop.set()
            raise OSError('offline')

        runtime.bridge = SimpleNamespace(bin_id='BIN-01', db=db, heartbeat=heartbeat)
        with patch('builtins.print'):
            runtime.monitor()
        self.assertGreater(runtime.checked, 0)
        self.assertEqual(calls, ['bins/BIN-01/activeSession', 'settings'])

    def test_turn_deadline_starts_when_arm_is_sent(self):
        runtime = self.runtime()
        runtime.controller.turn.deadline = time.monotonic() + 0.2  # created long before ARM
        runtime.esp = self.port(runtime, [])
        before = time.monotonic()
        runtime.serial_loop()
        turn = runtime.controller.turn
        self.assertTrue(turn.sent and not turn.cancelled)
        self.assertGreaterEqual(turn.deadline, before + camera.TURN_SECONDS)

    def test_blocked_bin_is_reported_and_cleared(self):
        runtime = self.runtime()
        runtime.controller.turn = None
        runtime.controller.ready = False
        runtime.esp = self.port(runtime, [b'GS_BIN_BLOCKED 2 occupied\n'])
        with patch('builtins.print'):
            runtime.serial_loop()
        self.assertEqual(runtime.blocked, {2})
        self.assertEqual(runtime.observe('paper', 0.9, False, False, time.monotonic()), 'BIN_BLOCKED')
        runtime.stop.clear()
        runtime.esp = self.port(runtime, [b'GS_BIN_CLEAR 2\n'])
        with patch('builtins.print'):
            runtime.serial_loop()
        self.assertEqual(runtime.blocked, set())
        self.assertEqual(runtime.observe('paper', 0.9, False, False, time.monotonic()), 'WAIT_FIRMWARE')


class ImageTests(unittest.TestCase):
    def test_preprocessing_and_background_gate(self):
        import numpy as np
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        frame[:, :, 2] = 255
        result = camera.preprocess(frame)
        self.assertEqual(result.shape, (1, 3, 224, 224))
        self.assertEqual(result.dtype, np.float32)
        self.assertEqual(float(result[0, 0, 0, 0]), 1)
        self.assertEqual(float(result[0, 2, 0, 0]), 0)
        gate = camera.ClearGate()
        self.assertEqual(gate.observe(frame, 1), (False, False))
        self.assertIsNotNone(gate.background)
        self.assertEqual(gate.observe(frame, 1.5), (False, False))
        self.assertEqual(gate.observe(frame, 2.1), (True, False))
        changed = frame.copy(); changed[60:180, 100:220] = 255
        clear, present = gate.observe(changed, 3)
        self.assertFalse(clear); self.assertTrue(present)
        self.assertEqual(gate.observe(frame, 3.1), (False, False))
        gate.calibrate(changed)
        self.assertEqual(gate.observe(changed, 4), (False, False))
        self.assertEqual(gate.observe(changed, 5.1), (True, False))

    def test_background_follows_slow_light_drift_but_not_objects(self):
        import numpy as np
        frame = np.full((240, 320, 3), 100, dtype=np.uint8)
        gate = camera.ClearGate()
        gate.observe(frame, 0)
        # Brighten by 1 level per frame: a fixed background would see > 0.10 change after ~26 steps.
        for step in range(1, 61):
            clear, present = gate.observe(np.full_like(frame, 100 + step), step)
            self.assertFalse(present)
        self.assertTrue(clear)
        sudden = np.full_like(frame, 160); sudden[60:180, 100:220] = 255
        clear, present = gate.observe(sudden, 70)
        self.assertFalse(clear); self.assertTrue(present)

    def test_camera_tolerates_dropped_frames(self):
        import numpy as np
        frame = np.zeros((4, 4, 3), dtype=np.uint8)
        reads = iter([(False, None), (False, None), (True, frame)])
        frames = camera.CameraFrames.__new__(camera.CameraFrames)
        frames.stop, frames.lock, frames.latest, frames.sequence = threading.Event(), threading.Lock(), None, 0

        def read():
            try:
                return next(reads)
            except StopIteration:
                frames.stop.set()
                return False, None

        frames.camera = SimpleNamespace(read=read)
        frames.capture()
        self.assertEqual(frames.sequence, 1)

    def test_bad_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bad.onnx'; path.write_bytes(b'bad')
            with self.assertRaises(ValueError): verify_model(path)

    @unittest.skipUnless(MODEL_PATH.exists(), 'Download pinned model for real inference smoke test')
    def test_real_model_labels_and_probabilities(self):
        import numpy as np
        self.assertEqual(hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(), SHA256)
        label, score = camera.WasteWise(MODEL_PATH).predict(np.zeros((224, 224, 3), dtype=np.uint8))
        self.assertIn(label, camera.LABELS)
        self.assertTrue(0 <= score <= 1)


class ArmingReasonTests(unittest.TestCase):
    def test_reports_first_condition_that_blocks_arming(self):
        wall_ms = int(time.time() * 1000)
        session = {'uid': 'u1', 'studentCode': 'S1', 'username': 's1',
                   'startedAt': wall_ms - 1000, 'expiresAt': wall_ms + 60000}
        rules = {'rules': {'plastic': {'enabled': True}, 'metal': {'enabled': False}}}
        control = camera.TurnController()
        control.ready = True

        def why(label='metal', score=0.9, present=True, clear=False, session=session, settings=rules):
            control.observe(label, score, present, clear, session, settings, True, 1, wall_ms)
            return control.why

        self.assertEqual(why(), 'center square must be seen EMPTY first')
        why(present=False, clear=True)
        self.assertEqual(why(present=False), 'no object detected in the center square')
        self.assertEqual(why(score=0.5), 'metal score below 0.75')
        self.assertEqual(why(), 'Firebase rule for metal is disabled')
        self.assertEqual(why(settings={'rules': {}}), 'no Firebase rule for metal')
        self.assertEqual(why(label='plastic', session={}), 'no student session with >= 6 s left; scan QR')
        self.assertIsNone(why(label='plastic'))
        self.assertIsNone(control.turn)
        why(label='plastic'); why(label='plastic')
        self.assertIsNotNone(control.turn)


class SessionProblemTests(unittest.TestCase):
    def test_explains_missing_expired_and_clock_skew(self):
        now = 1_000_000_000_000
        ok = {'studentCode': 'S1', 'username': 's1', 'startedAt': now - 1000, 'expiresAt': now + 60000}
        problem = lambda session: camera.session_problem(session, now, 'BIN-01')
        self.assertIn('no session on BIN-01', problem(None))
        self.assertIn('no student', problem({**ok, 'username': ''}))
        self.assertIn('120 s in the future', problem({**ok, 'startedAt': now + 120000}))
        self.assertIn('laptop clock is behind', problem({**ok, 'startedAt': now + 120000}))
        self.assertIn('expired 30 s ago', problem({**ok, 'expiresAt': now - 30000}))
        self.assertIn('< 6 s left', problem({**ok, 'expiresAt': now + 3000}))


class EdgeImpulseTests(unittest.TestCase):
    def fomo(self, grid):
        model = camera.EdgeImpulseFomo.__new__(camera.EdgeImpulseFomo)
        model.input_name = 'x'
        model.session = Mock()
        model.session.run.return_value = [grid]
        return model

    def grid(self, cells=()):
        import numpy as np
        grid = np.zeros((1, 3, 12, 12), dtype=np.float32)
        grid[0, 0] = 1
        for channel, row, col, value in cells:
            grid[0, :, row, col] = 0
            grid[0, channel, row, col] = value
            grid[0, 0, row, col] = 1 - value
        return grid

    def test_strongest_cell_picks_label_and_background_is_not_a_bin_label(self):
        import numpy as np
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        model = self.fomo(self.grid([(2, 5, 5, 0.9), (1, 1, 1, 0.6)]))
        self.assertEqual(model.predict(frame), ('plastic', 0.8999999761581421))
        self.assertEqual(model.session.run.call_args[0][1]['x'].shape, (1, 3, 96, 96))
        self.assertEqual(self.fomo(self.grid([(1, 3, 3, 0.8)])).predict(frame)[0], 'metal')
        label, score = self.fomo(self.grid([(2, 0, 0, 0.3)])).predict(frame)
        self.assertEqual(label, 'background')
        self.assertAlmostEqual(score, 0.7, places=5)
        self.assertNotIn('background', camera.TurnController().mapping)

    def test_invalid_grid_is_refused(self):
        import numpy as np
        frame = np.zeros((96, 96, 3), dtype=np.uint8)
        bad = self.grid(); bad[0, 1, 0, 0] = 0.5  # cell no longer sums to 1
        for grid in (bad, np.full((1, 3, 12, 12), np.nan, dtype=np.float32), np.zeros((1, 3, 6, 6), dtype=np.float32)):
            with self.assertRaises(ValueError): self.fomo(grid).predict(frame)

    def test_cli_selects_model_and_rejects_unpinned_file(self):
        self.assertEqual(camera.arguments(['--check-model']).model_type, 'wastewise')
        self.assertEqual(camera.arguments(['--check-model', '--model-type', 'edge-impulse']).model_type, 'edge-impulse')
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            camera.arguments(['--check-model', '--model-type', 'yolo'])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bad.onnx'; path.write_bytes(b'bad')
            with self.assertRaises(ValueError): camera.load_model('edge-impulse', path)

    @unittest.skipUnless(camera.EI_PATH.exists(), 'Edge Impulse model not present')
    def test_real_edge_impulse_model_runs(self):
        import numpy as np
        model = camera.load_model('edge-impulse')
        label, score = model.predict(np.zeros((480, 640, 3), dtype=np.uint8))
        self.assertIn(label, ('background', 'metal', 'plastic'))
        self.assertTrue(0 <= score <= 1)


if __name__ == '__main__':
    unittest.main()
