"""Convert an Edge Impulse FOMO TFLite (float32) export to the ONNX file camera_ai.py runs.

One-time tool, not needed at runtime. Install the converter in any Python first:
    python -m pip install tflite2onnx onnx
Then, from the project root:
    python hardware/convert_ei_model.py hardware/models/trash_detection.lite

Afterwards update EI_SHA256 in camera_ai.py with the printed checksum and re-run the tests.
"""

import hashlib
import sys
from pathlib import Path

LABELS = ('_background', 'kim loại', 'rác nhựa')
OUTPUT = Path(__file__).with_name('models') / 'ei-trash-fomo.onnx'


def main():
    import onnx
    import tflite2onnx
    source = Path(sys.argv[1] if len(sys.argv) > 1 else OUTPUT.with_name('trash_detection.lite'))
    tflite2onnx.convert(str(source), str(OUTPUT))
    model = onnx.load(str(OUTPUT))
    # tflite2onnx turns NHWC into NCHW but keeps Softmax axis -1, which then normalizes over
    # width instead of the class channel. Opset 13 Softmax normalizes exactly one axis.
    for node in model.graph.node:
        if node.op_type == 'Softmax':
            del node.attribute[:]
            node.attribute.append(onnx.helper.make_attribute('axis', 1))
    model.opset_import[0].version = 13
    del model.metadata_props[:]
    for key, value in {'task': 'fomo', 'names': repr(dict(enumerate(LABELS))),
                       'source': 'Edge Impulse project 1129782 (BaoHan)',
                       'license': 'BSD-3-Clause',
                       'tflite_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}.items():
        model.metadata_props.add(key=key, value=value)
    onnx.checker.check_model(model, full_check=True)
    onnx.save(model, str(OUTPUT))
    print('Saved', OUTPUT, 'sha256', hashlib.sha256(OUTPUT.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
