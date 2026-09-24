const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Tesseract = require('tesseract.js');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// KATEGORI PENGELUARAN RUMAH TANGGA & ITEM BELANJA
const EXPENSE_CATEGORIES = [
  { keywords: ['milk', 'susu', 'uht', 'creamer', 'indomilk', 'ultramilk', 'dancow', 'beras', 'rice', 'minyak', 'oil', 'telur', 'egg', 'gula', 'sugar', 'garam', 'tepung', 'mie', 'indomie', 'sedaap'], category: 'Bahan Pangan & Sembako' },
  { keywords: ['sabun', 'shampoo', 'shampo', 'pasta', 'tooth', 'pencuci', 'sunlight', 'rinso', 'so klin', 'downy', 'tisu', 'tissue', 'cleaner', 'pembersih'], category: 'Kebersihan & Rumah Tangga' },
  { keywords: ['chitato', 'coca', 'sprite', 'fanta', 'snack', 'biskuit', 'oreo', 'teh', 'tea', 'kopi', 'coffee', 'qtela', 'chocolatos'], category: 'Camilan & Minuman' },
  { keywords: ['roti', 'bread', 'sosis', 'sausage', 'nugget', 'keju', 'cheese', 'butter', 'mentega', 'yogurt', 'tahu', 'tempe'], category: 'Makanan Segar & Siap Saji' }
];

function categorizeItem(itemName) {
  const nameLower = itemName.toLowerCase().trim();
  for (const group of EXPENSE_CATEGORIES) {
    if (group.keywords.some(kw => nameLower.includes(kw))) {
      return group.category;
    }
  }
  return 'Kebutuhan Umum';
}

// HELPER: CLEAN ITEM NAMES FROM COLUMN NOISE & LEADING QUANTITIES
function sanitizeItemName(rawName) {
  return rawName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/^\d+\s+/, '')
    .replace(/\s+\d+(\s+\d+)*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReceiptText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let merchantName = 'Ritel Modern';
  let totalAmount = 0;
  const items = [];

  // REGEX PATTERNS FOR SUMMARY & PAYMENT WORDS (HANDLES OCR TYPOS LIKE T0TAL, TUNAL, KEMBAL1)
  const SUMMARY_PATTERNS = [
    /t[o0][t4a][a4l]/i,           // TOTAL, T0TAL, TOT4L, TOTL
    /sub\s*t[o0]t[a4]l/i,         // SUBTOTAL, SUB TOTAL
    /g[r1]and\s*t[o0]t[a4]l/i,    // GRAND TOTAL
    /t[u1n][n1a][a4i1l]/i,        // TUNAI, TUNAL, TUNA1
    /b[a4]y[a4]r/i,                // BAYAR
    /k[e3]mb[a4]l[i1a]/i,         // KEMBALI, KEMBALIAN
    /c[a4]sh/i,                   // CASH
    /ch[a4]ng[e3]/i,              // CHANGE
    /s[i1]s[a4]/i,                // SISA
    /p[a4]j[a4]k|ppn|tax/i,        // PAJAK, PPN, TAX
    /d[e3]b[i1]t/i,                // DEBIT
    /qr[i1]s|g[o0]p[a4]y|ov[o0]|sh[o0]p[e3]e|d[a4]n[a4]/i, // QRIS, GOPAY, OVO, SHOPEE, DANA
    /m[a4]st[e3]rc[a4]rd|v[i1]s[a4]|b[a4]nk|bc[a4]|m[a4]nd[i1]r[i1]/i,
    /h[a4]rg[a4]|j[u1]ml[a4]h|qt[y1]|it[e3]m/i,
    /d[i1]s[ck][o0]n|d1sc|p[o0]t[o0]ng[a4]n|h[e3]m[a4]t|pr[o0]m[o0]/i
  ];

  // EXPANDED ADDRESS & STORE NOISE PATTERNS
  const ignorePatterns = [
    /\b(jl|jln|j1|jalan|no|rt|rw|kel|kec|kab|kota|lantai|lt|ruko|blok|gedung|cabang|outlet|branch|plaza|mall)\b/i,
    /\b(indomaret|alfamart|alfamidi|superindo|hypermart|transmart|circle\s*k|minimarket)\b/i,
    /\b(sleman|sukoharjo|ngaglik|yogyakarta|jogja|bandung|jakarta|surabaya|semarang|malang|solo|denpasar|bogor|depok|tangerang|bekasi)\b/i,
    /\b(telp|telepon|phone|fax|pos|zip|code|kodepos|npwp|stnk|kasir|cashier|pos\d+|resi|faktur|member)\b/i,
    /\b(\d{10,13})\b/,
    /\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}/, 
    /\d{1,2}:\d{2}/,                       
    /terima\s*kasih|thank\s*you|selamat\s*datang|voucher|cancel|layanan/i,
    /^\s*-\s*\d+/,
    /-\s*(\d{1,3}(?:[.,]\d{3})+|\b\d{3,6}\b)/
  ];

  const isNoiseOrSummary = (text) => {
    if (!text) return true;
    const textLower = text.toLowerCase().trim();
    if (SUMMARY_PATTERNS.some(pattern => pattern.test(textLower))) return true;
    if (ignorePatterns.some(pattern => pattern.test(textLower))) return true;
    return false;
  };

  // 1. DETECT MERCHANT NAME
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (!isNoiseOrSummary(lines[i])) {
      const cleanHeader = sanitizeItemName(lines[i]);
      if (cleanHeader.length >= 3 && /[a-zA-Z]/.test(cleanHeader)) {
        merchantName = cleanHeader;
        break;
      }
    }
  }

  const priceRegex = /(\d{1,3}(?:[.,]\d{3})+|\b\d{4,6}\b)/g;

  // 2. PROCESS ITEMS WITH MULTI-LINE LOOKAHEAD
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    if (isNoiseOrSummary(line)) {
      if (lineLower.includes('total') || lineLower.includes('bayar') || lineLower.includes('t0tal')) {
        const matches = line.match(priceRegex);
        if (matches) {
          const lastPrice = matches[matches.length - 1];
          const parsedTotal = parseInt(lastPrice.replace(/[^0-9]/g, ''), 10);
          if (parsedTotal > totalAmount) totalAmount = parsedTotal;
        }
      }
      continue;
    }

    if (line.includes('-') && !lineLower.includes('item')) {
      continue;
    }

    const priceMatches = line.match(priceRegex);

    // KASUS A: ITEM 1 BARIS
    if (priceMatches) {
      const rawPrice = priceMatches[priceMatches.length - 1];
      const numericPrice = parseInt(rawPrice.replace(/[^0-9]/g, ''), 10);
      
      const rawNamePart = line.replace(rawPrice, '');
      const cleanedName = sanitizeItemName(rawNamePart);

      if (isNoiseOrSummary(cleanedName)) {
        continue;
      }

      const letterOnlyCount = cleanedName.replace(/[^a-zA-Z]/g, '').length;

      if (letterOnlyCount >= 3 && numericPrice >= 1000 && numericPrice <= 1000000) {
        const category = categorizeItem(cleanedName);
        items.push({
          id: Date.now() + Math.floor(Math.random() * 10000) + i,
          name: cleanedName,
          price: numericPrice,
          category: category
        });
        continue;
      }
    }

    // KASUS B: ITEM 2 BARIS (Multi-Line Lookahead)
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      
      if (!isNoiseOrSummary(nextLine)) {
        const nextPriceMatches = nextLine.match(priceRegex);

        if (nextPriceMatches) {
          const rawPrice = nextPriceMatches[nextPriceMatches.length - 1];
          const numericPrice = parseInt(rawPrice.replace(/[^0-9]/g, ''), 10);

          const cleanedName = sanitizeItemName(line);

          if (isNoiseOrSummary(cleanedName)) {
            continue;
          }

          const letterOnlyCount = cleanedName.replace(/[^a-zA-Z]/g, '').length;

          if (letterOnlyCount >= 3 && numericPrice >= 1000 && numericPrice <= 1000000) {
            const category = categorizeItem(cleanedName);
            items.push({
              id: Date.now() + Math.floor(Math.random() * 10000) + i,
              name: cleanedName,
              price: numericPrice,
              category: category
            });

            i++; 
            continue;
          }
        }
      }
    }
  }

  if (totalAmount === 0 && items.length > 0) {
    totalAmount = items.reduce((sum, item) => sum + item.price, 0);
  }

  return {
    merchant_name: merchantName,
    total_amount: totalAmount,
    items: items
  };
}

app.post('/api/scan', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No receipt image uploaded.' 
      });
    }

    console.log('[INFO] Received receipt image, processing with Tesseract OCR...');

    const { data: { text } } = await Tesseract.recognize(
      req.file.buffer,
      'eng',
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`[OCR PROGRESS] ${(m.progress * 100).toFixed(0)}%`);
          }
        }
      }
    );

    console.log('[DEBUG] Raw Extracted Text:\n', text);

    const parsedData = parseReceiptText(text);

    console.log('[INFO] Successfully parsed receipt data:', parsedData);

    return res.json({
      success: true,
      data: parsedData,
    });

} catch (error) {
    console.error('[ERROR] Tesseract Processing Failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process receipt image.',
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Backend running locally at http://0.0.0.0:${PORT}`);
});