// Optional AI-powered fallback for bank statement PDFs the built-in
// text/regex parser (src/import.js) can't read. Uses the user's own
// Anthropic API key (see src/aiKey.js) -- the browser calls Anthropic's
// API directly with that key, so no server of ours ever sees the key or
// the statement content. Only the plain text already extracted locally by
// pdfjs is sent (never the raw PDF file), and only when the user explicitly
// clicks "Try AI-Powered Parsing" after the built-in parser has failed.

import { extractPdfLines, parseCsvTransactions } from './import.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const ACCOUNT_NUMBER_RE = /\b(?:account|acct|routing|card)\s*(?:no\.?|number|#)?\s*[:#]?\s*[\dXx*-]{6,}\b/gi;

// Strips lines that look like account/routing/card numbers before anything
// leaves the device -- these aren't needed to identify a transaction anyway.
function redactSensitiveLines(lines) {
  return lines.map(line => line.replace(ACCOUNT_NUMBER_RE, '[redacted]'));
}

async function callClaude(lines, apiKey) {
  const statementText = redactSensitiveLines(lines).join('\n');

  const prompt = `You are extracting transactions from a bank or credit-card statement. Below is raw text extracted from a PDF (line breaks may be imperfect, columns may run together).

Return ONLY plain CSV, no explanation, no markdown code fences. The first line must be exactly:
Date,Description,Amount

Then one row per expense/purchase transaction:
- Skip deposits, payments received, credits, refunds, and non-transaction lines (headers, totals, balances, account info).
- Date format: YYYY-MM-DD
- Amount: positive number, no currency symbol

Statement text:
${statementText}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('That API key was rejected. Check it in Profile & Settings.');
    if (res.status === 429) throw new Error('Rate limited by Anthropic. Wait a moment and try again.');
    throw new Error(`AI request failed (status ${res.status}).`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

// Same return shape as parsePdfTransactions in import.js:
// { transactions, error, aiParsed }
export async function parsePdfTransactionsWithAI(file, apiKey) {
  let lines;
  try {
    lines = await extractPdfLines(file);
  } catch (e) {
    console.error('PDF text extraction failed', e);
    return { transactions: [], error: "Couldn't read that PDF. It may be scanned/image-based rather than text-based." };
  }

  if (lines.length === 0) {
    return { transactions: [], error: 'No readable text found in this PDF.' };
  }

  let csvText;
  try {
    csvText = await callClaude(lines, apiKey);
  } catch (e) {
    console.error('AI parsing failed', e);
    return { transactions: [], error: e.message || 'AI parsing failed. Please try again.' };
  }

  const { transactions } = parseCsvTransactions(csvText);
  if (transactions.length === 0) {
    return { transactions: [], error: "The AI couldn't find any transactions in this statement either." };
  }
  return { transactions, error: null, aiParsed: true };
}
