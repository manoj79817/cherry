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

    const exactPrompt = `You are an exact-answer API for an evaluation system.
Return only the answer. No greeting, caveat, markdown, heading, or explanation.
If the answer is a name, place, date, number, boolean, or short phrase, return that value only.
For arithmetic, return the numeric result only unless a sentence is explicitly requested.
For yes/no questions, return exactly "Yes." or "No."
For list questions, return a comma-separated list.
If asset contents are provided, use the asset text as the source of truth.`;

    let userContent = query;
    if (assetContents.length > 0) {
      userContent += '\n\nAsset Contents:\n' + assetContents.map((c, i) => `--- Asset ${i + 1} ---\n${c}`).join('\n');
    }

    const response = await axios.post(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      systemInstruction: {
        parts: [{ text: exactPrompt }]
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
    assets.map(asset => {
      if (!/^https?:\/\//i.test(asset)) return Promise.resolve(asset);
      return axios.get(asset, {
        timeout: 5000,
        maxContentLength: 5 * 1024 * 1024, // 5MB limit
        responseType: 'text'
      }).then(r => r.data);
    })
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

  const ruleChainResult = evaluateLevel7(raw);
  if (ruleChainResult !== null) return ruleChainResult;

  const namedComparisonAnswer = answerNamedComparison(raw, q);
  if (namedComparisonAnswer) return namedComparisonAnswer;

  const filteredNumberAnswer = answerFilteredNumbers(raw);
  if (filteredNumberAnswer !== null) return filteredNumberAnswer;

  const oddEvenAnswer = answerOddEven(q);
  if (oddEvenAnswer) return oddEvenAnswer;

  const extractedDate = extractDate(raw);
  if (extractedDate) return extractedDate;

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

  const sqrtMatch = q.match(/square root of\s+(\d+(?:\.\d+)?)/);
  if (sqrtMatch) return formatNumber(Math.sqrt(Number(sqrtMatch[1])));

  const squareMatch = q.match(/(?:what is )?(-?\d+(?:\.\d+)?)\s+squared|square of\s+(-?\d+(?:\.\d+)?)/);
  if (squareMatch) {
    const n = Number(squareMatch[1] || squareMatch[2]);
    return formatNumber(n * n);
  }

  const cubeMatch = q.match(/(?:what is )?(-?\d+(?:\.\d+)?)\s+cubed|cube of\s+(-?\d+(?:\.\d+)?)/);
  if (cubeMatch) {
    const n = Number(cubeMatch[1] || cubeMatch[2]);
    return formatNumber(n * n * n);
  }

  const percentMatch = q.match(/(?:what is )?(-?\d+(?:\.\d+)?)\s*%\s+of\s+(-?\d+(?:\.\d+)?)/);
  if (percentMatch) return formatNumber((Number(percentMatch[1]) / 100) * Number(percentMatch[2]));

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

function ruleChainAnswer(raw) {
  return solveRuleChain(raw);
}

function solveRuleChain(raw) {
  const text = String(raw || '').trim().replace(/[\u2192\u21D2]/g, '->');
  const lower = text.toLowerCase();

  const hasRules = /\b(?:rule|step)\s*\d+\s*:/.test(lower) || (/\bif\b/.test(lower) && (/\bthen\b/.test(lower) || /->|=>|:|,/.test(text)));
  if (!hasRules) return null;

  const input = extractRuleInputNumber(text);
  if (input === null) return null;

  const sections = extractRuleSections(text);
  if (!sections.length) return null;

  let current = input;
  for (const section of sections) {
    const outcome = evaluateRuleBlock(section, current);
    if (!outcome) continue;
    if (outcome.type === 'output') return outcome.value;
    current = outcome.value;
  }

  return formatNumber(current);
}

function evaluateLevel7(raw) {
  const text = String(raw || '').trim().replace(/[\u2192\u21D2]/g, '->');
  const lower = text.toLowerCase();
  const looksLikeRules =
    /\b(?:rule|step)\s*\d+\s*:/.test(lower) ||
    (/\bif\b/.test(lower) && (/\bthen\b/.test(lower) || /->|=>|:|,|\?/.test(text)));

  if (!looksLikeRules) return null;

  const input = parseLevel7Input(text);
  if (input === null) return null;

  const sections = parseLevel7Sections(text);
  if (!sections.length) return null;

  let current = input;
  for (const section of sections) {
    const result = parseLevel7Section(section, current);
    if (!result) continue;
    if (result.type === 'output') return result.value;
    current = result.value;
  }

  return formatNumber(current);
}

function parseLevel7Input(text) {
  const normalized = String(text || '').replace(/[\u2192\u21D2]/g, '->');
  const lower = normalized.toLowerCase();
  const firstRuleIndex = lower.search(/\b(?:rule|step)\s*\d+\s*:/);
  const intro = firstRuleIndex >= 0 ? normalized.slice(0, firstRuleIndex) : normalized;
  const patterns = [
    /(?:input|starting|initial|given|start|begin)\s+with\s+(-?\d+(?:\.\d+)?)/i,
    /(?:input|starting|initial|given|start|begin)\s+with\s+([a-z-]+\b(?:\s+[a-z-]+\b)*)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s*:\s*(-?\d+(?:\.\d+)?)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s+(-?\d+(?:\.\d+)?)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s*:\s*([a-z-]+\b(?:\s+[a-z-]+\b)*)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s+([a-z-]+\b(?:\s+[a-z-]+\b)*)/i,
    /input number\s+(-?\d+(?:\.\d+)?)/i,
    /input number\s*:\s*(-?\d+(?:\.\d+)?)/i,
    /given input\s+(-?\d+(?:\.\d+)?)/i,
    /given input number\s+(-?\d+(?:\.\d+)?)/i,
    /input value\s+(-?\d+(?:\.\d+)?)/i,
    /starting number\s+(-?\d+(?:\.\d+)?)/i,
    /initial number\s+(-?\d+(?:\.\d+)?)/i,
    /input\s*:\s*(-?\d+(?:\.\d+)?)/i,
    /input\s+(-?\d+(?:\.\d+)?)/i
  ];

  for (const pattern of patterns) {
    const match = intro.match(pattern) || normalized.match(pattern);
    if (!match) continue;
    if (/^-?\d+(?:\.\d+)?$/.test(match[1])) return Number(match[1]);
    const parsed = parseNumberWords(match[1]);
    if (parsed !== null) return parsed;
  }

  const wordNumber = parseNumberWords(intro) ?? parseNumberWords(normalized);
  return wordNumber !== null ? Number(wordNumber) : null;
}

function parseLevel7Sections(text) {
  const markerSections = text.match(/(?:\b(?:rule|step)\s*\d+\s*:[\s\S]*?)(?=(?:\b(?:rule|step)\s*\d+\s*:)|$)/gi);
  if (markerSections && markerSections.length) {
    return markerSections.map(section => section.replace(/^\b(?:rule|step)\s*\d+\s*:\s*/i, '').trim()).filter(Boolean);
  }

  return text
    .split(/(?:\r?\n|[.;]+)/)
    .map(part => part.trim())
    .filter(part => /\bif\b|\botherwise\b|\belse\b/i.test(part));
}

function parseLevel7Section(section, current) {
  const text = String(section || '').replace(/[\u2192\u21D2]/g, '->');
  const ifPairs = [...text.matchAll(/(?:if|when)\s+(.+?)(?:\s*(?:->|=>|:|,|\?)\s*|\s+then\s+)(.+?)(?=(?:\s*(?:if|when|otherwise|else)\b|$))/gi)];

  for (const pair of ifPairs) {
    if (parseLevel7Condition(pair[1], current)) {
      return parseLevel7Action(pair[2], current);
    }
  }

  const otherwiseMatch = text.match(/(?:otherwise|else)(?:\s*(?:->|=>|:|,|\?)\s*|\s+then\s+)(.+)$/i);
  if (otherwiseMatch) {
    return parseLevel7Action(otherwiseMatch[1], current);
  }

  return null;
}

function parseLevel7Condition(condition, current) {
  const c = String(condition || '').toLowerCase().replace(/[().,]/g, ' ');
  const value = Number(current);

  const divMatch = c.match(/(?:divisible by|multiple of)\s+(-?\d+(?:\.\d+)?)/);
  if (divMatch) return Number(divMatch[1]) !== 0 && value % Number(divMatch[1]) === 0;

  const gtMatch = c.match(/(?:>|greater than)\s*(-?\d+(?:\.\d+)?)/);
  if (gtMatch) return value > Number(gtMatch[1]);

  const gteMatch = c.match(/(?:>=|at least|greater than or equal to)\s*(-?\d+(?:\.\d+)?)/);
  if (gteMatch) return value >= Number(gteMatch[1]);

  const ltMatch = c.match(/(?:<|less than)\s*(-?\d+(?:\.\d+)?)/);
  if (ltMatch) return value < Number(ltMatch[1]);

  const lteMatch = c.match(/(?:<=|at most|less than or equal to)\s*(-?\d+(?:\.\d+)?)/);
  if (lteMatch) return value <= Number(lteMatch[1]);

  if (/\beven\b/.test(c)) return Number.isInteger(value) && Math.abs(value) % 2 === 0;
  if (/\bodd\b/.test(c)) return Number.isInteger(value) && Math.abs(value) % 2 === 1;
  if (/\bprime\b/.test(c)) return isPrime(Math.abs(value));

  return false;
}

function parseLevel7Action(action, current) {
  const text = String(action || '').trim().replace(/[\u2192\u21D2]/g, '->');
  const lower = text.toLowerCase();

  const quoted = text.match(/["']([^"']+)["']/)?.[1];
  if (quoted !== undefined && (/\boutput\b|\breturn\b|\bsay\b|\bprint\b|\brespond\b|\bresult\b/.test(lower))) {
    return { type: 'output', value: quoted };
  }

  if (/\boutput the number\b|\boutput number\b|\boutput the result\b|\boutput result\b|\breturn the number\b|\breturn the result\b|\bsay the number\b|\bprint the number\b/.test(lower)) {
    return { type: 'output', value: formatNumber(current) };
  }

  const directOutput = text.match(/\b(?:output|return|say|print|respond with)\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
  if (directOutput && !/\bthe\b/i.test(directOutput[0])) {
    return { type: 'output', value: directOutput[1] };
  }

  const bareToken = text.trim().replace(/[.,;:!?]+$/g, '');
  if (bareToken && /^[A-Za-z][A-Za-z0-9_-]*$/.test(bareToken) && !/^(if|then|else|otherwise|rule|step|double|triple|half|halve|square|cube|add|subtract|decrease|increase|multiply|divide|output|return|say|print|respond|even|odd)$/i.test(bareToken)) {
    return { type: 'output', value: bareToken };
  }

  if (/\bdouble\b/.test(lower)) return { type: 'value', value: current * 2 };
  if (/\btriple\b/.test(lower)) return { type: 'value', value: current * 3 };
  if (/\bhalf\b|\bhalve\b/.test(lower)) return { type: 'value', value: current / 2 };
  if (/\bsquare\b/.test(lower)) return { type: 'value', value: current * current };
  if (/\bcube\b/.test(lower)) return { type: 'value', value: current * current * current };

  const addMatch = lower.match(/\badd\s+(-?\d+(?:\.\d+)?)|\bincrease by\s+(-?\d+(?:\.\d+)?)|\bplus\s+(-?\d+(?:\.\d+)?)/);
  if (addMatch) {
    const n = Number(addMatch[1] || addMatch[2] || addMatch[3]);
    return { type: 'value', value: current + n };
  }

  const subtractMatch = lower.match(/\bsubtract\s+(-?\d+(?:\.\d+)?)|\bdecrease by\s+(-?\d+(?:\.\d+)?)|\bminus\s+(-?\d+(?:\.\d+)?)/);
  if (subtractMatch) {
    const n = Number(subtractMatch[1] || subtractMatch[2] || subtractMatch[3]);
    return { type: 'value', value: current - n };
  }

  const multiplyMatch = lower.match(/\bmultiply by\s+(-?\d+(?:\.\d+)?)/);
  if (multiplyMatch) return { type: 'value', value: current * Number(multiplyMatch[1]) };

  const divideMatch = lower.match(/\bdivide by\s+(-?\d+(?:\.\d+)?)/);
  if (divideMatch) return { type: 'value', value: current / Number(divideMatch[1]) };

  const setMatch = lower.match(/\b(?:set|make|become|becomes|result is)\s+(-?\d+(?:\.\d+)?)/);
  if (setMatch) return { type: 'value', value: Number(setMatch[1]) };

  return null;
}

function extractRuleSections(text) {
  const markerSections = text.match(/(?:\b(?:rule|step)\s*\d+\s*:[\s\S]*?)(?=(?:\b(?:rule|step)\s*\d+\s*:)|$)/gi);
  if (markerSections && markerSections.length) {
    return markerSections.map(section => section.replace(/^\b(?:rule|step)\s*\d+\s*:\s*/i, '').trim()).filter(Boolean);
  }

  return text
    .split(/(?:\r?\n|[.;]+)/)
    .map(part => part.trim())
    .filter(part => /\bif\b|\botherwise\b|\belse\b/i.test(part));
}

function extractRuleInputNumber(text) {
  const normalized = String(text || '').replace(/[\u2192\u21D2]/g, '->');
  const lower = normalized.toLowerCase();
  const firstRuleIndex = lower.search(/\brule\s*\d+\s*:/);
  const intro = firstRuleIndex >= 0 ? normalized.slice(0, firstRuleIndex) : normalized;

  const patterns = [
    /(?:input|starting|initial|given|start|begin)\s+with\s+(-?\d+(?:\.\d+)?)/i,
    /(?:input|starting|initial|given|start|begin)\s+with\s+([a-z-]+\b(?:\s+[a-z-]+\b)*)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s*:\s*(-?\d+(?:\.\d+)?)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s+(-?\d+(?:\.\d+)?)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s*:\s*([a-z-]+\b(?:\s+[a-z-]+\b)*)/i,
    /(?:input|starting|initial|given|start|begin)\s+(?:number|value)?\s+([a-z-]+\b(?:\s+[a-z-]+\b)*)/i,
    /input number\s+(-?\d+(?:\.\d+)?)/i,
    /input number\s*:\s*(-?\d+(?:\.\d+)?)/i,
    /given input\s+(-?\d+(?:\.\d+)?)/i,
    /given input number\s+(-?\d+(?:\.\d+)?)/i,
    /input value\s+(-?\d+(?:\.\d+)?)/i,
    /starting number\s+(-?\d+(?:\.\d+)?)/i,
    /initial number\s+(-?\d+(?:\.\d+)?)/i,
    /input\s*:\s*(-?\d+(?:\.\d+)?)/i,
    /input\s+(-?\d+(?:\.\d+)?)/i
  ];

  for (const pattern of patterns) {
    const match = intro.match(pattern) || normalized.match(pattern);
    if (match) {
      if (/^-?\d+(?:\.\d+)?$/.test(match[1])) return Number(match[1]);
      const parsed = parseNumberWords(match[1]);
      if (parsed !== null) return parsed;
    }
  }

  const wordNumber = parseNumberWords(intro) ?? parseNumberWords(normalized);
  if (wordNumber !== null) return Number(wordNumber);

  return null;
}

function evaluateRuleBlock(block, current) {
  const text = String(block || '').replace(/[\u2192\u21D2]/g, '->');
  const ifPairs = [...text.matchAll(/(?:if|when)\s+(.+?)(?:\s*(?:->|=>|:|,)\s*|\s+then\s+)(.+?)(?=(?:\s*(?:if|when|otherwise|else)\b|$))/gi)];

  for (const pair of ifPairs) {
    if (evaluateRuleCondition(pair[1], current)) {
      return applyRuleAction(pair[2], current);
    }
  }

  const otherwiseMatch = text.match(/(?:otherwise|else)(?:\s*(?:->|=>|:|,)\s*|\s+then\s+)(.+)$/i);
  if (otherwiseMatch) {
    return applyRuleAction(otherwiseMatch[1], current);
  }

  return null;
}

function evaluateRuleCondition(condition, current) {
  const c = String(condition || '').toLowerCase().replace(/[().,]/g, ' ');
  const value = Number(current);

  const divMatch = c.match(/divisible by\s+(-?\d+(?:\.\d+)?)/);
  if (divMatch) return Number(divMatch[1]) !== 0 && value % Number(divMatch[1]) === 0;

  const gtMatch = c.match(/(?:>|greater than)\s*(-?\d+(?:\.\d+)?)/);
  if (gtMatch) return value > Number(gtMatch[1]);

  const gteMatch = c.match(/(?:>=|at least|greater than or equal to)\s*(-?\d+(?:\.\d+)?)/);
  if (gteMatch) return value >= Number(gteMatch[1]);

  const ltMatch = c.match(/(?:<|less than)\s*(-?\d+(?:\.\d+)?)/);
  if (ltMatch) return value < Number(ltMatch[1]);

  const lteMatch = c.match(/(?:<=|at most|less than or equal to)\s*(-?\d+(?:\.\d+)?)/);
  if (lteMatch) return value <= Number(lteMatch[1]);

  if (/\beven\b/.test(c)) return Number.isInteger(value) && Math.abs(value) % 2 === 0;
  if (/\bodd\b/.test(c)) return Number.isInteger(value) && Math.abs(value) % 2 === 1;

  return false;
}

function applyRuleAction(action, current) {
  const text = String(action || '').trim().replace(/[\u2192\u21D2]/g, '->');
  const lower = text.toLowerCase();

  const quoted = text.match(/["']([^"']+)["']/)?.[1];
  if (quoted !== undefined) {
    if (/\boutput\b|\breturn\b|\bresult\b/.test(lower)) return { type: 'output', value: quoted };
  }

  if (/\boutput the number\b|\boutput number\b|\boutput the result\b|\boutput result\b|\breturn the number\b|\breturn the result\b/.test(lower)) {
    return { type: 'output', value: formatNumber(current) };
  }

  const directOutput = text.match(/\boutput\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
  if (directOutput && !/\bthe\b/.test(lower)) {
    return { type: 'output', value: directOutput[1] };
  }

  const bareToken = text.trim().replace(/[.,;:!?]+$/g, '');
  if (bareToken && /^[A-Za-z][A-Za-z0-9_-]*$/.test(bareToken) && !/^(if|then|else|otherwise|rule|double|triple|half|halve|square|cube|add|subtract|decrease|increase|multiply|divide|output|return|even|odd)$/i.test(bareToken)) {
    return { type: 'output', value: bareToken };
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return { type: 'output', value: text };
  }

  if (/\bdouble\b/.test(lower)) return { type: 'value', value: current * 2 };
  if (/\btriple\b/.test(lower)) return { type: 'value', value: current * 3 };
  if (/\bhalf\b|\bhalve\b/.test(lower)) return { type: 'value', value: current / 2 };
  if (/\bsquare\b/.test(lower)) return { type: 'value', value: current * current };
  if (/\bcube\b/.test(lower)) return { type: 'value', value: current * current * current };

  const addMatch = lower.match(/\badd\s+(-?\d+(?:\.\d+)?)|\bincrease by\s+(-?\d+(?:\.\d+)?)|\bplus\s+(-?\d+(?:\.\d+)?)/);
  if (addMatch) {
    const n = Number(addMatch[1] || addMatch[2] || addMatch[3]);
    return { type: 'value', value: current + n };
  }

  const subtractMatch = lower.match(/\bsubtract\s+(-?\d+(?:\.\d+)?)|\bdecrease by\s+(-?\d+(?:\.\d+)?)|\bminus\s+(-?\d+(?:\.\d+)?)/);
  if (subtractMatch) {
    const n = Number(subtractMatch[1] || subtractMatch[2] || subtractMatch[3]);
    return { type: 'value', value: current - n };
  }

  const multiplyMatch = lower.match(/\bmultiply by\s+(-?\d+(?:\.\d+)?)/);
  if (multiplyMatch) return { type: 'value', value: current * Number(multiplyMatch[1]) };

  const divideMatch = lower.match(/\bdivide by\s+(-?\d+(?:\.\d+)?)/);
  if (divideMatch) return { type: 'value', value: current / Number(divideMatch[1]) };

  return null;
}

function answerNamedComparison(raw, q) {
  const text = String(raw || '').replace(/[\u2192\u21D2]/g, '->');
  const wantsPerson = /\bwho\b/.test(q) || /\bwhich\s+(?:person|player|student|candidate|team|participant|contestant)\b/.test(q) || /\bwinner\b|\bchampion\b/.test(q);
  const wantsNumeric = /\bwhat\b/.test(q) || /\bhow much\b/.test(q) || /\bhow many\b/.test(q) || /\b(score|scores|point|points|mark|marks|vote|votes|number|numbers)\b/.test(q);
  const wantsMax = /\b(highest|highest score|most|largest|greatest|max(?:imum)?|top|best|winner|won|higher|better)\b/.test(q);
  const wantsMin = /\b(lowest|least|smallest|min(?:imum)?|fewest|worst|lower|less)\b/.test(q);

  if (!wantsMax && !wantsMin) return null;
  if (wantsNumeric && !wantsPerson) return null;

  const pairs = [];
  const scorePattern = /(-?\d+(?:\.\d+)?)/g;
  let match;
  while ((match = scorePattern.exec(text)) !== null) {
    const value = Number(match[1]);
    const before = text.slice(0, match.index).trim();
    const candidate = extractCandidateName(before);
    if (candidate) {
      pairs.push({ name: candidate, value });
    }
  }

  if (!pairs.length) return null;

  const best = pairs.reduce((selected, current) => {
    if (!selected) return current;
    if (wantsMax) return current.value > selected.value ? current : selected;
    return current.value < selected.value ? current : selected;
  }, null);

  return best ? best.name : null;
}

function extractCandidateName(beforeText) {
  const stopwords = new Set([
    'who', 'what', 'which', 'where', 'when', 'why', 'how', 'is', 'are', 'was', 'were',
    'score', 'scores', 'scored', 'scoring', 'got', 'gets', 'get', 'earned', 'earn',
    'receive', 'received', 'made', 'has', 'had', 'have', 'with', 'highest', 'higher',
    'lowest', 'lower', 'least', 'smallest', 'largest', 'greatest', 'winner', 'won',
    'among', 'between', 'and', 'or', 'the', 'a', 'an', 'of', 'to', 'for', 'points',
    'point', 'marks', 'mark', 'votes', 'vote', 'score', 'scores', 'top', 'best'
  ]);

  const numberMatches = [...beforeText.matchAll(/-?\d+(?:\.\d+)?/g)];
  const chunk = numberMatches.length
    ? beforeText.slice(numberMatches[numberMatches.length - 1].index + numberMatches[numberMatches.length - 1][0].length)
    : beforeText;

  const tokens = chunk.match(/[A-Za-z][A-Za-z'’-]*/g);
  if (!tokens || tokens.length === 0) return null;

  while (tokens.length && stopwords.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }

  while (tokens.length && stopwords.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }

  if (!tokens.length) return null;

  const candidate = tokens.slice(0, 3).join(' ').trim();
  if (!candidate || stopwords.has(candidate.toLowerCase())) return null;
  return candidate;
}

function answerFilteredNumbers(raw) {
  const q = String(raw || '').toLowerCase();
  if (!/\b(sum|total|add|count|how many|average|mean|product|multiply|largest|smallest|maximum|minimum|max|min)\b/.test(q)) return null;
  if (!/\b(even|evens|odd|odds|positive|negative|prime|divisible|multiple|multiples|greater|less|above|below|numbers?|integers?|values?)\b/.test(q)) return null;

  const nums = extractListNumbers(raw);
  if (nums.length === 0) return null;

  let selected = nums;
  if (/\bevens?\b/.test(q)) selected = selected.filter(n => Number.isInteger(n) && Math.abs(n) % 2 === 0);
  if (/\bodds?\b/.test(q)) selected = selected.filter(n => Number.isInteger(n) && Math.abs(n) % 2 === 1);
  if (/\bpositive\b/.test(q)) selected = selected.filter(n => n > 0);
  if (/\bnegative\b/.test(q)) selected = selected.filter(n => n < 0);
  if (/\bprime\b/.test(q)) selected = selected.filter(n => isPrime(Math.abs(n)));

  const divisibleMatch = q.match(/divisible by\s+(-?\d+)|multiples? of\s+(-?\d+)/);
  if (divisibleMatch) {
    const divisor = Math.abs(Number(divisibleMatch[1] || divisibleMatch[2]));
    if (divisor !== 0) selected = selected.filter(n => Number.isInteger(n) && n % divisor === 0);
  }

  const greaterMatch = q.match(/(?:greater than|more than|above)\s+(-?\d+(?:\.\d+)?)/);
  if (greaterMatch) selected = selected.filter(n => n > Number(greaterMatch[1]));

  const lessMatch = q.match(/(?:less than|below|under)\s+(-?\d+(?:\.\d+)?)/);
  if (lessMatch) selected = selected.filter(n => n < Number(lessMatch[1]));

  const atLeastMatch = q.match(/(?:at least|greater than or equal to)\s+(-?\d+(?:\.\d+)?)/);
  if (atLeastMatch) selected = selected.filter(n => n >= Number(atLeastMatch[1]));

  const atMostMatch = q.match(/(?:at most|less than or equal to)\s+(-?\d+(?:\.\d+)?)/);
  if (atMostMatch) selected = selected.filter(n => n <= Number(atMostMatch[1]));

  if (/\bcount\b|\bhow many\b/.test(q)) return String(selected.length);
  if (/\b(?:largest|maximum|max|highest)\b/.test(q)) return selected.length ? formatNumber(Math.max(...selected)) : '0';
  if (/\b(?:smallest|minimum|min|lowest)\b/.test(q)) return selected.length ? formatNumber(Math.min(...selected)) : '0';
  if (/\baverage\b|\bmean\b/.test(q)) {
    if (selected.length === 0) return '0';
    return formatNumber(selected.reduce((a, b) => a + b, 0) / selected.length);
  }
  if (/\bproduct\b|\bmultiply\b/.test(q)) {
    if (selected.length === 0) return '0';
    return formatNumber(selected.reduce((a, b) => a * b, 1));
  }
  if (/\bsum\b|\btotal\b|\badd\b/.test(q)) {
    return formatNumber(selected.reduce((a, b) => a + b, 0));
  }

  return null;
}

function extractListNumbers(raw) {
  const text = String(raw || '');
  const listMatch = text.match(/(?:numbers?|integers?|values?|list|array)\s*[:=]\s*([^.;\n]+)/i);
  if (listMatch) {
    const parsed = extractNumbers(listMatch[1]);
    if (parsed.length) return parsed;
  }

  const bracketMatch = text.match(/\[([^\]]+)\]|\(([^\)]+)\)/);
  if (bracketMatch) {
    const parsed = extractNumbers(bracketMatch[1] || bracketMatch[2]);
    if (parsed.length) return parsed;
  }

  return extractNumbers(raw);
}

function extractNumbers(raw) {
  const explicit = String(raw || '').match(/(?:minus|negative)?\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gi);
  if (explicit?.length) {
    return explicit.map(value => {
      const isNegative = /\b(minus|negative)\b/i.test(value);
      const parsed = Number(value.replace(/\b(minus|negative)\b/gi, '').replace(/,/g, '').trim());
      return isNegative ? -Math.abs(parsed) : parsed;
    });
  }

  const words = String(raw || '').toLowerCase().match(/\b(?:minus |negative )?(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and|-|\s)+\b/g) || [];
  return words
    .map(segment => parseNumberWords(segment))
    .filter(value => value !== null);
}

function answerOddEven(q) {
  if (!/\b(odd|even|parity|divisible by 2|multiple of 2)\b/.test(q)) return null;

  const asksOdd = /\bodd\b/.test(q);
  const asksEven = /\beven\b|\bdivisible by 2\b|\bmultiple of 2\b/.test(q);
  const value = extractParityValue(q);
  if (value === null) return null;

  const isOddValue = Math.abs(value) % 2 === 1;
  if (asksOdd) return isOddValue ? 'YES' : 'NO';
  if (asksEven) return !isOddValue ? 'YES' : 'NO';
  return isOddValue ? 'ODD' : 'EVEN';
}

function extractParityValue(q) {
  const expr = parseSimpleExpression(q);
  if (expr !== null) return expr;

  const digitMatch = q.match(/(?:minus|negative)?\s*-?\d[\d,]*/);
  if (digitMatch) {
    const isNegative = /\b(minus|negative)\b/.test(digitMatch[0]);
    const value = Number(digitMatch[0].replace(/\b(minus|negative)\b/g, '').replace(/,/g, '').trim());
    return isNegative ? -Math.abs(value) : value;
  }

  const wordNumber = parseNumberWords(q);
  if (wordNumber !== null) return wordNumber;

  return null;
}

function parseSimpleExpression(q) {
  const normalized = normalizeNumberWordsForMath(q)
    .replace(/,/g, '')
    .replace(/\bplus\b|\badded to\b/g, '+')
    .replace(/\bminus\b|\bsubtracted by\b/g, '-')
    .replace(/\btimes\b|\bmultiplied by\b|\bmultiplied with\b/g, '*')
    .replace(/\bdivided by\b/g, '/');

  const patterns = [
    { re: /sum of (-?\d+) and (-?\d+)/, fn: (a, b) => a + b },
    { re: /add (-?\d+) and (-?\d+)/, fn: (a, b) => a + b },
    { re: /(-?\d+) plus (-?\d+)/, fn: (a, b) => a + b },
    { re: /(-?\d+)\s*\+\s*(-?\d+)/, fn: (a, b) => a + b },
    { re: /difference between (-?\d+) and (-?\d+)/, fn: (a, b) => a - b },
    { re: /(-?\d+)\s*-\s*(-?\d+)/, fn: (a, b) => a - b },
    { re: /product of (-?\d+) and (-?\d+)/, fn: (a, b) => a * b },
    { re: /multiply (-?\d+) and (-?\d+)/, fn: (a, b) => a * b },
    { re: /(-?\d+)\s*(?:x|\*)\s*(-?\d+)/, fn: (a, b) => a * b },
    { re: /(-?\d+)\s*\/\s*(-?\d+)/, fn: (a, b) => b === 0 ? null : a / b }
  ];

  for (const { re, fn } of patterns) {
    const match = normalized.match(re);
    if (match) {
      const value = fn(Number(match[1]), Number(match[2]));
      return Number.isInteger(value) ? value : null;
    }
  }

  const squareMatch = normalized.match(/(?:square of (-?\d+)|(-?\d+) squared)/);
  if (squareMatch) {
    const n = Number(squareMatch[1] || squareMatch[2]);
    return n * n;
  }

  const cubeMatch = normalized.match(/(?:cube of (-?\d+)|(-?\d+) cubed)/);
  if (cubeMatch) {
    const n = Number(cubeMatch[1] || cubeMatch[2]);
    return n * n * n;
  }

  return null;
}

function parseNumberWords(text) {
  const normalized = text.toLowerCase().replace(/-/g, ' ').replace(/\band\b/g, ' ');
  const units = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19
  };
  const tens = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };
  const tokens = normalized.match(/\b(minus|negative|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/g);
  if (!tokens) return null;

  let total = 0;
  let current = 0;
  let sign = 1;
  let sawNumber = false;

  for (const token of tokens) {
    if (token === 'minus' || token === 'negative') {
      sign = -1;
    } else if (token in units) {
      current += units[token];
      sawNumber = true;
    } else if (token in tens) {
      current += tens[token];
      sawNumber = true;
    } else if (token === 'hundred') {
      current = (current || 1) * 100;
      sawNumber = true;
    } else if (token === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
      sawNumber = true;
    }
  }

  return sawNumber ? sign * (total + current) : null;
}

function normalizeNumberWordsForMath(text) {
  return text.replace(/\b(?:minus |negative )?(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and|-|\s)+\b/gi, segment => {
    const parsed = parseNumberWords(segment);
    return parsed === null ? segment : String(parsed);
  });
}

function extractDate(input) {
  const text = String(input || '');
  const months = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const monthNames = {
    jan: 'January', january: 'January',
    feb: 'February', february: 'February',
    mar: 'March', march: 'March',
    apr: 'April', april: 'April',
    may: 'May',
    jun: 'June', june: 'June',
    jul: 'July', july: 'July',
    aug: 'August', august: 'August',
    sep: 'September', sept: 'September', september: 'September',
    oct: 'October', october: 'October',
    nov: 'November', november: 'November',
    dec: 'December', december: 'December'
  };

  const ordinal = '(?:st|nd|rd|th)?';
  const day = '(?:[0-2]?\\d|3[01])';
  const year = '(?:\\d{4})';

  let match = text.match(new RegExp(`\\b(${day})${ordinal}\\s+(${months})\\s*,?\\s*(${year})\\b`, 'i'));
  if (match) return `${Number(match[1])} ${normalizeMonth(match[2], monthNames)} ${match[3]}`;

  match = text.match(new RegExp(`\\b(${months})\\s+(${day})${ordinal}\\s*,?\\s*(${year})\\b`, 'i'));
  if (match) return `${normalizeMonth(match[1], monthNames)} ${Number(match[2])}, ${match[3]}`;

  match = text.match(new RegExp(`\\b(${day})${ordinal}\\s+of\\s+(${months})\\s*,?\\s*(${year})\\b`, 'i'));
  if (match) return `${Number(match[1])} ${normalizeMonth(match[2], monthNames)} ${match[3]}`;

  match = text.match(new RegExp(`\\b(${day})${ordinal}\\s+(${months})\\b`, 'i'));
  if (match) return `${Number(match[1])} ${normalizeMonth(match[2], monthNames)}`;

  match = text.match(new RegExp(`\\b(${months})\\s+(${day})${ordinal}\\b`, 'i'));
  if (match) return `${normalizeMonth(match[1], monthNames)} ${Number(match[2])}`;

  match = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (match) return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;

  match = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (match) return `${pad2(match[1])}/${pad2(match[2])}/${match[3]}`;

  match = text.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (match) return `${match[1]}/${pad2(match[2])}/${pad2(match[3])}`;

  match = text.match(/\b(?:today|tomorrow|yesterday)\b/i);
  if (match) return match[0].toLowerCase();

  return null;
}

function normalizeMonth(month, monthNames) {
  return monthNames[String(month).toLowerCase().replace('.', '')] || month;
}

function pad2(value) {
  return String(value).padStart(2, '0');
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
  const body = req.body || {};
  const query = resolveQuery(body);
  const assets = normalizeAssets(body.assets || body.asset || body.urls || body.files || []);

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
    const assetResult = answerFromAssets(query, assetContents);
    if (assetResult) {
      console.log(`  → Asset answer (${Date.now() - startTime}ms): ${assetResult}`);
      return res.json({ output: assetResult });
    }

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

function resolveQuery(body) {
  const value =
    body.query ??
    body.question ??
    body.prompt ??
    body.input ??
    body.message ??
    body.text ??
    body.q;

  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

function normalizeAssets(assets) {
  const list = Array.isArray(assets) ? assets : [assets];
  return list
    .map(asset => {
      if (typeof asset === 'string') return asset;
      return asset?.url || asset?.href || asset?.src || asset?.link || asset?.content || asset?.text || asset?.data || '';
    })
    .filter(Boolean);
}

function answerFromAssets(query, assetContents = []) {
  if (!assetContents.length) return null;
  const q = String(query || '').toLowerCase();
  const text = assetContents.join('\n').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();

  const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white', 'gray', 'grey', 'pink', 'brown'];
  if (/\bcolor\b|\bcolour\b/.test(q)) {
    const color = colors.find(c => new RegExp(`\\b${c}\\b`, 'i').test(text));
    if (color) return color;
  }

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (/\bemail\b/.test(q) && emailMatch) return emailMatch[0];

  const phoneMatch = text.match(/\+?\d[\d\s().-]{7,}\d/);
  if (/\bphone\b|\bmobile\b|\bcontact\b/.test(q) && phoneMatch) return phoneMatch[0].trim();

  const urlMatch = text.match(/https?:\/\/[^\s)]+/i);
  if (/\burl\b|\blink\b|\bwebsite\b/.test(q) && urlMatch) return urlMatch[0];

  if (/\bfirst sentence\b/.test(q)) {
    const sentence = text.match(/[^.!?]+[.!?]/)?.[0]?.trim();
    if (sentence) return sentence;
  }

  if (/\blast sentence\b/.test(q)) {
    const sentences = text.match(/[^.!?]+[.!?]/g);
    if (sentences?.length) return sentences[sentences.length - 1].trim();
  }

  const capitalMatch = q.match(/capital of ([a-z ]+)/);
  if (capitalMatch && lower.includes(capitalMatch[1].trim())) {
    const sentence = text.match(new RegExp(`[^.!?]*${capitalMatch[1].trim()}[^.!?]*[.!?]`, 'i'))?.[0];
    if (sentence) return sentence.trim();
  }

  return null;
}

app.get('/api/answer', (req, res) => {
  res.json({
    name: 'ARIA API - Team Ben10',
    version: '2.0',
    status: 'online',
    aiConfigured: Boolean(GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here' && !GEMINI_API_KEY.startsWith('your_')),
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
    aiConfigured: Boolean(GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here' && !GEMINI_API_KEY.startsWith('your_')),
    endpoints: {
      answer: 'POST /api/answer { query, assets } → { output }',
      alt1: 'POST /v1/answer',
      alt2: 'POST /answer',
      alt3: 'POST /'
    }
  });
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
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
