const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const Jimp = require('jimp');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const DISEASE_LABELS = [
  'Acne',
  'Eczema',
  'Psoriasis',
  'Chickenpox',
  'Herpes Zoster',
  'Healthy Skin'
];

const RECOMMENDATIONS = {
  Acne: 'Possible acne detected. Use non-comedogenic skincare and seek medical guidance if worsening.',
  Eczema: 'Signs of eczema may be present. Keep skin moisturized and consult a dermatologist.',
  Psoriasis: 'Possible psoriasis pattern detected. Schedule a dermatology consultation for confirmation.',
  Chickenpox: 'Possible chickenpox-like rash detected. Isolate and seek immediate medical advice.',
  'Herpes Zoster': 'Possible shingles detected. Consult dermatologist.',
  'Healthy Skin': 'No clear disease indicators detected. Continue healthy skin care and monitoring.'
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.get('/', (_req, res) => {
  res.json({ message: 'Arogya Mantra backend is running.' });
});

const severityFromConfidence = (confidence) => {
  if (confidence >= 0.85) return 'moderate';
  if (confidence >= 0.7) return 'mild';
  return 'low';
};

const decodeImageBuffer = async (req) => {
  if (req.file?.buffer) return req.file.buffer;

  const encodedImage = req.body?.image;
  if (!encodedImage) return null;

  const rawBase64 = String(encodedImage).includes(',')
    ? String(encodedImage).split(',')[1]
    : String(encodedImage);

  return Buffer.from(rawBase64, 'base64');
};

const isSkinLikeImage = async (imageBuffer) => {
  const image = await Jimp.read(imageBuffer);
  const { data, width, height } = image.bitmap;

  if (!width || !height || width < 64 || height < 64) {
    return false;
  }

  let skinPixels = 0;
  const totalPixels = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const isSkinTone =
      r > 60 &&
      g > 40 &&
      b > 20 &&
      r > g &&
      r > b &&
      Math.abs(r - g) > 10;

    if (isSkinTone) skinPixels += 1;
  }

  const skinRatio = skinPixels / totalPixels;
  return skinRatio >= 0.12;
};

const mockPredictDisease = async (imageBuffer) => {
  const image = await Jimp.read(imageBuffer);
  image.resize(224, 224).greyscale();

  let brightnessSum = 0;
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function scan(_x, _y, idx) {
    brightnessSum += this.bitmap.data[idx];
  });

  const avgBrightness = brightnessSum / (224 * 224);
  const normalized = avgBrightness / 255;

  const classIndex = Math.min(
    DISEASE_LABELS.length - 1,
    Math.floor(normalized * DISEASE_LABELS.length)
  );

  const disease = DISEASE_LABELS[classIndex];
  const confidence = Number((0.72 + normalized * 0.24).toFixed(2));

  return {
    disease,
    confidence,
    severity: severityFromConfidence(confidence),
    recommendation: RECOMMENDATIONS[disease]
  };
};

app.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    const imageBuffer = await decodeImageBuffer(req);

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({
        valid: false,
        message: 'Image is required'
      });
    }

    let validSkinImage = false;
    try {
      validSkinImage = await isSkinLikeImage(imageBuffer);
    } catch (_error) {
      return res.status(400).json({
        valid: false,
        message: 'Invalid input: Please upload a skin-related image'
      });
    }

    if (!validSkinImage) {
      return res.status(200).json({
        valid: false,
        message: 'Invalid input: Please upload a skin-related image'
      });
    }

    const prediction = await mockPredictDisease(imageBuffer);

    return res.json({
      valid: true,
      disease: prediction.disease,
      confidence: prediction.confidence,
      severity: prediction.severity,
      recommendation: prediction.recommendation
    });
  } catch (error) {
    console.error('Analyze endpoint error:', error);
    return res.status(500).json({
      valid: false,
      message: 'Failed to analyze image'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
