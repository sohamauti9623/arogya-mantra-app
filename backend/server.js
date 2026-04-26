const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const Jimp = require('jimp');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

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

const rgbToHsv = (r, g, b) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
};

const isSkinLikeImage = async (imageBuffer) => {
  const image = await Jimp.read(imageBuffer);
  image.resize(224, 224);

  const { data, width, height } = image.bitmap;
  if (!width || !height) return false;

  let skinPixels = 0;
  const totalPixels = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const { h, s, v } = rgbToHsv(r, g, b);

    const rgbRule = r > 40 && g > 20 && b > 10 && r > g && r > b && Math.abs(r - g) > 8;
    const hsvRule = h >= 0 && h <= 50 && s >= 0.12 && s <= 0.68 && v >= 0.2;

    if (rgbRule && hsvRule) skinPixels += 1;
  }

  const skinRatio = skinPixels / totalPixels;
  return skinRatio >= 0.18;
};


const heuristicPredictDisease = async (imageBuffer) => {
  const image = await Jimp.read(imageBuffer);
  image.resize(224, 224);

  const { data, width, height } = image.bitmap;
  const totalPixels = width * height;

  let redInflammation = 0;
  let crustPixels = 0;
  let brightVesiclePixels = 0;
  let dryPlaquePixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r > 135 && g < 110 && b < 120) redInflammation += 1;
    if (r > 120 && g < 80 && b < 80) crustPixels += 1;
    if (r > 170 && g > 130 && b > 130) brightVesiclePixels += 1;
    if (r > 140 && g > 120 && b > 110 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18) dryPlaquePixels += 1;
  }

  const inflamedRatio = redInflammation / totalPixels;
  const crustRatio = crustPixels / totalPixels;
  const vesicleRatio = brightVesiclePixels / totalPixels;
  const plaqueRatio = dryPlaquePixels / totalPixels;

  if (inflamedRatio > 0.18 && crustRatio > 0.015) {
    return { disease: 'Herpes Zoster', confidence: 0.78 };
  }
  if (inflamedRatio > 0.16 && vesicleRatio > 0.07) {
    return { disease: 'Chickenpox', confidence: 0.73 };
  }
  if (inflamedRatio > 0.13 && plaqueRatio > 0.12) {
    return { disease: 'Psoriasis', confidence: 0.7 };
  }
  if (inflamedRatio > 0.1) {
    return { disease: 'Eczema', confidence: 0.66 };
  }

  return { disease: 'Healthy Skin', confidence: 0.64 };
};

const runPythonInference = async (imageBuffer) => {
  const tmpPath = path.join(os.tmpdir(), `skin_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  const scriptPath = path.join(__dirname, 'ml', 'infer.py');

  await fs.writeFile(tmpPath, imageBuffer);

  try {
    const pythonBin = process.env.PYTHON_BIN || 'python3';

    const payload = await new Promise((resolve, reject) => {
      const proc = spawn(pythonBin, [scriptPath, '--image', tmpPath], {
        cwd: __dirname,
        env: process.env
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Inference process failed with code ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (_e) {
          reject(new Error('Inference returned invalid JSON'));
        }
      });
    });

    return payload;
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
};

app.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    const imageBuffer = await decodeImageBuffer(req);

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ valid: false, message: 'Image is required' });
    }

    const validSkinImage = await isSkinLikeImage(imageBuffer).catch(() => false);
    if (!validSkinImage) {
      return res.status(200).json({
        valid: false,
        message: 'Invalid input: Please upload a skin-related image'
      });
    }

    let prediction;
    try {
      prediction = await runPythonInference(imageBuffer);
    } catch (inferenceError) {
      console.warn('Python inference unavailable, using heuristic fallback:', inferenceError.message);
      prediction = await heuristicPredictDisease(imageBuffer);
    }

    const disease = prediction?.disease;
    const confidence = Number(prediction?.confidence || 0);

    if (!disease || Number.isNaN(confidence)) {
      throw new Error('Model inference output missing fields');
    }

    return res.json({
      valid: true,
      disease,
      confidence,
      severity: severityFromConfidence(confidence),
      recommendation: RECOMMENDATIONS[disease] || 'Consult a dermatologist for diagnosis confirmation.'
    });
  } catch (error) {
    console.error('Analyze endpoint error:', error);
    return res.status(500).json({
      valid: false,
      message: 'Analysis failed. Please try again with a clearer skin image.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
