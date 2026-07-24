const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Tesseract = require('tesseract.js');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// DICTIONARY FOR FRIDGE CATEGORIZATION AND EXPIRY ESTIMATION
// ENHANCED DICTIONARY FOR FRIDGE CATEGORIZATION
const FRIDGE_KEYWORDS = [
  { keywords: ['milk', 'susu', 'uht', 'creamer', 'indomilk', 'ultramilk', 'dancow', 'm1lk', 'susu/'], category: 'Fridge', expiryDays: 7 },
  { keywords: ['egg', 'telur', 'tlor'], category: 'Fridge', expiryDays: 14 },
  { keywords: ['cheese', 'keju', 'mozzarella', 'cheddar', 'kraft'], category: 'Fridge', expiryDays: 10 },
  { keywords: ['meat', 'daging', 'beef', 'chicken', 'ayam', 'fish', 'ikan', 'seafood', 'sosis', 'sausage', 'nugget', 'so nice', 'fiesta'], category: 'Fridge', expiryDays: 3 },
  { keywords: ['veggie', 'vegetable', 'sayur', 'spinach', 'bayam', 'tomato', 'tomat', 'carrot', 'wortel', 'cabe', 'chili'], category: 'Fridge', expiryDays: 5 },
  { keywords: ['fruit', 'buah', 'apple', 'apel', 'banana', 'pisang', 'orange', 'jeruk', 'grape', 'anggur'], category: 'Fridge', expiryDays: 5 },
  { keywords: ['butter', 'mentega', 'yogurt', 'yoghurt', 'tofu', 'tahu', 'tempe', 'yakult'], category: 'Fridge', expiryDays: 7 }
];

function categorizeItem(itemName) {
  const nameLower = itemName.toLowerCase().trim();
  for (const group of FRIDGE_KEYWORDS) {
    if (group.keywords.some(kw => nameLower.includes(kw))) {
      return { category: 'Fridge', expiryDays: group.expiryDays };
    }
  }
  return { category: 'Non-Fridge', expiryDays: 0 };
}

// HELPER: CLEAN ITEM NAMES FROM COLUMN NOISE & LEADING QUANTITIES
function sanitizeItemName(rawName) {
  return rawName
    // Remove non-alphanumeric chars (keep spaces)
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    // Remove leading line numbers/quantities (e.g. "5 KOPIKO" -> "KOPIKO")
    .replace(/^\d+\s+/, '')
    // Remove trailing price/qty column digits (e.g. "ABC ORANGE 1 13 500" -> "ABC ORANGE")
    .replace(/\s+\d+(\s+\d+)*$/, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReceiptText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let merchantName = 'Store / Supermarket';
  let totalAmount = 0;
  const items = [];

  // 1. EXPANDED BLACKLIST (ADDRESSES, CITIES, & RECEIPT NOISE)
  const ignorePatterns = [
    // Address & City Keywords (Added Sleman, Sukoharjo, Ngaglik, Jogja, etc.)
    /\b(jl|jalan|no|rt|rw|kel|kec|kab|kota|lantai|lt|ruko|blok|gedung|cabang|outlet|branch|plaza|mall)\b/i,
    /\b(sleman|sukoharjo|ngaglik|yogyakarta|jogja|bandung|jakarta|surabaya|semarang|malang)\b/i,
    /\b(telp|phone|fax|pos|zip|code|kodepos|npwp)\b/i,
    
    // Receipt Metadata
    /\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}/, 
    /\d{1,2}:\d{2}/,                       
    /cash|kembali|change|tunai|debit|visa|mastercard/i,
    /subtotal|ppn|tax|diskon|discount|grand total/i,
    /faktur|member|item|qty|harga|kasir|cashier/i,
    /terima kasih|thank you|selamat datang|voucher|cancel/i
  ];

  // 2. DETECT MERCHANT NAME
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const lineLower = lines[i].toLowerCase();
    const isNoise = ignorePatterns.some(p => p.test(lineLower));
    
    if (!isNoise) {
      const cleanHeader = sanitizeItemName(lines[i]);
      if (cleanHeader.length >= 3 && !/\d/.test(cleanHeader)) {
        merchantName = cleanHeader;
        break;
      }
    }
  }

  const priceRegex = /(\d{1,3}(?:[.,]\d{3})+|\b\d{4,6}\b)/;

  // 3. PROCESS ITEMS
  for (const line of lines) {
    const lineLower = line.toLowerCase();

    if (ignorePatterns.some(pattern => pattern.test(lineLower))) {
      if (lineLower.includes('total') || lineLower.includes('bayar')) {
        const match = line.match(priceRegex);
        if (match) {
          const parsedTotal = parseInt(match[0].replace(/[^0-9]/g, ''), 10);
          if (parsedTotal > totalAmount) totalAmount = parsedTotal;
        }
      }
      continue; 
    }

    const priceMatch = line.match(priceRegex);
    if (priceMatch) {
      const rawPrice = priceMatch[0];
      const numericPrice = parseInt(rawPrice.replace(/[^0-9]/g, ''), 10);
      
      // Clean up the name string
      const rawNamePart = line.replace(rawPrice, '');
      const cleanedName = sanitizeItemName(rawNamePart);

      // Filter out address remnants or invalid names
      if (cleanedName.length >= 3 && numericPrice >= 1000 && numericPrice <= 1000000) {
        const { category, expiryDays } = categorizeItem(cleanedName);

        items.push({
          id: Date.now() + Math.floor(Math.random() * 10000),
          name: cleanedName,
          price: numericPrice,
          category: category,
          estimated_expiry_days: expiryDays
        });
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

    // Run local Tesseract OCR on image buffer
    const { data: { text } } = await Tesseract.recognize(
      req.file.buffer,
      'eng', // Uses English dictionary (can be 'eng+ind' if traineddata is configured)
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`[OCR PROGRESS] ${(m.progress * 100).toFixed(0)}%`);
          }
        }
      }
    );

    console.log('[DEBUG] Raw Extracted Text:\n', text);

    // Parse raw text into structured JSON format expected by frontend
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