// Client-side bank statement import: parses CSV or PDF files entirely in the
// browser (nothing is ever uploaded anywhere) into a normalized list of
// { date, merchant, amount } rows, with a best-effort category guess.

const CATEGORY_KEYWORDS = {
  Dining: ['restaurant', 'coffee', 'starbucks', 'cafe', 'pizza', 'mcdonald', 'chipotle', 'diner', 'grill', 'bakery', 'doordash', 'grubhub', 'ubereats'],
  Shopping: ['amazon', 'walmart', 'target', 'ebay', 'best buy', 'costco', 'store', 'mall', 'etsy'],
  Transport: ['uber', 'lyft', 'gas station', 'shell', 'chevron', 'exxon', 'parking', 'transit', 'fuel', 'dmv'],
  Entertainment: ['netflix', 'spotify', 'hulu', 'disney+', 'cinema', 'theatre', 'theater', 'movie', 'steam', 'playstation', 'xbox'],
  Bills: ['electric', 'water utility', 'utility', 'internet', 'phone bill', 'insurance', 'comcast', 'verizon', 'at&t', 'xfinity', 'mortgage', 'rent'],
  Groceries: ['grocery', 'kroger', 'safeway', 'whole foods', 'trader joe', 'supermarket', 'publix', 'aldi'],
  Travel: ['airline', 'hotel', 'flight', 'airbnb', 'marriott', 'hilton', 'expedia', 'delta air', 'united air', 'southwest']
};

export function guessCategory(description) {
  const lower = (description || '').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return category;
  }
  return null;
}

// Normalizes a date string in common bank export formats to YYYY-MM-DD
function normalizeDate(str) {
  const trimmed = (str || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    let [, month, day, year] = usMatch;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed)) return parsed.toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

// Minimal CSV parser supporting quoted fields (handles commas/quotes inside values)
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

// Parses a CSV bank export into normalized transaction rows. Returns
// { transactions, error }. Supports either a single signed Amount column
// (negative = expense, standard bank convention) or separate Debit/Credit
// columns (Debit = expense). Deposits/credits are intentionally skipped —
// this is an expense tracker, not a full ledger.
export function parseCsvTransactions(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    return { transactions: [], error: 'That file has no transaction rows.' };
  }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const findCol = (aliases) => header.findIndex(h => aliases.some(a => h.includes(a)));

  const dateIdx = findCol(['date']);
  const descIdx = findCol(['description', 'merchant', 'memo', 'payee', 'name']);
  const amountIdx = findCol(['amount']);
  const debitIdx = findCol(['debit', 'withdrawal']);

  if (dateIdx === -1 || (amountIdx === -1 && debitIdx === -1)) {
    return { transactions: [], error: "Couldn't find Date and Amount columns in this CSV. Expected headers like \"Date\" and \"Amount\" (or \"Debit\")." };
  }

  const transactions = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const dateStr = r[dateIdx];
    if (!dateStr) continue;

    let amount;
    if (debitIdx !== -1) {
      amount = parseFloat((r[debitIdx] || '').replace(/[$,]/g, ''));
      if (!amount || amount <= 0) continue;
    } else {
      amount = parseFloat((r[amountIdx] || '').replace(/[$,]/g, ''));
      if (!amount || amount > 0) continue; // skip deposits/credits
      amount = Math.abs(amount);
    }

    const merchant = descIdx !== -1 ? (r[descIdx] || '').trim() : '';
    transactions.push({
      date: normalizeDate(dateStr),
      merchant: merchant || 'Imported Transaction',
      amount,
      category: guessCategory(merchant)
    });
  }

  if (transactions.length === 0) {
    return { transactions: [], error: 'No expense rows found (only deposits/credits, or all rows were unreadable).' };
  }
  return { transactions, error: null };
}

// Reconstructs visual text lines from a PDF page's text items by grouping
// items with similar vertical position, sorted left-to-right within a line.
export async function extractPdfLines(file) {
  const pdfjsLib = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const rowMap = new Map();
    textContent.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!rowMap.has(y)) rowMap.set(y, []);
      rowMap.get(y).push(item);
    });

    const sortedYs = [...rowMap.keys()].sort((a, b) => b - a);
    sortedYs.forEach(y => {
      const rowItems = rowMap.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      const lineText = rowItems.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (lineText) lines.push(lineText);
    });
  }
  return lines;
}

const PDF_DATE_RE = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/;
const PDF_AMOUNT_RE = /-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}/g;

// Parses a PDF bank/credit-card statement into normalized transaction rows.
// This is best-effort: it looks for lines containing both a date and a
// dollar amount, and treats the text between them as the description.
// Statement layouts vary a lot, so results should be reviewed before import.
export async function parsePdfTransactions(file) {
  let lines;
  try {
    lines = await extractPdfLines(file);
  } catch (e) {
    console.error('PDF parsing failed', e);
    return { transactions: [], error: "Couldn't read that PDF. It may be scanned/image-based rather than text-based." };
  }

  const transactions = [];
  lines.forEach(line => {
    const dateMatch = line.match(PDF_DATE_RE);
    if (!dateMatch) return;

    const amountMatches = line.match(PDF_AMOUNT_RE);
    if (!amountMatches || amountMatches.length === 0) return;

    const amount = Math.abs(parseFloat(amountMatches[0].replace(/[$,\s]/g, '')));
    if (!amount) return;

    let merchant = line.replace(dateMatch[0], '');
    amountMatches.forEach(a => { merchant = merchant.replace(a, ''); });
    merchant = merchant.replace(/\s{2,}/g, ' ').trim();

    transactions.push({
      date: normalizeDate(dateMatch[0]),
      merchant: merchant || 'Imported Transaction',
      amount,
      category: guessCategory(merchant)
    });
  });

  if (transactions.length === 0) {
    return { transactions: [], error: "Couldn't find any transaction lines (with both a date and an amount) in this PDF." };
  }
  return { transactions, error: null, bestEffort: true };
}

// Dispatches to the right parser based on file extension.
export async function parseImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    return parseCsvTransactions(text);
  }
  if (name.endsWith('.pdf')) {
    return parsePdfTransactions(file);
  }
  return { transactions: [], error: 'Please upload a .csv or .pdf file.' };
}
