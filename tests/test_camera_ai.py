import hashlib
import sys
from pathlib import Path
import tempfile
import unittest
import queue
import threading
import time
import io
from contextlib import redirect_stderr

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'hardware'))
import camera_ai as camera
from download_camera_model import SHA256, MODEL_PATH, verify_model


class ControllerTests(unittest.TestCase):
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
        runtime.bridge = type('Bridge', (), {'types': {1: 'plastic', 2: 'metal'}})()
        runtime.frame_at = runtime.checked = time.monotonic()
        runtime.drops = queue.Queue(maxsize=100)
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
        gate.calibrate(frame)
        self.assertEqual(gate.observe(frame, 1), (False, False))
        self.assertEqual(gate.observe(frame, 2.1), (True, False))
        changed = frame.copy(); changed[60:180, 100:220] = 255
        clear, present = gate.observe(changed, 3)
        self.assertFalse(clear); self.assertTrue(present)
        self.assertEqual(gate.observe(frame, 3.1), (False, False))

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


if __name__ == '__main__':
    unittest.main()
