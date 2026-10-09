// ===============================
// SUPABASE CLIENT SETUP / supabaseClient.js
// รองรับ Production และ Development Environment
// ===============================

// ===== 1. CONFIG: ใส่ค่าจาก Supabase Projects =====
const SUPABASE_CONFIG = {
  // 🏪 Production - ใช้งานจริง
  production: {
    url: "https://kdgmilagtpizwnhwapgl.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZ21pbGFndHBpenduaHdhcGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTYzMjgsImV4cCI6MjA5MDQzMjMyOH0.v-TtDtF7RfwxA-qxpvIBquTI8lBaTkiHQ-M7Maf5jeU"
  },
  // 🧪 Development - ทดสอบ (แอคเคาท์ส่วนตัว)
  development: {
    url: "https://vhazgytcfvjhhikiqpwm.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoYXpneXRjZnZqaGhpa2lxcHdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjA1MjgsImV4cCI6MjA4NjIzNjUyOH0.wHHUPop0xMrUgX6X8Jkk-fahVfIMW-iYx4NT0zg5lxM"
  }
};

// ===== 2. DETECT ENVIRONMENT อัตโนมัติ =====
function detectEnvironment() {
  const hostname = window.location.hostname;

  // 🔧 บังคับ environment เองได้ (ใช้ตอนทดสอบบนเครื่อง):
  //    เปิด  http://127.0.0.1:5500/pages/auth/login.html?env=production  → ใช้ PROD
  //    เปิด  ...?env=development → กลับมาใช้ DEV   |  ...?env=auto → ล้างค่าที่บังคับไว้
  try {
    const q = new URLSearchParams(window.location.search).get('env');
    if (q === 'production' || q === 'development') localStorage.setItem('EA_ENV', q);
    if (q === 'auto') localStorage.removeItem('EA_ENV');
    const forced = localStorage.getItem('EA_ENV');
    if (forced === 'production' || forced === 'development') return forced;
  } catch (e) { /* localStorage ใช้ไม่ได้ → ใช้ค่าอัตโนมัติ */ }
  
  // localhost หรือ 127.0.0.1 = Development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'development';
  }
  
  // อื่นๆ = Production
  return 'production';
}

// ===== 3. สร้าง CLIENT =====
const ENV = detectEnvironment();
const config = SUPABASE_CONFIG[ENV];

// ตรวจสอบ Supabase library
if (typeof supabase === 'undefined') {
  console.error('❌ Supabase library ยังไม่ถูกโหลด!');
  throw new Error('Supabase library is not loaded');
}

// สร้าง client
const supabaseClient = supabase.createClient(config.url, config.anonKey);

// ===== 4. LOG และ BADGE =====
const envEmoji = ENV === 'production' ? '🏪' : '🧪';
const envLabel = ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';

console.log(`${envEmoji} Environment: ${envLabel}`);
console.log(`📡 Supabase URL: ${config.url}`);

// แสดง Badge มุมจอ (เฉพาะ Dev)
const IS_LOCAL_HOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (ENV === 'development' || IS_LOCAL_HOST) {
  document.addEventListener('DOMContentLoaded', () => {
    const badge = document.createElement('div');
    badge.innerHTML = ENV === 'development' ? '🧪 DEV' : '🏪 PROD (local)';
    badge.style.cssText = `
      position: fixed;
      top: 8px;
      right: 8px;
      background: ${ENV === 'development' ? '#f59e0b' : '#dc2626'};
      color: white;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      z-index: 99999;
      font-family: sans-serif;
    `;
    document.body.appendChild(badge);
  });
}

// ===== 5. EXPORT =====
window.supabaseClient = supabaseClient;
window.APP_ENV = ENV;

console.log('✅ Supabase client initialized');