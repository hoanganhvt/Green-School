import importlib.util
import io
import json
import tempfile
from pathlib import Path
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location(
    "bridge", Path(__file__).resolve().parents[1] / "hardware/firebase_http_bridge.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BridgeTests(unittest.TestCase):
    def test_http_error_does_not_expose_url(self):
        error = HTTPError("https://example.com?auth=secret-token", 400, "bad request", {},
                          io.BytesIO(json.dumps({"error": {"message": "INVALID_LOGIN_CREDENTIALS"}}).encode()))
        message = module.error_message(error)
        self.assertIn("HTTP 400", message)
        self.assertNotIn("secret-token", message)

    def test_unknown_error_body_is_not_printed(self):
        for body in (b'{"error":{"message":"secret-token"}}', b'not json', b'[]'):
            error = HTTPError("https://example.com?auth=secret-token", 400, "bad request", {}, io.BytesIO(body))
            self.assertEqual(module.error_message(error),
                             "HTTP 400 (check bin config, deployed database Rules and connection)")

    def setUp(self):
        self.bridge = module.FirebaseBridge("BIN-01")
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
        self.assertEqual(event["binId"], "BIN-01")
        self.assertNotIn("deviceUid", event)
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

    def test_missing_or_mismatched_bin_is_rejected(self):
        for data in (None, {"id": "BIN-02"}):
            with patch.object(self.bridge, "db", return_value=data):
                with self.assertRaises(ValueError):
                    self.bridge.check_bin()

    def test_request_has_no_login_or_auth_token(self):
        with patch.object(module, "http_json", return_value={"id": "BIN-01"}) as request:
            self.bridge.check_bin()
        request.assert_called_once_with("GET", module.DATABASE_URL + "/bins/BIN-01.json", None, None)

    def test_config_is_loaded_and_invalid_ids_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "config.json"
            path.write_text('{"bin_id":"BIN-02"}', encoding="utf-8-sig")
            self.assertEqual(module.load_bin_id(path), "BIN-02")
            for config in ({}, {"bin_id": "../bins"}, {"bin_id": 1}, {"bin_id": "a" * 129}, []):
                path.write_text(json.dumps(config), encoding="utf-8")
                with self.assertRaises(ValueError):
                    module.load_bin_id(path)

    def test_constructor_rejects_unsafe_bin_id(self):
        for bin_id in ("../bins", "", None):
            with self.assertRaises(ValueError):
                module.FirebaseBridge(bin_id)


if __name__ == "__main__":
    unittest.main()
