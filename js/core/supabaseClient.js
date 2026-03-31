// ===============================
// SUPABASE CLIENT SETUP / supabaseClient.js
// ไฟล์นี้ต้องโหลดก่อนไฟล์อื่นๆ ทั้งหมด
// ใช้สำหรับสร้าง Supabase client สำหรับทั้งระบบ
// ===============================

// ตรวจสอบว่ามี Supabase library โหลดแล้วหรือยัง
if (typeof supabase === 'undefined') {
  console.error('❌ Supabase library ยังไม่ถูกโหลด! ตรวจสอบ CDN script tag');
  throw new Error('Supabase library is not loaded');
}

// สร้าง Supabase Client
// ใช้ตัวแปร global เพื่อให้เข้าถึงได้จากทุกไฟล์
const supabaseClient = supabase.createClient(
  "https://kdgmilagtpizwnhwapgl.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZ21pbGFndHBpenduaHdhcGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTYzMjgsImV4cCI6MjA5MDQzMjMyOH0.v-TtDtF7RfwxA-qxpvIBquTI8lBaTkiHQ-M7Maf5jeU"
);


// ตรวจสอบว่าสร้าง client สำเร็จหรือไม่
if (!supabaseClient) {
  console.error('❌ ไม่สามารถสร้าง Supabase client ได้');
  throw new Error('Failed to create Supabase client');
}

console.log('✅ Supabase client initialized successfully');

// Export client เพื่อให้ใช้ใน ES6 modules ได้ (ถ้าต้องการ)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { supabaseClient };
}
// ✅ expose client instance (ไม่ใช่ library) ให้ทุกไฟล์เข้าถึงได้
window.supabaseClient = supabaseClient; // alias ให้ปลอดภัย


const isDev =
  window.location.hostname.includes("dev") ||
  window.location.hostname.includes("localhost");

const SUPABASE_URL = isDev
  ? "https://vhazeytcfyhhikiqpvn.supabase.co"   // DEV
  : "https://kdgmilagtpizwnhwapgl.supabase.co"; // PROD

const SUPABASE_KEY = isDev
  ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoYXpneXRjZnZqaGhpa2lxcHdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjA1MjgsImV4cCI6MjA4NjIzNjUyOH0.wHHUPop0xMrUgX6X8Jkk-fahVfIMW-iYx4NT0zg5lxM"
  : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZ21pbGFndHBpenduaHdhcGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTYzMjgsImV4cCI6MjA5MDQzMjMyOH0.v-TtDtF7RfwxA-qxpvIBquTI8lBaTkiHQ-M7Maf5jeU";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

window.supabaseClient = supabaseClient;