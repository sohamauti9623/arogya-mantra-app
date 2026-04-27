from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image

ROOT = Path(__file__).resolve().parent
ARTIFACTS_DIR = ROOT / "artifacts"
MODEL_PATH = next((ARTIFACTS_DIR / f for f in ['skin_disease_model.keras', 'skin_disease_model.h5'] if (ARTIFACTS_DIR / f).exists()), ARTIFACTS_DIR / 'skin_disease_model.keras')
MAPPING_PATH = ARTIFACTS_DIR / "class_mapping.json"


def load_mapping() -> list[str]:
    if MAPPING_PATH.exists():
        mapping = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
        return [mapping[str(i)] if str(i) in mapping else mapping[i] for i in range(len(mapping))]
    return ["Acne", "Eczema", "Psoriasis", "Chickenpox", "Herpes Zoster", "Healthy Skin"]


def preprocess(image_path: Path) -> np.ndarray:
    with Image.open(image_path).convert("RGB") as img:
        img = img.resize((224, 224))
        arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.expand_dims(arr, axis=0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    args = parser.parse_args()

    image_path = Path(args.image)
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")

    model = tf.keras.models.load_model(MODEL_PATH)
    class_names = load_mapping()

    batch = preprocess(image_path)
    probs = model.predict(batch, verbose=0)[0]

    top_idx = int(np.argmax(probs))
    disease = class_names[top_idx]
    confidence = float(probs[top_idx])

    print(json.dumps({"disease": disease, "confidence": round(confidence, 4)}))


if __name__ == "__main__":
    main()
