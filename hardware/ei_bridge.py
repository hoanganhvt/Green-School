"""
Green School — cầu nối camera máy tính (Edge Impulse) ↔ ESP32
--------------------------------------------------------------
Chạy mô hình .eim đã huấn luyện trên Edge Impulse bằng camera máy tính.
Khi nhận diện chắc chắn "plastic" hoặc "metal" vài khung hình liên tiếp,
gửi nhãn xuống ESP32 qua cổng Serial để ESP32 mở nắp, bật LED, xác nhận
rác rơi vào thùng và gửi sự kiện lên Firebase.

Cài đặt:
    python -m pip install -r hardware/requirements-ei.txt  (từ thư mục gốc dự án)
    edge-impulse-linux-runner --download model.eim     (tải mô hình của nhóm)

Chạy:
    python ei_bridge.py model.eim /dev/tty.usbserial-0001   (macOS)
    python ei_bridge.py model.eim COM5                      (Windows)

Đây là code THAM KHẢO cho luồng firmware cũ đã bị xóa.
Firmware chính hardware/Green-School/Green-School.ino chưa nhận các nhãn phân loại qua Serial;
script này chưa tích hợp với firmware chính và chưa gửi sự kiện lên Firebase.
"""
import sys
import time

import serial
from edge_impulse_linux.image import ImageImpulseRunner

LABELS = {"plastic", "metal"}   # nhãn trong mô hình Edge Impulse
THRESHOLD = 0.80                # độ tin cậy tối thiểu
STABLE_FRAMES = 4               # số khung hình liên tiếp phải giống nhau
COOLDOWN_S = 6                  # nghỉ sau mỗi lượt để không gửi trùng
CAMERA_ID = 0                   # camera mặc định của máy tính


def best_label(result):
    """Trả về (nhãn, độ tin cậy) tốt nhất cho cả mô hình phân loại lẫn phát hiện vật thể."""
    r = result.get("result", {})
    if "classification" in r:
        label, score = max(r["classification"].items(), key=lambda kv: kv[1])
        return label.lower(), score
    boxes = r.get("bounding_boxes") or []
    if boxes:
        b = max(boxes, key=lambda x: x["value"])
        return b["label"].lower(), b["value"]
    return None, 0.0


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    model_path, port = sys.argv[1], sys.argv[2]
    esp = serial.Serial(port, 115200, timeout=1)
    time.sleep(2)  # ESP32 khởi động lại khi mở cổng

    with ImageImpulseRunner(model_path) as runner:
        info = runner.init()
        print("Mô hình:", info["project"]["name"], "| nhãn:", info["model_parameters"]["labels"])
        streak_label, streak = None, 0
        last_sent = 0.0
        for res, _img in runner.classifier(CAMERA_ID):
            label, score = best_label(res)
            if label in LABELS and score >= THRESHOLD:
                streak = streak + 1 if label == streak_label else 1
                streak_label = label
            else:
                streak_label, streak = None, 0

            if streak >= STABLE_FRAMES and time.time() - last_sent > COOLDOWN_S:
                esp.write((streak_label + "\n").encode())
                print(f"→ ESP32: {streak_label} ({score:.2f})")
                last_sent = time.time()
                streak_label, streak = None, 0

            while esp.in_waiting:  # in log từ ESP32 để dễ gỡ lỗi
                print("ESP32:", esp.readline().decode(errors="ignore").strip())


if __name__ == "__main__":
    main()
