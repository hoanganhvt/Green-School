# WasteWise ONNX artifact

Source: [SriramRokkam/wastewise-garbage-cls](https://huggingface.co/SriramRokkam/wastewise-garbage-cls).

- Revision: `a30c36c6b181ac0d2eb387bbd4f6d4a5b88ee078`.
- File: `wastewise-yolo.onnx` (about 5.81 MB), included in the repository.
- SHA-256: `2b46d491091dbc0ed98a0f1eaee7fe5739c8fd3eb5bd5935396c3b2712e1f7a6`.
- Verified input: `images`, float32 `[1,3,224,224]`; output: `output0`, probabilities `[1,8]`.
- Verified metadata labels: battery, biological, cardboard, glass, metal, paper, plastic, trash.
- Metadata: classify, Ultralytics YOLOv8n-cls 8.4.46, ONNX export opset argument 12. The card says opset 17; runtime relies on the verified artifact, not that claim.
- Preprocessing follows the author's RGB / 255 / NCHW example. The camera script center-crops the ROI before resize.

From the project root:

```powershell
.\.venv\Scripts\python.exe hardware/download_camera_model.py
.\.venv\Scripts\python.exe hardware/camera_ai.py --check-model
.\.venv\Scripts\python.exe hardware/camera_ai.py --image C:/images/sample.jpg
```

The downloader verifies the existing file without downloading it again; if missing, it downloads and verifies the pinned artifact before replacing the model file. Startup verifies it again. Nothing is downloaded automatically at inference time. To replace the model, deliberately review labels, preprocessing, output and licensing and update the pinned revision/checksum and tests together; arbitrary ONNX files are refused.

## Licensing discrepancy

The repository card declares **Apache-2.0**, while this artifact's own metadata declares **AGPL-3.0** and links to the [Ultralytics license](https://www.ultralytics.com/license). These claims conflict. We have recorded both and do not assert that redistribution or proprietary use is Apache-licensed. Clarify applicable terms with the publisher before redistribution/commercial deployment.

## What was checked

The downloaded graph loads and runs on ONNX Runtime CPU, with the expected labels/shapes and finite normalized output on a synthetic image. This is an inference smoke test, not an accuracy evaluation. No camera accuracy claim or latency guarantee is made for another machine. The publisher's validation score is not the project's measured real-camera accuracy.

# Edge Impulse FOMO artifact (optional, `--model-type edge-impulse`)

Source: Edge Impulse public project [1129782 "thùng rác thông ming"](https://studio.edgeimpulse.com/public/1129782/live) by BaoHan, licensed **BSD-3-Clause**. Exported from a clone of that project as *Object detection model → TensorFlow Lite (float32)*.

- `trash_detection.lite`: original export, SHA-256 `7f30049f8d87d7fc4d5a83bb94024cb2a3a0b779006678297d8cb33fcfefec5f`.
- `ei-trash-fomo.onnx`: converted by `hardware/convert_ei_model.py`, SHA-256 pinned as `EI_SHA256` in `camera_ai.py`.
- Input: RGB `[1,3,96,96]` float32, pixels / 255. The camera script center-crops the ROI before resize.
- Output: FOMO grid `[1,3,12,12]`, per-cell softmax over `_background`, `kim loại` (metal), `rác nhựa` (plastic). The strongest metal/plastic cell is the prediction; below 0.5 it reports `background`.
- Conversion check: on 20 random inputs the ONNX output matched the TFLite interpreter (LiteRT) within 3e-7. The converter left Softmax on the width axis after NHWC→NCHW; the script moves it to the class axis.

Edge Impulse's own validation (float32): every labelled cell correct, but on only **33 validation images (7 metal, 26 plastic)** taken from the same 201-item dataset, int8 missed 2 of 28 plastic cells. There are no negative classes (hands, paper, other trash), so test on the real bin before using it with students. To retrain: export the TFLite float32 again, run the converter (`pip install tflite2onnx onnx` in any Python), update `EI_SHA256`, then run the tests. Each conversion produces a different checksum.
