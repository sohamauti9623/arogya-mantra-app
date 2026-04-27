# Skin Disease ML Pipeline

## Dataset structure

Place training data at project root:

- `dataset/acne`
- `dataset/eczema`
- `dataset/psoriasis`
- `dataset/chickenpox`
- `dataset/herpes_zoster`
- `dataset/healthy_skin`

> Keep **herpes_zoster** and **chickenpox** as separate classes.

## Balancing guidance

Aim for similar image counts per class. If data is imbalanced, training uses class weights automatically.

## Training

```bash
cd backend
python ml/train_model.py
```

With Colab/local GPU, you can tune training:

```bash
python ml/train_model.py --backbone efficientnetb0 --warmup-epochs 12 --finetune-epochs 20 --unfreeze-from -30
```

Training now also writes `backend/ml/artifacts/metrics_report.json` with confusion matrix + per-class precision/recall/F1.

## Inference used by API

`server.js` executes:

```bash
python ml/infer.py --image /tmp/input.jpg
```

Make sure the artifacts exist in `backend/ml/artifacts/`:

- `skin_disease_model.h5`
- `label_encoder.pkl`
- `class_mapping.json`
