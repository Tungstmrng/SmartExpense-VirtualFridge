require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// Daftar variasi nama model yang akan dites otomatis
const candidateModels = [
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
  "gemini-pro"
];

async function findWorkingModel() {
  console.log('🔍 Mencari nama model yang cocok dengan API Key kamu...\n');

  for (const modelName of candidateModels) {
    try {
      process.stdout.write(`⏳ Mencoba model "${modelName}"... `);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Balas 'OK'");
      
      console.log('✅ BERHASIL!');
      console.log('=================================================');
      console.log(`🎉 NAMA MODEL YANG COCOK: "${modelName}"`);
      console.log(`💬 Respon Gemini: ${result.response.text().trim()}`);
      console.log('=================================================\n');
      console.log(`👉 Langkah selanjutnya: Pakai nama "${modelName}" di server.js kamu!`);
      return; // Berhenti jika sudah dapat yang sukses
    } catch (error) {
      console.log(`❌ Gagal (${error.status || '404'})`);
    }
  }

  console.log('\n⚠️ Tidak ada model yang cocok. Pastikan package sudah diupdate: npm install @google/generative-ai@latest');
}

findWorkingModel();