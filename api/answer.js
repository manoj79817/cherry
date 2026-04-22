/**
 * Vercel Serverless Function — /api/answer
 * Accepts POST { query, assets } → Returns { output }
 */

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      name: 'ARIA API - Team Ben10',
      version: '2.0',
      status: 'online'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ output: 'Method not allowed' });
  }

  const { query, assets } = req.body || {};

  if (!query) {
    return res.status(400).json({ output: 'No query provided.' });
  }

  try {
    // Try local fast answer first
    const localResult = localAnswer(query);
    if (localResult) {
      return res.json({ output: localResult });
    }

    // Try OpenAI if key is available
    const aiAnswer = await askOpenAI(query, assets);
    if (aiAnswer) {
      return res.json({ output: aiAnswer });
    }

    // Fallback
    return res.json({ output: `I cannot determine the answer to: "${query}"` });
  } catch (error) {
    console.error('Error:', error.message);
    return res.json({ output: `Error processing: ${query}` });
  }
};

// ============================================
// Local Answer Engine
// ============================================
function localAnswer(query) {
  const q = query.trim();
  const ql = q.toLowerCase();

  // Math: "What is X + Y?"
  const mathMatch = ql.match(
    /what\s+is\s+(\-?\d+(?:\.\d+)?)\s*([+\-*/×÷]|plus|minus|times|divided\s*by|multiplied\s*by)\s*(\-?\d+(?:\.\d+)?)/i
  );
  if (mathMatch) {
    const a = parseFloat(mathMatch[1]);
    const opStr = mathMatch[2].toLowerCase();
    const b = parseFloat(mathMatch[3]);
    let result, opWord;

    if (opStr === '+' || opStr === 'plus') {
      result = a + b;
      opWord = 'sum';
    } else if (opStr === '-' || opStr === 'minus') {
      result = a - b;
      opWord = 'difference';
    } else if (opStr === '*' || opStr === '×' || opStr === 'times' || opStr.includes('multipli')) {
      result = a * b;
      opWord = 'product';
    } else if (opStr === '/' || opStr === '÷' || opStr.includes('divided')) {
      result = b !== 0 ? a / b : 'undefined';
      opWord = 'result';
    }

    if (result !== undefined) {
      const formatted = Number.isInteger(result) ? result : parseFloat(result.toFixed(4));
      return `The ${opWord} is ${formatted}.`;
    }
  }

  // Generic arithmetic evaluation
  const calcMatch = ql.match(/(?:calculate|compute|evaluate|solve|what\s+is)\s+(.+)/i);
  if (calcMatch) {
    try {
      const expr = calcMatch[1].replace(/[^0-9+\-*/().%\s]/g, '').trim();
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
// OpenAI Integration (optional)
// ============================================
async function askOpenAI(query, assets) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    return null;
  }

  try {
    const systemPrompt = `You are a precise question-answering assistant. Your answers are compared against expected outputs using cosine similarity and Jaccard scoring.

RULES:
1. Give DIRECT, CONCISE answers only.
2. For math: state the answer in a clean sentence like "The sum is 25."
3. No filler words like "Sure!", "Of course!", "Here you go".
4. Do NOT repeat the question.
5. Match the expected natural language answer format.`;

    // Fetch asset contents if provided
    let assetText = '';
    if (assets && assets.length > 0) {
      const fetched = await Promise.allSettled(
        assets.map(url =>
          fetch(url, { signal: AbortSignal.timeout(5000) })
            .then(r => r.text())
        )
      );
      const contents = fetched
        .filter(r => r.status === 'fulfilled')
        .map((r, i) => `--- Asset ${i + 1} ---\n${r.value}`);
      if (contents.length) {
        assetText = '\n\nAsset Contents:\n' + contents.join('\n');
      }
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query + assetText }
        ],
        temperature: 0.1,
        max_tokens: 2000
      }),
      signal: AbortSignal.timeout(15000)
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('OpenAI Error:', error.message);
    return null;
  }
}
