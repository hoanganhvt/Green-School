import importlib.util
from pathlib import Path
import time
import unittest
from unittest.mock import patch
from urllib.error import URLError

spec = importlib.util.spec_from_file_location(
    "bridge", Path(__file__).resolve().parents[1] / "hardware/firebase_http_bridge.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = module.FirebaseBridge("device@example.com", "not-a-real-password")
        self.bridge.uid = "device-uid"
        self.now = int(time.time() * 1000)
        self.session = {"studentCode": "S1", "username": "student1",
                        "startedAt": self.now - 1000, "expiresAt": self.now + 60000}

    def test_only_sensor_confirmation_is_parsed(self):
        self.assertEqual(module.parse_drop("GS_DROP 1 12\r\n"), 1)
        self.assertEqual(module.parse_drop("GS_DROP 2 7"), 2)
        for line in ("plastic", "metal", "GS_DROP 3 1", "GS_DROP 1 -1", "log GS_DROP 1 1"):
            self.assertIsNone(module.parse_drop(line))

    def test_event_contains_session_and_device(self):
        with patch.object(self.bridge, "db", side_effect=[self.session, {}]) as db:
            self.assertTrue(self.bridge.send_drop(2, self.now))
        method, path, event, headers = db.call_args.args
        self.assertEqual(method, "PUT")
        self.assertEqual(path, "events/" + event["txId"])
        self.assertEqual(headers, {"if-match": "null_etag"})
        self.assertEqual(event["deviceUid"], "device-uid")
        self.assertEqual(event["studentCode"], "S1")
        self.assertEqual(event["type"], "metal")
        self.assertEqual(event["ts"], self.now)

    def test_new_student_session_cannot_receive_an_older_drop(self):
        self.session["startedAt"] = self.now + 1
        with patch.object(self.bridge, "db", return_value=self.session) as db:
            self.assertFalse(self.bridge.send_drop(1, self.now))
        self.assertEqual(db.call_count, 1)

    def test_lost_response_is_verified_without_overwriting_processed_event(self):
        saved = {}

        def db(method, path, body=None, headers=None):
            if path.endswith("activeSession"):
                return self.session
            if method == "PUT":
                saved.update(body, status="processed")
                raise URLError("lost response")
            return saved

        with patch.object(self.bridge, "db", side_effect=db) as request:
            self.assertTrue(self.bridge.send_drop(1, self.now))
        self.assertEqual([c.args[0] for c in request.call_args_list], ["GET", "PUT", "GET"])

    def test_retry_preserves_id_timestamp_and_student(self):
        attempts = []

        def db(method, path, body=None, headers=None):
            if path.endswith("activeSession"):
                return self.session
            if method == "PUT":
                attempts.append(dict(body))
                if len(attempts) == 1:
                    raise URLError("offline")
                return body
            return None

        with patch.object(self.bridge, "db", side_effect=db), patch("threading.Event.wait"):
            self.assertTrue(self.bridge.send_drop(1, self.now))
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0], attempts[1])

    def test_expired_drop_is_never_sent(self):
        with patch.object(self.bridge, "db") as db:
            self.assertFalse(self.bridge.send_drop(1, self.now - 31000))
        db.assert_not_called()

    def test_disabled_device_is_rejected(self):
        with patch.object(self.bridge, "login"), patch.object(
                self.bridge, "db", return_value={"enabled": False, "binId": "BIN-01"}):
            with self.assertRaises(ValueError):
                self.bridge.check_device()


if __name__ == "__main__":
    unittest.main()
