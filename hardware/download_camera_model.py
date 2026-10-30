"""Download the pinned WasteWise artifact and verify its checksum (no hardware access)."""

import hashlib
import os
from pathlib import Path
from urllib.request import urlopen

REVISION = "a30c36c6b181ac0d2eb387bbd4f6d4a5b88ee078"
SHA256 = "2b46d491091dbc0ed98a0f1eaee7fe5739c8fd3eb5bd5935396c3b2712e1f7a6"
MODEL_PATH = Path(__file__).with_name("models") / "wastewise-yolo.onnx"
URL = ("https://huggingface.co/SriramRokkam/wastewise-garbage-cls/resolve/"
       + REVISION + "/wastewise-yolo.onnx")


def verify_model(path):
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if digest != SHA256:
        raise ValueError("Model checksum mismatch; run hardware/download_camera_model.py")


def main():
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.exists():
        verify_model(MODEL_PATH)
        print("Verified:", MODEL_PATH)
        return
    temporary = MODEL_PATH.with_suffix(".download")
    try:
        with urlopen(URL, timeout=60) as response, temporary.open("wb") as target:
            size = 0
            while chunk := response.read(65536):
                size += len(chunk)
                if size > 10_000_000:
                    raise ValueError("Unexpected model size")
                target.write(chunk)
        verify_model(temporary)
        os.replace(temporary, MODEL_PATH)
    finally:
        temporary.unlink(missing_ok=True)
    print("Downloaded and verified:", MODEL_PATH)


if __name__ == "__main__":
    main()
