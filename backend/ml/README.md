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

## Inference used by API

`server.js` executes:

```bash
python ml/infer.py --image /tmp/input.jpg
```

Make sure the artifacts exist in `backend/ml/artifacts/`:

- `skin_disease_model.h5`
- `label_encoder.pkl`
- `class_mapping.json`
