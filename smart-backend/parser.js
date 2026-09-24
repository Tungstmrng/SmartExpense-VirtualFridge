/**
 * Multi-Line Lookahead Parser & Typo-Tolerant Regex for Retail Receipts
 * Digunakan untuk mengekstrak rincian item belanja dan harga dari teks mentah OCR Tesseract.js
 */

function parseReceiptText(rawText) {
    // 1. Pecah teks berdasarkan baris dan bersihkan spasi berlebih
    const lines = rawText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    let items = [];
    let totalAmount = 0;

    // Kata kunci pengenal ringkasan pembayaran (untuk diabaikan sebagai item barang)
    const noiseKeywords = [
        'TOTAL', 'TOT4L', 'T0TAL', 'TUNAI', 'CASH', 'KEMBALI', 'CHANGE', 
        'PPN', 'PAJAK', 'SUBTOTAL', 'SUB TOTAL', 'DEBIT', 'QRIS', 'VISA', 'MASTER',
        'ALFAMART', 'INDOMARET', 'JL.', 'TELP', 'KASIR', 'STRUK', 'NOTA'
    ];

    for (let i = 0; i < lines.length; i++) {
        let currentLine = lines[i];
        let upperLine = currentLine.toUpperCase();

        // Cek apakah baris ini adalah baris Total Pembayaran
        if (upperLine.includes('TOTAL') && !upperLine.includes('SUB')) {
            const priceMatch = currentLine.match(/[\d.,]+/g);
            if (priceMatch) {
                const cleanedPrice = parseNumericPrice(priceMatch[priceMatch.length - 1]);
                if (cleanedPrice > 0) totalAmount = cleanedPrice;
            }
            continue;
        }

        // Abaikan baris yang mengandung noise keywords toko
        if (noiseKeywords.some(keyword => upperLine.includes(keyword))) {
            continue;
        }

        // Deteksi pola harga (biasanya angka di akhir baris atau di baris berikutnya)
        // Contoh format struk: "MINYAK GORENG 2L" diikuti harga "35.000"
        let itemName = currentLine;
        let itemPrice = 0;

        // Cek apakah baris saat ini mengandung angka harga di ujungnya (Single-line item + price)
        const inlinePriceMatch = currentLine.match(/(.*?)\s+([\d.,]{3,})$/);
        
        if (inlinePriceMatch) {
            itemName = inlinePriceMatch[1].trim();
            itemPrice = parseNumericPrice(inlinePriceMatch[2]);
        } else if (i + 1 < lines.length) {
            // Multi-Line Lookahead: Nama barang di baris i, harga ada di baris i + 1
            const nextLine = lines[i + 1];
            const nextLinePriceMatch = nextLine.match(/^([\d.,]{3,})$/);
            
            if (nextLinePriceMatch) {
                itemPrice = parseNumericPrice(nextLinePriceMatch[1]);
                i++; // Lompat ke baris harga berikutnya
            }
        }

        // Jika valid item ditemukan (memiliki nama dan harga > 0)
        if (itemName.length > 2 && itemPrice > 0) {
            items.push({
                name: cleanItemName(itemName),
                price: itemPrice,
                category: autoCategorizeItem(itemName) // Fitur Auto-Categorization otomatis
            });
        }
    }

    return {
        merchant: detectMerchant(rawText),
        date: new Date().toISOString(),
        items: items,
        totalCalculated: items.reduce((sum, item) => sum + item.price, 0),
        totalReported: totalAmount
    };
}

// Fungsi helper untuk membersihkan format angka harga (misal: "35.000,00" atau "35,000")
function parseNumericPrice(priceStr) {
    const cleanStr = priceStr.replace(/[^\d]/g, '');
    return parseInt(cleanStr, 10) || 0;
}

// Fungsi helper untuk membersihkan nama barang dari karakter OCR noise
function cleanItemName(name) {
    return name
        .replace(/[^a-zA-Z0-9\s]/g, '') // Hapus simbol aneh hasil OCR error
        .replace(/\s+/g, ' ')
        .trim();
}

// Fitur Auto-Categorization Berdasarkan Keyword Sederhana
function autoCategorizeItem(name) {
    const upper = name.toUpperCase();
    if (upper.includes('SUSU') || upper.includes('ROTI') || upper.includes('MIE') || upper.includes('BERAS') || upper.includes('MINYAK') || upper.includes('TELUR')) {
        return 'Bahan Pangan & Sembako';
    } else if (upper.includes('SABUN') || upper.includes('SHAMPO') || upper.includes('PASTA') || upper.includes('SUNLIGHT') || upper.includes('TISU')) {
        return 'Kebersihan & Perawatan';
    } else if (upper.includes('CHITATO') || upper.includes('COCA') || upper.includes('SNACK') || upper.includes('BISKUIT') || upper.includes('TEH')) {
        return 'Camilan & Minuman';
    }
    return 'Kebutuhan Umum';
}

// Deteksi nama minimarket
function detectMerchant(text) {
    const upper = text.toUpperCase();
    if (upper.includes('INDOMARET')) return 'Indomaret';
    if (upper.includes('ALFAMART')) return 'Alfamart';
    if (upper.includes('SUPERINDO')) return 'Super Indo';
    return 'Ritel Modern';
}

module.exports = { parseReceiptText };