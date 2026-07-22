require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// Set up penyimpanan sementara file foto
const upload = multer({ dest: 'uploads/' });

// Pengecekan Ketersediaan API Key saat Server Startup
console.log('=================================================');
if (!process.env.GEMINI_API_KEY) {
  console.log('❌ FATAL ERROR: GEMINI_API_KEY tidak ditemukan di file .env!');
} else {
  console.log(`🔑 API Key Terbaca: ${process.env.GEMINI_API_KEY.substring(0, 8)}... ✅`);
}
console.log('=================================================');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Helper: Ubah file gambar ke format base64 untuk Gemini
function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
      mimeType
    },
  };
}

// --- ENDPOINT UTAMA OCR + AI PARSING ---
app.post('/api/scan', upload.single('receipt'), async (req, res) => {
  console.log('------------------------------------');
  console.log('📩 [REQ RECEIVED] Foto struk diterima, mengirim ke Gemini...');

  if (!req.file) {
    console.log('❌ Error: File foto tidak ditemukan.');
    return res.status(400).json({ success: false, message: 'Foto tidak ditemukan!' });
  }

  try {
    // Menggunakan model Gemini 1.5 Flash (Keseimbangan terbaik antara kecepatan & kuota)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    const imagePart = fileToGenerativePart(req.file.path, req.file.mimetype || 'image/jpeg');

    const prompt = `
      Analisis foto struk belanjaan Indonesia ini.
      Ekstrak datanya dan HANYA kembalikan JSON murni tanpa markdown, tanpa backtick \`\`\`json, tanpa teks salam.

      Format JSON wajib persis seperti ini:
      {
        "merchant_name": "Nama Toko/Supermarket",
        "date": "YYYY-MM-DD",
        "total_amount": 0,
        "items": [
          {
            "name": "Nama Produk Rapi",
            "price": 0,
            "category": "Kulkas" atau "Non-Kulkas",
            "estimated_expiry_days": 7
          }
        ]
      }

      Aturan:
      1. "total_amount" & "price" berupa angka integer murni.
      2. Set "category" = "Kulkas" HANYA jika berupa bahan makanan/minuman mentah, segar, atau olahan yang disimpan di kulkas.
      3. Set "estimated_expiry_days" dengan estimasi masa simpan bahan tersebut di kulkas (misal Susu = 7, Daging = 3, Telur = 14). Jika Non-Kulkas isi 0.
    `;

    console.log('⏳ Memproses dengan Gemini AI...');
    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text().trim();

    // Hapus file gambar sementara agar folder uploads tidak penuh
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    // Pembersihan String JSON (Sanitizer)
    const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(cleanJson);

    console.log('✅ OCR & Parsing Berhasil:');
    console.log(`   • Toko  : ${parsedData.merchant_name}`);
    console.log(`   • Total : Rp ${parsedData.total_amount?.toLocaleString()}`);
    console.log(`   • Item  : ${parsedData.items?.length || 0} barang terdeteksi`);

    // Kembalikan Respon Sukses + Data Terstruktur
    return res.json({
      success: true,
      message: 'Struk berhasil diproses!',
      data: parsedData
    });

  } catch (error) {
    console.error('❌ Error OCR:', error.message);

    // Pastikan file sementara dihapus meskipun terjadi error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      success: false,
      message: 'Gagal memproses struk dengan AI.',
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend OCR Aktif di http://localhost:${PORT}`);
});