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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_ENDPOINT = process.env.GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta';

const RECOMMENDATIONS = {
  Acne: 'Possible acne detected. Use non-comedogenic skincare and seek medical guidance if worsening.',
  Eczema: 'Signs of eczema may be present. Keep skin moisturized and consult a dermatologist.',
  Psoriasis: 'Possible psoriasis pattern detected. Schedule a dermatology consultation for confirmation.',
  Chickenpox: 'Possible chickenpox-like rash detected. Isolate and seek immediate medical advice.',
  'Herpes Zoster': 'Possible shingles detected. Consult dermatologist immediately.',
  'Healthy Skin': 'No clear disease indicators detected. Continue healthy skin care and monitoring.'
};

const VALID_CONDITIONS = new Set([
  'Acne',
  'Eczema',
  'Psoriasis',
  'Chickenpox',
  'Herpes Zoster',
  'Healthy Skin'
]);
const LOW_CONFIDENCE_HEALTHY_THRESHOLD = 0.8;

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
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.7) return 'moderate';
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
  let shinglesVesiclePixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r > 135 && g < 110 && b < 120) redInflammation += 1;
    // Broadened: includes dark-red AND orange-brown crusts common in shingles
    if ((r > 110 && g < 95 && b < 100 && r > g + 20) ||
        (r > 120 && g < 80 && b < 80)) crustPixels += 1;
    // Shingles vesicles: bright pink/red-tinged blisters
    if (r > 160 && g > 100 && b > 90 && r > g + 30) shinglesVesiclePixels += 1;
    if (r > 170 && g > 130 && b > 130) brightVesiclePixels += 1;
    if (r > 140 && g > 120 && b > 110 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18) dryPlaquePixels += 1;
  }

  const inflamedRatio = redInflammation / totalPixels;
  const crustRatio = crustPixels / totalPixels;
  const vesicleRatio = brightVesiclePixels / totalPixels;
  const plaqueRatio = dryPlaquePixels / totalPixels;
  const shinglesVesicleRatio = shinglesVesiclePixels / totalPixels;

  // Shingles: inflamed + crust pixels OR inflamed + pink vesicle clusters
  if (inflamedRatio > 0.12 && (crustRatio > 0.025 || shinglesVesicleRatio > 0.04)) {
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

const reconcileLowConfidenceHealthyPrediction = async ({ imageBuffer, prediction }) => {
  const mlCondition = prediction?.disease;
  const mlConfidence = Number(prediction?.confidence || 0);

  if (mlCondition !== 'Healthy Skin' || Number.isNaN(mlConfidence) || mlConfidence >= LOW_CONFIDENCE_HEALTHY_THRESHOLD) {
    return { prediction, overridden: false };
  }

  const heuristic = await heuristicPredictDisease(imageBuffer);
  if (heuristic.disease !== 'Healthy Skin' && heuristic.confidence >= 0.7) {
    return { prediction: heuristic, overridden: true };
  }

  return { prediction, overridden: false };
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

      proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

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

// Gemini-primary classification — used when Python ML is unavailable
const runGeminiPrimaryClassification = async (imageBuffer) => {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;

  const primaryPrompt = `You are an expert dermatologist AI. Analyze this skin image and classify the condition.

You MUST return ONLY a valid JSON object — no markdown, no explanation outside the JSON.

Choose final_condition from EXACTLY one of these options:
- "Acne" — comedones, pustules, whiteheads on face/back/chest
- "Eczema" — dry, inflamed, itchy patches; often in skin folds
- "Psoriasis" — thick silvery scales on well-defined red plaques
- "Chickenpox" — widespread itchy blisters scattered all over the body (bilateral)
- "Herpes Zoster" — unilateral stripe/band of blisters on ONE side of body or face; dermatomal pattern
- "Healthy Skin" — no visible disease

Critical distinction: Herpes Zoster = ONE side only, localized stripe. Chickenpox = all over body.

Return ONLY this JSON:
{
  "final_condition": "",
  "confidence": "85%",
  "severity": "moderate",
  "explanation": "What you see in the image in 1-2 sentences",
  "recommendation": "Specific advice for this condition"
}`;

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: primaryPrompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageBuffer.toString('base64') } }
          ]
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
      })
    });

    if (!response.ok) return null;
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = parseGeminiJson(text);
    if (!parsed?.final_condition) return null;

    console.log('Gemini primary classification:', parsed.final_condition, parsed.confidence);
    return parsed;
  } catch (e) {
    console.warn('Gemini primary classification failed:', e.message);
    return null;
  }
};

const geminiPrompt = ({ condition, confidence }) => `You are a dermatology AI assistant analyzing a skin image.

ML model predicted: ${condition} (confidence: ${confidence})

You MUST select final_condition from ONLY these exact options:
- "Acne" — comedones, whiteheads, pustules typically on face/back/chest
- "Eczema" — dry, itchy, inflamed patches; often in skin folds
- "Psoriasis" — thick silvery-white scales on well-defined red plaques
- "Chickenpox" — widespread itchy blisters scattered across the ENTIRE body bilaterally
- "Herpes Zoster" — unilateral band or stripe of fluid-filled blisters on ONE side of body or face; may have crusting or redness; critically different from chickenpox which is bilateral/scattered
- "Healthy Skin" — no visible disease indicators

Key distinction: Shingles (Herpes Zoster) appears as a localized stripe/cluster on ONE side only. If you see a localized cluster of blisters with redness or crusting on one side, prefer Herpes Zoster over Chickenpox.

Tasks:
1. Look at the image carefully and validate whether the ML prediction makes sense
2. If the image shows a unilateral blister stripe or dermatomal pattern, override to Herpes Zoster
3. Provide severity: low, moderate, or high
4. Provide a clear explanation of what you see
5. Provide specific care recommendations

Return ONLY valid JSON with exactly these keys:
{
  "final_condition": "",
  "confidence": "",
  "severity": "",
  "explanation": "",
  "recommendation": ""
}`;

const safeGeminiFallback = (mlPrediction) => {
  const confidencePct = Math.round(mlPrediction.confidence * 100);
  return {
    final_condition: mlPrediction.disease,
    confidence: `${confidencePct}% (ML estimate)`,
    severity: severityFromConfidence(mlPrediction.confidence),
    explanation: `Primary CNN pattern match suggests ${mlPrediction.disease}. This automated output should be clinically confirmed.`,
    recommendation: RECOMMENDATIONS[mlPrediction.disease] || 'Consult a dermatologist for diagnosis confirmation.'
  };
};

const parseGeminiJson = (rawText) => {
  const trimmed = rawText.trim();
  const codeblockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeblockMatch ? codeblockMatch[1] : trimmed;
  return JSON.parse(candidate);
};

const confidenceFromText = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1 ? Math.min(Math.max(value / 100, 0), 1) : Math.min(Math.max(value, 0), 1);
  }

  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (normalized.includes('high')) return 0.9;
  if (normalized.includes('medium') || normalized.includes('moderate')) return 0.75;
  if (normalized.includes('low')) return 0.55;

  const percentMatch = normalized.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) return Math.min(Math.max(Number(percentMatch[1]) / 100, 0), 1);

  const decimalMatch = normalized.match(/(\d+(?:\.\d+)?)/);
  if (decimalMatch) {
    const parsed = Number(decimalMatch[1]);
    if (Number.isFinite(parsed)) {
      return parsed > 1 ? Math.min(Math.max(parsed / 100, 0), 1) : Math.min(Math.max(parsed, 0), 1);
    }
  }

  return null;
};

const normalizeSeverity = (value, fallbackConfidence) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('high') || normalized.includes('severe')) return 'high';
  if (normalized.includes('moderate') || normalized.includes('medium')) return 'moderate';
  if (normalized.includes('low') || normalized.includes('mild')) return 'low';
  return severityFromConfidence(fallbackConfidence);
};

const runGeminiReasoning = async ({ imageBuffer, mlPrediction }) => {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return {
      ...safeGeminiFallback(mlPrediction),
      reasoning_source: 'fallback_no_api_key'
    };
  }

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: geminiPrompt({ condition: mlPrediction.disease, confidence: mlPrediction.confidence }) },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: imageBuffer.toString('base64')
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status}`);
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini empty response');

    const parsed = parseGeminiJson(text);

    return {
      final_condition: String(parsed.final_condition || mlPrediction.disease),
      confidence: parsed.confidence ?? `${Math.round(mlPrediction.confidence * 100)}%`,
      severity: normalizeSeverity(parsed.severity, mlPrediction.confidence),
      explanation: String(parsed.explanation || ''),
      recommendation: String(parsed.recommendation || RECOMMENDATIONS[mlPrediction.disease]),
      reasoning_source: 'gemini'
    };
  } catch (error) {
    console.warn('Gemini reasoning unavailable, using fallback:', error.message);
    return {
      ...safeGeminiFallback(mlPrediction),
      reasoning_source: 'fallback_error'
    };
  }
};

const normalizeFinalCondition = (text, mlDisease) => {
  if (!text) return mlDisease;

  for (const condition of VALID_CONDITIONS) {
    if (text.toLowerCase().includes(condition.toLowerCase())) {
      return condition;
    }
  }

  return mlDisease;
};

const buildChatPrompt = ({ question, recentMessages, latestAnalysis }) => {
  const safeQuestion = String(question || '').trim();
  const contextMessages = Array.isArray(recentMessages)
    ? recentMessages
      .slice(-6)
      .map((msg) => `${msg?.role === 'user' ? 'User' : 'Assistant'}: ${String(msg?.text || '').slice(0, 400)}`)
      .join('\n')
    : '';

  const analysisContext = latestAnalysis
    ? `Latest skin analysis summary:
- Condition: ${latestAnalysis.condition || 'Unknown'}
- Confidence: ${latestAnalysis.confidence || 'Unknown'}
- Severity: ${latestAnalysis.severity || 'Unknown'}
- Advice: ${latestAnalysis.advice || 'N/A'}
- Explanation: ${latestAnalysis.explanation || 'N/A'}`
    : 'No recent skin analysis data available.';

  return `You are Arogya Mitra, a concise and empathetic skin-health assistant.
Rules:
1) Keep response under 130 words unless user asks for detail.
2) Never claim confirmed diagnosis; use cautious wording.
3) If symptoms appear serious, advise in-person dermatologist care.
4) Provide practical, safe next steps.
5) If user asks unrelated topics, gently redirect to skin health.

Conversation context:
${contextMessages || 'No previous chat context.'}

${analysisContext}

User question:
${safeQuestion}`;
};

const fallbackChatReply = (question) => {
  const q = String(question || '').toLowerCase();
  if (q.includes('eczema')) {
    return 'Eczema often causes dry, itchy, inflamed patches. Use fragrance-free moisturizer, avoid harsh soaps, and seek medical care if rash spreads, cracks, or shows infection signs.';
  }
  if (q.includes('acne')) {
    return 'For acne, cleanse gently twice daily, avoid picking lesions, and use non-comedogenic products. If painful cysts or scarring appear, consult a dermatologist for targeted treatment.';
  }
  if (q.includes('sunburn')) {
    return 'For mild sunburn, cool compresses, hydration, aloe-based moisturizer, and sun avoidance can help. Seek urgent care for blistering over large areas, fever, or severe pain.';
  }
  return 'I can help with skin-health questions (symptoms, care tips, warning signs). Share your concern and I will suggest safe next steps, but this is not a medical diagnosis.';
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
    let heuristicOverrideUsed = false;
    let inferenceSource = 'ml_python';

    try {
      prediction = await runPythonInference(imageBuffer);
      console.log('Python ML inference succeeded:', prediction);
    } catch (inferenceError) {
      console.warn('Python ML unavailable:', inferenceError.message);

      // Try Gemini as primary classifier first
      const geminiPrimary = await runGeminiPrimaryClassification(imageBuffer);
      if (geminiPrimary && geminiPrimary.final_condition) {
        inferenceSource = 'gemini_primary';
        const conf = parseFloat(String(geminiPrimary.confidence).replace('%','')) / 100 || 0.82;
        // Return full result directly from Gemini — skip second Gemini call
        const finalCondition = normalizeFinalCondition(geminiPrimary.final_condition, 'Unknown');
        return res.json({
          valid: true,
          condition: finalCondition,
          confidence: conf,
          severity: normalizeSeverity(geminiPrimary.severity, conf),
          source: 'Gemini AI Vision (direct classification)',
          advice: geminiPrimary.recommendation || RECOMMENDATIONS[finalCondition] || 'Consult a dermatologist.',
          explanation: geminiPrimary.explanation || '',
          timestamp: new Date().toLocaleString(),
          gemini_explanation: geminiPrimary.explanation || ''
        });
      }

      // Final fallback: heuristic
      console.warn('Falling back to heuristic');
      prediction = await heuristicPredictDisease(imageBuffer);
      inferenceSource = 'heuristic';
    }

    const reconciliation = await reconcileLowConfidenceHealthyPrediction({ imageBuffer, prediction });
    prediction = reconciliation.prediction;
    heuristicOverrideUsed = reconciliation.overridden;

    const mlCondition = prediction?.disease;
    const mlConfidence = Number(prediction?.confidence || 0);

    if (!mlCondition || Number.isNaN(mlConfidence)) {
      throw new Error('Model inference output missing fields');
    }

    const geminiResult = await runGeminiReasoning({
      imageBuffer,
      mlPrediction: { disease: mlCondition, confidence: mlConfidence }
    });

    const finalCondition = normalizeFinalCondition(geminiResult.final_condition, mlCondition);
    const geminiConfidence = confidenceFromText(geminiResult.confidence);
    const finalConfidence = Number((geminiConfidence == null
      ? mlConfidence
      : (mlConfidence * 0.35 + geminiConfidence * 0.65)).toFixed(4));

    return res.json({
      valid: true,
      condition: finalCondition,
      confidence: finalConfidence,
      severity: normalizeSeverity(geminiResult.severity, finalConfidence),
      source: geminiResult.reasoning_source === 'gemini' ? 'ML + Gemini validated' : 'ML prediction with rule-based fallback',
      advice: geminiResult.recommendation || RECOMMENDATIONS[finalCondition],
      explanation: geminiResult.explanation,
      ml_condition: mlCondition,
      ml_confidence: mlConfidence,
      heuristic_override_used: heuristicOverrideUsed,
      gemini_explanation: geminiResult.explanation
    });
  } catch (error) {
    console.error('Analyze endpoint error:', error);
    return res.status(500).json({
      valid: false,
      message: 'Analysis failed. Please try again with a clearer skin image.'
    });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const question = String(req.body?.message || '').trim();
    const recentMessages = req.body?.history;
    const latestAnalysis = req.body?.latestAnalysis;

    if (!question) {
      return res.status(400).json({ message: 'message is required' });
    }

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      return res.json({
        reply: fallbackChatReply(question),
        source: 'fallback_no_api_key'
      });
    }

    const response = await fetch(`${GEMINI_ENDPOINT}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: buildChatPrompt({ question, recentMessages, latestAnalysis }) }]
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 260 }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini chat request failed: ${response.status}`);
    }

    const payload = await response.json();
    const reply = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      throw new Error('Gemini chat empty response');
    }

    return res.json({
      reply: String(reply).trim(),
      source: 'gemini'
    });
  } catch (error) {
    console.warn('Chat endpoint fallback due to error:', error.message);
    return res.json({
      reply: fallbackChatReply(req.body?.message),
      source: 'fallback_error'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Startup diagnostics
  const fsSync = require('fs');
  const artifactsDir = path.join(__dirname, 'ml', 'artifacts');
  const scriptPath = path.join(__dirname, 'ml', 'infer.py');
  console.log('=== STARTUP DIAGNOSTICS ===');
  console.log('infer.py exists:', fsSync.existsSync(scriptPath));
  try {
    const files = fsSync.readdirSync(artifactsDir);
    console.log('Artifacts found:');
    for (const f of files) {
      const stat = fsSync.statSync(path.join(artifactsDir, f));
      console.log('  ' + f + ': ' + stat.size + ' bytes' + (stat.size < 1000 ? ' ⚠️  LIKELY LFS POINTER' : ' ✅'));
    }
  } catch (e) {
    console.log('Artifacts dir missing:', e.message);
  }

  // Test Python is available
  const { execSync } = require('child_process');
  try {
    const pyVersion = execSync('python3 --version 2>&1').toString().trim();
    console.log('Python:', pyVersion);
  } catch (e) {
    console.log('Python3 not found:', e.message);
  }
  console.log('===========================');
});
