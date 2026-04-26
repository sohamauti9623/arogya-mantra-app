const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (_req, res) => {
  res.json({ message: 'Arogya Mantra backend is running.' });
});

app.post('/analyze', async (req, res) => {
  try {
    const { image } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'Image is required' });
    }

    // Placeholder for real AI provider call.
    // Keep keys in .env only (AI_API_KEY), never in frontend.
    const _apiKey = process.env.AI_API_KEY;

    return res.json({
      condition: 'Healthy Skin',
      confidence: '90%',
      advice: 'Maintain hygiene and hydration'
    });
  } catch (error) {
    console.error('Analyze endpoint error:', error);
    return res.status(500).json({
      error: 'Failed to analyze image',
      fallback: {
        condition: 'Healthy Skin',
        confidence: '82%',
        advice: 'Unable to reach AI service. Keep skin clean and consult a dermatologist if symptoms persist.'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
