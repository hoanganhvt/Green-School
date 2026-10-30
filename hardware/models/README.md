# WasteWise ONNX artifact

Source: [SriramRokkam/wastewise-garbage-cls](https://huggingface.co/SriramRokkam/wastewise-garbage-cls).

- Revision: `a30c36c6b181ac0d2eb387bbd4f6d4a5b88ee078`.
- File: `wastewise-yolo.onnx` (about 5.81 MB), ignored by Git.
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

The downloader verifies checksum before replacing the model file, and startup verifies it again. Nothing is downloaded automatically at inference time. To replace the model, deliberately review labels, preprocessing, output and licensing and update the pinned revision/checksum and tests together; arbitrary ONNX files are refused.

## Licensing discrepancy

The repository card declares **Apache-2.0**, while this artifact's own metadata declares **AGPL-3.0** and links to the [Ultralytics license](https://www.ultralytics.com/license). These claims conflict. We have recorded both and do not assert that redistribution or proprietary use is Apache-licensed. Clarify applicable terms with the publisher before redistribution/commercial deployment. This repo includes a verified downloader rather than committing the third-party weights.

## What was checked

The downloaded graph loads and runs on ONNX Runtime CPU, with the expected labels/shapes and finite normalized output on a synthetic image. This is an inference smoke test, not an accuracy evaluation. No camera accuracy claim or latency guarantee is made for another machine. The publisher's validation score is not the project's measured real-camera accuracy.
