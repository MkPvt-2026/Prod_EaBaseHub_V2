// ======================================================
// roleConfig.js
// กำหนดสิทธิ์และหน้า default ของแต่ละ role
// โหลดไฟล์นี้ก่อน auth.js ทุกหน้า
//
// ⚠️ สำคัญ: role key ต้องตรงกับค่าที่เก็บใน DB (profiles.role)
//    - admin, adminQc, manager, executive, sales, user
//    - ใช้ camelCase → "adminQc" (ไม่ใช่ "adminQC")
// ======================================================

const ROLE_CONFIG = {

  // -------------------------------------------------------
  // ADMIN — เข้าได้ทุกหน้า
  // -------------------------------------------------------
  admin: {
    defaultPage: '/pages/dashboard/adminDashboard.html',
    allowedPages: [
      '/pages/dashboard/adminDashboard.html',
      '/pages/admin/admintor.html',
      '/pages/admin/adminSales.html',
      '/pages/admin/adminShops.html',
      '/pages/admin/adminUserEdit.html',
      '/pages/admin/AddProductSpec.html',
      '/index.html',
      '/pages/dashboard/managerDashboard.html',
      '/pages/reports/report-manager.html',
      '/pages/dashboard/QcDashboard.html',
      '/pages/executive/executive-Dashboard.html',
      '/pages/dashboard/salesDashboard.html',
      '/pages/reports/report.html',
      '/pages/dashboard/RfmDashboard.html',
      '/pages/components/rfmImport.html',
      '/pages/admin/Adminannouncements.html',
      '/pages/marketing/marketingHome.html'
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  },

  // -------------------------------------------------------
  // ADMIN QC — จัดการ QC dashboard
  // ⚠️ key ต้องเป็น "adminQc" (ตัว c เล็ก) ให้ตรงกับ DB
  // -------------------------------------------------------
  adminQc: {
    defaultPage: '/pages/dashboard/QcDashboard.html',
    allowedPages: [
      '/pages/dashboard/QcDashboard.html',
      '/pages/Qc-claim/adminQc.html',
      '/pages/Qc-claim/internal-claims.html',
      '/pages/Qc-claim/external-claims.html',
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  },

  // -------------------------------------------------------
  // MANAGER — ดูรายงานและ dashboard ของตัวเอง
  // -------------------------------------------------------
  manager: {
    defaultPage: '/index.html',
    allowedPages: [
      '/index.html',
      '/pages/dashboard/RfmDashboard.html',
      '/pages/reports/reportTracker.html',
      '/pages/components/rfmImport.html',
      '/pages/reports/report-manager.html',
      '/pages/dashboard/managerDashboard.html',
      '/pages/admin/Adminannouncements.html',
      '/pages/marketing/marketingHome.html',
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  },

  // -------------------------------------------------------
  // EXECUTIVE — ดู dashboard ภาพรวมและรายงาน
  // -------------------------------------------------------
  executive: {
    defaultPage: '/pages/executive/executive-Dashboard.html',
    allowedPages: [
      '/pages/executive/executiveHome.html',
      '/pages/Qc-claim/claim-evaluation.html',
      '/pages/executive/executive-Dashboard.html',
      '/pages/dashboard/RfmDashboard.html',
      '/pages/reports/report-manager.html',
      '/pages/reports/reportTracker.html',
      '/pages/marketing/marketingHome.html',
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  },

  // -------------------------------------------------------
  // SALES — หน้า sales ของตัวเอง
  // -------------------------------------------------------
  sales: {
    defaultPage: '/index.html',
    allowedPages: [
      '/index.html',
      '/pages/dashboard/salesDashboard.html',
      '/pages/reports/report.html',
      '/pages/forms/formActual.html',
      '/pages/forms/formHub.html',
      '/pages/forms/formClaim.html',
      '/pages/forms/credit-limit-sale.html',
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  },

  // -------------------------------------------------------
  // MARKETING — การตลาด: หน้าเมนูรวม Marketing Home
  // -------------------------------------------------------
  marketing: {
    defaultPage: '/pages/marketing/marketingHome.html',
    allowedPages: [
      '/pages/marketing/marketingHome.html',
      '/pages/dashboard/RfmDashboard.html',
      '/pages/dashboard/salesDashboard.html',
      '/pages/reports/reportTracker.html',
      '/pages/admin/Adminannouncements.html',
      '/pages/components/rfmImport.html',
      '/pages/components/importData.html',
      '/pages/forms/special-price-sale.html',
      '/pages/forms/special-price-tracking.html',
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  },

  // -------------------------------------------------------
  // ACCOUNTING — บัญชี ดูหน้า finance ของตัวเอง
  // -------------------------------------------------------
  accounting: {
    defaultPage: '/pages/Accounting/credit-limit-finance.html',
    allowedPages: [
      '/pages/Accounting/credit-limit-finance.html',
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  },

  // -------------------------------------------------------
  // USER — ผู้ใช้ทั่วไป (ยังไม่ได้รับ role อื่น)
  // -------------------------------------------------------
  user: {
    defaultPage: '/index.html',
    allowedPages: [
      '/index.html',
      '/pages/dashboard/salesDashboard.html',
      // ✅ เพิ่มหน้าใหม่ตรงนี้
    ]
  }
  };

// ======================================================
// 🔧 HELPER FUNCTIONS
// ======================================================

/**
 * ดึง config ของ role นั้น
 * @param {string} role
 * @returns {object|null}
 */
// รองรับ role ที่สะกดต่างกันใน DB (เช่น adminqc / ADMINQC)
function normalizeRole(role) {
  if (!role) return role;
  if (ROLE_CONFIG[role]) return role;
  const key = Object.keys(ROLE_CONFIG).find(k => k.toLowerCase() === String(role).toLowerCase());
  return key || role;
}

function getRoleConfig(role) {
  return ROLE_CONFIG[normalizeRole(role)] || null;
}

/**
 * หน้า default ของ role นั้น
 * ถ้าไม่มี config → ไปหน้า login
 * @param {string} role
 * @returns {string}
 */
function getDefaultPage(role) {
  return ROLE_CONFIG[normalizeRole(role)]?.defaultPage || '/pages/auth/login.html';
}

/**
 * เช็คว่า role นั้นเข้าหน้านี้ได้ไหม
 * @param {string} role
 * @param {string} path — window.location.pathname
 * @returns {boolean}
 */
function canAccessPage(role, path) {
  role = normalizeRole(role);
  const config = ROLE_CONFIG[role];
  if (!config) return false;
  // admin เข้าได้ทุกหน้า
  if (role === 'admin') return true;
  return config.allowedPages.some(p => path.includes(p));
}

console.log('✅ roleConfig.js loaded');