require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// Setup penyimpanan sementara untuk file yang diunggah
const upload = multer({ dest: 'uploads/' });

// Inisialisasi Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Helper untuk mengubah file gambar ke format yang bisa dibaca Gemini
function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
      mimeType
    },
  };
}

// --- ENDPOINT UTAMA SCAN STRUK & PARSING AI ---
app.post('/api/scan', upload.single('receipt'), async (req, res) => {
  console.log('------------------------------------');
  console.log('📩 [REQ RECEIVED] Foto struk diterima, memproses dengan Gemini AI...');

  if (!req.file) {
    console.log('❌ Error: File foto tidak ditemukan.');
    return res.status(400).json({ success: false, message: 'File foto tidak ditemukan!' });
  }

  try {
    // 1. Pilih model Gemini 1.5 Flash (Sangat cepat & akurat untuk pembacaan gambar)
    // ✅ KODE BARU (Gunakan salah satu dari ini):
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const imagePart = fileToGenerativePart(req.file.path, req.file.mimetype || 'image/jpeg');

    // 2. Prompt Khusus untuk Struktur Data Kulkas & Keuangan
    const prompt = `
      Analisis foto struk belanjaan Indonesia ini.
      Ekstrak datanya dan WAKTU kembalikan HANYA berupa JSON murni tanpa teks pembuka, tanpa penjelasan, dan tanpa markdown backtick \`\`\`json.

      Struktur JSON wajib persis seperti ini:
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

      Aturan Ekstraksi:
      1. "total_amount" dan "price" harus berupa angka bulat integer (contoh: 25000, bukan "Rp 25.000").
      2. Set "category" sebagai "Kulkas" HANYA jika item adalah bahan makanan/minuman mentah, segar, atau olahan yang biasa disimpan di kulkas (Susu, Keju, Daging, Telur, Sayur, Buah, Frozen Food, Jogurt, Bumbu Segar).
      3. Sabun, Shampoo, Snack Kering, Roti Kering, Tissue, Kompos, dll set sebagai "Non-Kulkas".
      4. "estimated_expiry_days": Berikan perkiraan berapa hari bahan tersebut bisa bertahan di kulkas (misal Susu UHT = 7 hari, Daging Segar = 3 hari, Telur = 14 hari). Jika Non-Kulkas berikan nilai 0.
    `;

    console.log('⏳ Mengirim request ke Gemini Cloud API...');
    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text().trim();

    // 3. Bersihkan formatting markdown jika AI tetap mengembalikan format ```json
    const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(cleanJsonText);

    console.log('✅ Ekstraksi Gemini Berhasil:');
    console.log(`   • Toko   : ${parsedData.merchant_name}`);
    console.log(`   • Total  : Rp ${parsedData.total_amount?.toLocaleString()}`);
    console.log(`   • Items  : ${parsedData.items?.length || 0} item ditemukan`);

    // 4. Hapus file sementara di folder uploads/ agar penyimpanan laptop tidak membengkak
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // 5. Kirim respon JSON rapi ke React Native
    return res.json({
      success: true,
      message: 'Struk berhasil diproses!',
      data: parsedData
    });

  } catch (error) {
    console.error('❌ Error saat memproses struk:', error.message);

    // Hapus file foto jika terjadi eror
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      success: false,
      message: 'Gagal memproses struk dengan Gemini AI.',
      error: error.message
    });
  }
});

// Endpoint Cek Health Backend
app.get('/', (req, res) => {
  res.send('🚀 Server Backend Smart Expense & Virtual Fridge Aktif!');
});

// Jalankan Server Express
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` Server Backend aktif di http://localhost:${PORT}`);
  console.log(`=================================================`);
});