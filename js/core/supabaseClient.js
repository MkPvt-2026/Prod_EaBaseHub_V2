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
  "https://avtlvhrxqcivtiiwcjxg.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2dGx2aHJ4cWNpdnRpaXdjanhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODI4MzIsImV4cCI6MjA5MDM1ODgzMn0.CBIwKdj7kcnSMSFZoM3uu2L5YtJ_0zm8Tfa-0lu0Bbg"
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
