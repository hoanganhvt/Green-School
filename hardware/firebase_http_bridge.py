"""Read GS_DROP from ESP32 USB and send HTTPS events using the configured bin ID.

Run from the project root:
    py hardware/firebase_http_bridge.py --port COM5
Bin ID is loaded from hardware/bin_config.json. Close Serial Monitor first.
Only this process may read the ESP32 COM port. Camera integration can import
FirebaseBridge and call send_drop(sensor, captured_ms) after a confirmed drop.
"""

import argparse
import json
from pathlib import Path
import queue
import re
import threading
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DATABASE_URL = "https://smarttrashbin-98428-default-rtdb.asia-southeast1.firebasedatabase.app"
EVENT_TTL_MS = 30000
DEFAULT_CONFIG = Path(__file__).with_name("bin_config.json")


def load_bin_id(path):
    config = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    bin_id = config.get("bin_id") if isinstance(config, dict) else None
    if not isinstance(bin_id, str) or not re.fullmatch(r"[A-Z0-9_-]{1,128}", bin_id):
        raise ValueError("Config must contain bin_id (1-128 uppercase letters, digits, _ or -)")
    return bin_id


def http_json(method, url, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(url, data=data, method=method,
                      headers={"Content-Type": "application/json", **(headers or {})})
    with urlopen(request, timeout=5) as response:
        return json.load(response)


def parse_drop(line):
    match = re.fullmatch(r"GS_DROP ([12]) ([0-9]+)", line.strip())
    return int(match[1]) if match else None


def error_message(error):
    # HTTPError/URLError strings can contain URLs with authentication tokens.
    if isinstance(error, HTTPError):
        return f"HTTP {error.code} (check bin config, deployed database Rules and connection)"
    return type(error).__name__


class FirebaseBridge:
    def __init__(self, bin_id, sensor1="plastic", sensor2="metal"):
        if not isinstance(bin_id, str) or not re.fullmatch(r"[A-Z0-9_-]{1,128}", bin_id):
            raise ValueError("Invalid bin ID")
        self.bin_id = bin_id
        self.types = {1: sensor1, 2: sensor2}

    def db(self, method, path, body=None, headers=None):
        return http_json(method, f"{DATABASE_URL}/{path}.json", body, headers)

    def check_bin(self):
        bin_data = self.db("GET", f"bins/{self.bin_id}")
        if not isinstance(bin_data, dict) or bin_data.get("id") != self.bin_id:
            raise ValueError("Bin does not exist; create " + self.bin_id + " in the admin website first")

    def heartbeat(self):
        self.db("PATCH", f"bins/{self.bin_id}", {
            "lastSeen": {".sv": "timestamp"}, "ip": "python-usb-bridge",
        })

    def send_drop(self, sensor, captured_ms, stop=None):
        """Send one confirmed drop. Retry with the SAME ID and timestamp.

        shortcut: RAM queue only; unsent drops are lost when this process stops.
        Use a persistent outbox if drops must survive laptop restarts.
        """
        if sensor not in self.types:
            raise ValueError("Sensor must be 1 or 2")
        stop = stop or threading.Event()
        event = None
        tx_id = "USB-" + uuid.uuid4().hex
        while not stop.is_set() and time.time() * 1000 - captured_ms < EVENT_TTL_MS:
            try:
                if event is None:
                    session = self.db("GET", f"bins/{self.bin_id}/activeSession")
                    if (not session or not session.get("studentCode") or not session.get("username")
                            or not isinstance(session.get("startedAt"), (int, float))
                            or not isinstance(session.get("expiresAt"), (int, float))
                            or not session["startedAt"] <= captured_ms < session["expiresAt"]
                            or session["expiresAt"] <= time.time() * 1000):
                        print("SKIPPED: no valid student session at drop time. Scan QR first.", flush=True)
                        return False
                    event = {
                        "txId": tx_id, "binId": self.bin_id, "type": self.types[sensor],
                        "studentCode": session["studentCode"],
                        "username": session["username"], "ts": captured_ms,
                        "source": "esp32", "status": "pending",
                    }
                if time.time() * 1000 - captured_ms >= EVENT_TTL_MS:
                    break
                try:
                    self.db("PUT", f"events/{tx_id}", event, {"if-match": "null_etag"})
                except (HTTPError, URLError, TimeoutError, OSError):
                    # A lost PUT response may mean it already committed. Rules may
                    # reject a repeated create before checking the ETag (401/403).
                    existing = self.db("GET", f"events/{tx_id}")
                    if not existing or any(existing.get(k) != event[k] for k in (
                            "txId", "binId", "ts", "type", "studentCode", "username")):
                        raise
                print(f"SENT {tx_id}: {event['type']} (accepted by database; scoring not confirmed)", flush=True)
                return True
            except (HTTPError, URLError, TimeoutError, OSError) as error:
                print("RETRY: " + error_message(error), flush=True)
                stop.wait(2)
        print(f"EXPIRED/CANCELLED {tx_id}: not confirmed sent.", flush=True)
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="ESP32 port, e.g. COM5")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="JSON file containing bin_id")
    parser.add_argument("--sensor1", choices=("plastic", "metal"), default="plastic")
    parser.add_argument("--sensor2", choices=("plastic", "metal"), default="metal")
    args = parser.parse_args()
    try:
        bin_id = load_bin_id(args.config)
    except (OSError, ValueError) as error:
        parser.error(f"Cannot load bin config: {error}")
    import serial

    bridge = FirebaseBridge(bin_id, args.sensor1, args.sensor2)
    bridge.check_bin()
    drops = queue.Queue(maxsize=100)
    stop = threading.Event()

    def sender():
        next_heartbeat = 0
        while not stop.is_set():
            if time.monotonic() >= next_heartbeat:
                try:
                    bridge.heartbeat()
                except (HTTPError, URLError, TimeoutError, OSError) as error:
                    print("HEARTBEAT: " + error_message(error), flush=True)
                next_heartbeat = time.monotonic() + 30
            try:
                sensor, captured_ms = drops.get(timeout=0.5)
            except queue.Empty:
                continue
            bridge.send_drop(sensor, captured_ms, stop)

    # Network runs separately so slow HTTP never blocks reading USB drops.
    with serial.Serial(args.port, 115200, timeout=1) as esp:
        worker = threading.Thread(target=sender, daemon=True)
        worker.start()
        print(f"Listening on {args.port} -> {bin_id}. Ctrl+C to stop.", flush=True)
        try:
            while True:
                if not worker.is_alive():
                    raise RuntimeError("HTTP sender stopped")
                line = esp.read_until(b"\n", 256).decode(errors="replace").strip()
                sensor = parse_drop(line)
                if sensor:
                    try:
                        drops.put_nowait((sensor, int(time.time() * 1000)))
                    except queue.Full:
                        print("QUEUE FULL: drop not recorded.", flush=True)
        finally:
            stop.set()
            worker.join(timeout=12)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped. Unsent drops in RAM are discarded.")
    except Exception as error:
        print("STOPPED: " + (error_message(error) if isinstance(error, (HTTPError, URLError)) else str(error)))
        raise SystemExit(1)
