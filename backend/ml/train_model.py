"""Training pipeline for six-class skin disease classification."""

from __future__ import annotations

import json
import pickle
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image, UnidentifiedImageError
from sklearn.utils.class_weight import compute_class_weight
from tensorflow.keras import layers, models
from tensorflow.keras.applications import EfficientNetB0, MobileNetV2
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint

ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = ROOT / "dataset"
ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
EPOCHS = 15
VALIDATION_SPLIT = 0.2
SEED = 42

CLASS_NAMES = [
    "acne",
    "eczema",
    "psoriasis",
    "chickenpox",
    "herpes_zoster",
    "healthy_skin",
]

DISPLAY_NAMES = {
    "acne": "Acne",
    "eczema": "Eczema",
    "psoriasis": "Psoriasis",
    "chickenpox": "Chickenpox",
    "herpes_zoster": "Herpes Zoster",
    "healthy_skin": "Healthy Skin",
}


def remove_corrupted_images(dataset_dir: Path) -> int:
    removed = 0
    for img_path in dataset_dir.rglob("*"):
        if not img_path.is_file() or img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
            continue
        try:
            with Image.open(img_path) as img:
                img.verify()
        except (UnidentifiedImageError, OSError, ValueError):
            img_path.unlink(missing_ok=True)
            removed += 1
    return removed


def build_datasets(dataset_dir: Path):
    train_ds = tf.keras.utils.image_dataset_from_directory(
        dataset_dir,
        labels="inferred",
        label_mode="categorical",
        class_names=CLASS_NAMES,
        image_size=IMAGE_SIZE,
        color_mode="rgb",
        batch_size=BATCH_SIZE,
        shuffle=True,
        validation_split=VALIDATION_SPLIT,
        subset="training",
        seed=SEED,
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        dataset_dir,
        labels="inferred",
        label_mode="categorical",
        class_names=CLASS_NAMES,
        image_size=IMAGE_SIZE,
        color_mode="rgb",
        batch_size=BATCH_SIZE,
        shuffle=False,
        validation_split=VALIDATION_SPLIT,
        subset="validation",
        seed=SEED,
    )
    return train_ds, val_ds


def compute_weights(train_ds):
    y_indices = np.concatenate([np.argmax(batch_y.numpy(), axis=1) for _, batch_y in train_ds], axis=0)
    classes = np.unique(y_indices)
    weights = compute_class_weight(class_weight="balanced", classes=classes, y=y_indices)
    return {int(k): float(v) for k, v in zip(classes, weights)}


def build_model(backbone_name: str = "mobilenetv2") -> tuple[tf.keras.Model, tf.keras.Model]:
    data_augmentation = tf.keras.Sequential(
        [
            layers.RandomRotation(0.11),
            layers.RandomFlip("horizontal"),
            layers.RandomZoom(height_factor=(-0.2, 0.2), width_factor=(-0.2, 0.2)),
            layers.RandomBrightness(0.2),
        ],
        name="data_augmentation",
    )

    inputs = layers.Input(shape=(224, 224, 3))
    x = data_augmentation(inputs)
    x = layers.Rescaling(1.0 / 255)(x)

    if backbone_name.lower() == "efficientnetb0":
        base_model = EfficientNetB0(include_top=False, weights="imagenet", input_shape=(224, 224, 3))
    else:
        base_model = MobileNetV2(include_top=False, weights="imagenet", input_shape=(224, 224, 3))

    base_model.trainable = False
    x = base_model(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.25)(x)
    outputs = layers.Dense(len(CLASS_NAMES), activation="softmax")(x)
    model = models.Model(inputs=inputs, outputs=outputs)

    model.compile(optimizer=tf.keras.optimizers.Adam(), loss="categorical_crossentropy", metrics=["accuracy"])
    return model, base_model


def fine_tune(model: tf.keras.Model, base_model: tf.keras.Model, unfreeze_from: int = -20):
    base_model.trainable = True
    for layer in base_model.layers[:unfreeze_from]:
        layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )


def save_artifacts(model: tf.keras.Model):
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    model.save(ARTIFACTS_DIR / "skin_disease_model.h5")

    class_mapping = {idx: DISPLAY_NAMES[name] for idx, name in enumerate(CLASS_NAMES)}
    (ARTIFACTS_DIR / "class_mapping.json").write_text(json.dumps(class_mapping, indent=2), encoding="utf-8")
    (ARTIFACTS_DIR / "label_encoder.pkl").write_bytes(pickle.dumps(CLASS_NAMES))


def main():
    removed = remove_corrupted_images(DATASET_DIR)
    print(f"Removed corrupted images: {removed}")

    train_ds, val_ds = build_datasets(DATASET_DIR)
    train_ds = train_ds.prefetch(tf.data.AUTOTUNE)
    val_ds = val_ds.prefetch(tf.data.AUTOTUNE)

    class_weights = compute_weights(train_ds)
    print("Class weights:", class_weights)

    model, base_model = build_model(backbone_name="mobilenetv2")

    ckpt_path = ARTIFACTS_DIR / "best_checkpoint.keras"
    callbacks = [
        EarlyStopping(monitor="val_accuracy", patience=4, restore_best_weights=True),
        ModelCheckpoint(ckpt_path, monitor="val_accuracy", save_best_only=True),
    ]

    model.fit(train_ds, validation_data=val_ds, epochs=10, class_weight=class_weights, callbacks=callbacks)

    fine_tune(model, base_model)
    model.fit(train_ds, validation_data=val_ds, epochs=EPOCHS, class_weight=class_weights, callbacks=callbacks)

    save_artifacts(model)
    print("Saved model and label artifacts to", ARTIFACTS_DIR)


if __name__ == "__main__":
    main()
