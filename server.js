/**
 * ARIA API Server — Hackathon Challenge Endpoint
 * 
 * Accepts POST { query, assets } → Returns { output }
 * Evaluated on cosine similarity and Jaccard scoring.
 * 
 * Uses OpenAI GPT-4o-mini for intelligent answers,
 * with smart fallbacks for common patterns.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ============================================
// OpenAI Integration
// ============================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function askOpenAI(query, assetContents = []) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
    return null; // Will fall back to local logic
  }

  try {
    const systemPrompt = `You are a precise question-answering assistant for an evaluation system. 
Your answers are compared against expected outputs using cosine similarity and n-gram Jaccard scoring.

CRITICAL RULES:
1. Give DIRECT, CONCISE answers. No unnecessary filler or preamble.
2. Match the expected output format and style as closely as possible.
3. For math questions: state the answer in a clean, natural sentence.
4. For factual questions: give the most commonly accepted answer.
5. For text analysis: be precise and structured.
6. Do NOT include phrases like "Sure!", "Of course!", "Here you go", etc.
7. Do NOT repeat the question.
8. Answer as if you are providing the definitive, expected answer.

Examples of good answers:
- Q: "What is 10 + 15?" → "The sum is 25."
- Q: "What is the capital of France?" → "The capital of France is Paris."
- Q: "Summarize this text" → [direct summary without preamble]`;

    let userContent = query;
    if (assetContents.length > 0) {
      userContent += '\n\nAsset Contents:\n' + assetContents.map((c, i) => `--- Asset ${i + 1} ---\n${c}`).join('\n');
    }

    const response = await axios.post(OPENAI_URL, {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.1,
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 18000 // 18s to stay under 20s limit
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI Error:', error.response?.data || error.message);
    return null;
  }
}

// ============================================
// Asset Fetcher 
// ============================================
async function fetchAssets(assets) {
  if (!assets || assets.length === 0) return [];

  const results = await Promise.allSettled(
    assets.map(url =>
      axios.get(url, {
        timeout: 5000,
        maxContentLength: 5 * 1024 * 1024, // 5MB limit
        responseType: 'text'
      }).then(r => r.data)
    )
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => typeof r.value === 'string' ? r.value : JSON.stringify(r.value));
}

// ============================================
// Local Fallback Logic (no API key needed)
// ============================================
function localAnswer(query) {
  const q = query.trim().toLowerCase();

  // Math operations
  const mathMatch = q.match(/what\s+is\s+(\d+(?:\.\d+)?)\s*([+\-*/×÷]|plus|minus|times|divided\s*by|multiplied\s*by)\s*(\d+(?:\.\d+)?)/i);
  if (mathMatch) {
    const a = parseFloat(mathMatch[1]);
    const opStr = mathMatch[2].toLowerCase();
    const b = parseFloat(mathMatch[3]);
    let result, opWord;

    if (opStr === '+' || opStr === 'plus') {
      result = a + b; opWord = 'sum';
    } else if (opStr === '-' || opStr === 'minus') {
      result = a - b; opWord = 'difference';
    } else if (opStr === '*' || opStr === '×' || opStr === 'times' || opStr.includes('multipli')) {
      result = a * b; opWord = 'product';
    } else if (opStr === '/' || opStr === '÷' || opStr.includes('divided')) {
      result = b !== 0 ? a / b : 'undefined';
      opWord = 'result';
    }

    if (result !== undefined) {
      const formatted = Number.isInteger(result) ? result : parseFloat(result.toFixed(4));
      return `The ${opWord} is ${formatted}.`;
    }
  }

  // Simple arithmetic expression evaluation
  const exprMatch = q.match(/(?:calculate|compute|evaluate|solve|what\s+is)\s+(.+)/i);
  if (exprMatch) {
    try {
      const expr = exprMatch[1].replace(/[^0-9+\-*/().%\s]/g, '').trim();
      if (expr && /^[\d+\-*/().%\s]+$/.test(expr)) {
        const result = Function('"use strict"; return (' + expr + ')')();
        if (typeof result === 'number' && isFinite(result)) {
          const formatted = Number.isInteger(result) ? result : parseFloat(result.toFixed(4));
          return `The result is ${formatted}.`;
        }
      }
    } catch (e) { /* fall through */ }
  }

  return null;
}

// ============================================
// Main API Endpoint
// ============================================
app.post('/api/answer', async (req, res) => {
  const startTime = Date.now();
  const { query, assets } = req.body;

  if (!query) {
    return res.status(400).json({ output: 'No query provided.' });
  }

  console.log(`\n[${new Date().toISOString()}] Query: "${query}"`);
  if (assets?.length) console.log(`  Assets: ${assets.length} URLs`);

  try {
    // Step 1: Try local fast-path for simple queries
    const localResult = localAnswer(query);
    if (localResult && (!assets || assets.length === 0)) {
      console.log(`  → Local answer (${Date.now() - startTime}ms): ${localResult}`);
      return res.json({ output: localResult });
    }

    // Step 2: Fetch assets if provided
    const assetContents = await fetchAssets(assets);

    // Step 3: Ask OpenAI
    const aiAnswer = await askOpenAI(query, assetContents);
    if (aiAnswer) {
      console.log(`  → AI answer (${Date.now() - startTime}ms): ${aiAnswer.substring(0, 100)}...`);
      return res.json({ output: aiAnswer });
    }

    // Step 4: If OpenAI fails, use local fallback
    if (localResult) {
      console.log(`  → Fallback local (${Date.now() - startTime}ms): ${localResult}`);
      return res.json({ output: localResult });
    }

    // Step 5: Generic fallback
    const fallback = `I don't have enough information to answer: "${query}"`;
    console.log(`  → Generic fallback (${Date.now() - startTime}ms)`);
    return res.json({ output: fallback });

  } catch (error) {
    console.error('  → Error:', error.message);
    return res.json({ output: `Error processing query: ${query}` });
  }
});

app.get('/api/answer', (req, res) => {
  res.json({
    name: 'ARIA API - Team Ben10',
    version: '2.0',
    status: 'online',
    method: 'POST',
    endpoint: '/api/answer',
    body: { query: 'What is 10 + 15?', assets: [] }
  });
});

// Also handle root path and other common paths
app.post('/', async (req, res) => {
  // Redirect to main handler
  req.url = '/api/answer';
  app.handle(req, res);
});

app.post('/v1/answer', async (req, res) => {
  req.url = '/api/answer';
  app.handle(req, res);
});

app.post('/answer', async (req, res) => {
  req.url = '/api/answer';
  app.handle(req, res);
});

app.post('/webhook/personal-assistant', async (req, res) => {
  req.url = '/api/answer';
  app.handle(req, res);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    name: 'ARIA API - Team Ben10',
    version: '2.0',
    status: 'online',
    endpoints: {
      answer: 'POST /api/answer { query, assets } → { output }',
      alt1: 'POST /v1/answer',
      alt2: 'POST /answer',
      alt3: 'POST /'
    }
  });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 ARIA API Server running on http://localhost:${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST http://localhost:${PORT}/api/answer`);
  console.log(`   POST http://localhost:${PORT}/v1/answer`);
  console.log(`   POST http://localhost:${PORT}/answer`);
  console.log(`   POST http://localhost:${PORT}/`);
  console.log(`\n🔑 OpenAI API Key: ${OPENAI_API_KEY && OPENAI_API_KEY !== 'your_openai_api_key_here' ? '✅ Configured' : '❌ Not set (using local fallback only)'}`);
  console.log(`\n💡 To expose publicly, run: npx ngrok http ${PORT}`);
});
