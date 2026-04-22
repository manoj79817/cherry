/**
 * ARIA API Server — Hackathon Challenge Endpoint
 * 
 * Accepts POST { query, assets } → Returns { output }
 * Evaluated on cosine similarity and Jaccard scoring.
 * 
 * Uses Gemini for intelligent answers,
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
// Gemini Integration
// ============================================
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function askGemini(query, assetContents = []) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
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
9. If the answer is a single name, number, word, or phrase, keep it to one short sentence or just the value.
10. If asset contents are provided, use the asset text as the source of truth.
11. Do not use markdown tables, bullet lists, code fences, or headings unless the question explicitly asks for them.

Examples of good answers:
- Q: "What is 10 + 15?" → "The sum is 25."
- Q: "What is the capital of France?" → "The capital of France is Paris."
- Q: "Summarize this text" → [direct summary without preamble]`;

    let userContent = query;
    if (assetContents.length > 0) {
      userContent += '\n\nAsset Contents:\n' + assetContents.map((c, i) => `--- Asset ${i + 1} ---\n${c}`).join('\n');
    }

    const response = await axios.post(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userContent }]
        }
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 12000
    });

    return response.data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim() || null;
  } catch (error) {
    console.error('Gemini Error:', error.response?.data || error.message);
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
  const fast = deterministicAnswer(query);
  if (fast) return fast;

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

function deterministicAnswer(query) {
  const raw = String(query || '').trim();
  const q = raw.toLowerCase();

  const facts = [
    [/capital of france/, 'The capital of France is Paris.'],
    [/capital of india/, 'The capital of India is New Delhi.'],
    [/capital of japan/, 'The capital of Japan is Tokyo.'],
    [/capital of germany/, 'The capital of Germany is Berlin.'],
    [/capital of italy/, 'The capital of Italy is Rome.'],
    [/capital of spain/, 'The capital of Spain is Madrid.'],
    [/capital of canada/, 'The capital of Canada is Ottawa.'],
    [/capital of australia/, 'The capital of Australia is Canberra.'],
    [/largest planet/, 'The largest planet is Jupiter.'],
    [/red planet/, 'Mars is known as the Red Planet.'],
    [/chemical symbol for water|formula for water/, 'The chemical formula for water is H2O.'],
    [/boiling point of water/, 'Water boils at 100 degrees Celsius.'],
    [/freezing point of water/, 'Water freezes at 0 degrees Celsius.'],
    [/author of romeo and juliet|wrote romeo and juliet/, 'Romeo and Juliet was written by William Shakespeare.'],
    [/speed of light/, 'The speed of light is about 299,792,458 meters per second.']
  ];
  for (const [pattern, answer] of facts) {
    if (pattern.test(q)) return answer;
  }

  const quoted = raw.match(/["'](.+?)["']/)?.[1];
  if (quoted) {
    if (/\breverse\b/.test(q)) return quoted.split('').reverse().join('');
    if (/\buppercase\b|upper case|capital letters/.test(q)) return quoted.toUpperCase();
    if (/\blowercase\b|lower case/.test(q)) return quoted.toLowerCase();
    if (/count.*\b(vowels?)\b|\bhow many vowels\b/.test(q)) return String((quoted.match(/[aeiou]/gi) || []).length);
    if (/count.*\b(characters?|letters?)\b|\bhow many characters\b|\bhow many letters\b/.test(q)) return String(quoted.replace(/\s/g, '').length);
    if (/count.*\bwords?\b|\bhow many words\b/.test(q)) return String((quoted.trim().match(/\b[\w'-]+\b/g) || []).length);
    if (/\bpalindrome\b/.test(q)) {
      const normalized = quoted.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalized === normalized.split('').reverse().join('') ? 'Yes.' : 'No.';
    }
  }

  const nums = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (nums.length > 0) {
    if (/\b(?:largest|max(?:imum)?|highest|greatest)\b/.test(q)) return String(Math.max(...nums));
    if (/\b(?:smallest|min(?:imum)?|lowest|least)\b/.test(q)) return String(Math.min(...nums));
    if (/\bsum\b|\btotal\b|\badd\b/.test(q) && nums.length > 1) return `The sum is ${formatNumber(nums.reduce((a, b) => a + b, 0))}.`;
    if (/\baverage\b|\bmean\b/.test(q) && nums.length > 1) return `The average is ${formatNumber(nums.reduce((a, b) => a + b, 0) / nums.length)}.`;
    if (/\bsort\b|\border\b/.test(q) && nums.length > 1) {
      const sorted = [...nums].sort((a, b) => /\bdesc/.test(q) ? b - a : a - b);
      return sorted.map(formatNumber).join(', ');
    }
  }

  const primeMatch = q.match(/(?:is\s+)?(\d+)\s+(?:a\s+)?prime/);
  if (primeMatch) return isPrime(Number(primeMatch[1])) ? 'Yes.' : 'No.';

  const factorialMatch = q.match(/factorial\s+of\s+(\d+)|(\d+)!/);
  if (factorialMatch) {
    const n = Number(factorialMatch[1] || factorialMatch[2]);
    if (n >= 0 && n <= 20) return `The factorial of ${n} is ${formatNumber(factorial(n))}.`;
  }

  const fibMatch = q.match(/(?:fibonacci|fib)\s*(?:number)?\s*(?:of|at|for)?\s*(\d+)/);
  if (fibMatch) {
    const n = Number(fibMatch[1]);
    if (n >= 0 && n <= 80) return `The Fibonacci number at position ${n} is ${formatNumber(fibonacci(n))}.`;
  }

  const binaryMatch = q.match(/binary\s+(?:number\s+)?([01]+)\s+(?:to|in)\s+decimal|convert\s+([01]+)\s+from\s+binary/);
  if (binaryMatch) return String(parseInt(binaryMatch[1] || binaryMatch[2], 2));

  const decimalToBinaryMatch = q.match(/(?:decimal\s+)?(\d+)\s+(?:to|in)\s+binary|convert\s+(\d+)\s+to\s+binary/);
  if (decimalToBinaryMatch && /\bbinary\b/.test(q)) return Number(decimalToBinaryMatch[1] || decimalToBinaryMatch[2]).toString(2);

  return null;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(parseFloat(value.toFixed(6)));
}

function isPrime(n) {
  if (n < 2 || !Number.isInteger(n)) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i += 1) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
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

    // Step 3: Ask Gemini
    const aiAnswer = await askGemini(query, assetContents);
    if (aiAnswer) {
      console.log(`  → AI answer (${Date.now() - startTime}ms): ${aiAnswer.substring(0, 100)}...`);
      return res.json({ output: aiAnswer });
    }

    // Step 4: If Gemini fails, use local fallback
    if (localResult) {
      console.log(`  → Fallback local (${Date.now() - startTime}ms): ${localResult}`);
      return res.json({ output: localResult });
    }

    // Step 5: Generic fallback
    const fallback = `I cannot determine the answer.`;
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
  console.log(`\nGemini API Key: ${GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here' ? 'Configured' : 'Not set (using local fallback only)'}`);
  console.log(`\n💡 To expose publicly, run: npx ngrok http ${PORT}`);
});
