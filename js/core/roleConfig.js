// ======================================================
// roleConfig.js v2 — สิทธิ์การเข้าหน้า "ชุดเดียว" ของทั้งระบบ
// โหลดไฟล์นี้ก่อน auth.js ทุกหน้า
//
// ใช้ 2 ชั้นจากรายการเดียวกันนี้ (auth.js เป็นผู้บังคับใช้):
//   1) ซ่อนเมนู / การ์ด / ลิงก์ ที่ role ไม่มีสิทธิ์ (ทุกหน้า รวมเมนูที่โหลดทีหลัง)
//   2) กันเปิดหน้าตรงจาก URL — ไม่มีสิทธิ์ → พากลับหน้าแรกของ role ตัวเอง
//
// ✏️ เพิ่ม/แก้สิทธิ์ → แก้ที่ PAGE_ACCESS ด้านล่างที่เดียว
//    - Admin เปิดได้ทุกหน้าเสมอ (ไม่ต้องใส่) แต่เมนูของ Admin แสดงเฉพาะงาน Admin (nav-admin.html)
//    - หน้าที่ "ไม่อยู่ในรายการ" และไม่ใช่หน้าสาธารณะ = Admin เท่านั้น (กันหน้าใหม่ที่ลืมกำหนดสิทธิ์)
//
// ⚠️ role ต้องตรงกับ profiles.role: admin, adminQc, manager, executive, sales, marketing, accounting, user
//    (สะกดต่างกัน เช่น sale / adminqc ระบบปรับให้เอง)
// ⚠️ นี่คือการกันบนหน้าเว็บ — ข้อมูลจริงต้องกันด้วย RLS ของ Supabase ด้วย
// ======================================================

const ROLES_ALL = ["admin", "adminQc", "manager", "executive", "sales", "marketing", "accounting", "user"];

// หน้าแรกของแต่ละ role (ต้องเป็นหน้าที่ role นั้นเข้าได้)
const ROLE_HOME = {
  admin: "/pages/dashboard/adminDashboard.html",
  adminQc: "/pages/dashboard/QcDashboard.html",
  manager: "/pages/marketing/marketingHome.html",
  executive: "/pages/executive/executive-Dashboard.html",
  sales: "/index.html",
  marketing: "/pages/marketing/marketingHome.html",
  accounting: "/pages/Accounting/credit-limit-finance.html",
  user: "/index.html",
};

// หน้าที่ไม่ต้องล็อกอิน / ไม่ตรวจสิทธิ์
const PUBLIC_PAGES = [
  "/pages/auth/login.html",
  "/pages/auth/register.html",
  "/pages/auth/forgotPassword.html",
  "/pages/auth/resetPassword.html",
  "/pages/auth/update-password.html",
  "/pages/auth/pending-approval.html",
  "/UnderDev.html",
  "/commingSoon.html",
];
const PUBLIC_PREFIX = ["/pages/components/nav-"]; // ชิ้นส่วนเมนูที่ fetch มาใส่หน้า

// หน้า → role ที่เข้าได้ (นอกจาก Admin)
const PAGE_ACCESS = {
  // ---------- เซลล์ ----------
  "/index.html":                                ["sales", "manager", "user"],
  "/pages/reports/report.html":                 ["sales", "manager"],
  "/pages/forms/formClaim.html":                ["sales", "manager"],
  "/pages/forms/formHub.html":                  ["sales", "manager"],
  "/pages/forms/formPlan.html":                 ["sales", "manager"],
  "/pages/forms/formActual.html":               ["sales", "manager"],
  "/pages/forms/shopUser.html":                 ["sales", "manager"],
  "/pages/forms/shopDetail.html":               ["sales", "manager"],
  "/pages/components/notifications.html":       ["sales", "manager"],
  "/pages/dashboard/messages-New.html":         ["sales", "manager", "marketing", "executive", "adminQc", "accounting"],

  // ---------- ราคาพิเศษ (ผู้ขอ → Manager → ผู้บริหาร) ----------
  "/pages/forms/special-price-sale.html":       ["sales", "marketing"],
  "/pages/forms/special-price-manager.html":    ["manager"],

  // ---------- วงเงินชั่วคราว ----------
  "/pages/forms/credit-limit-sale.html":        ["sales", "manager", "accounting", "executive"],
  "/pages/forms/credit-limit-detail.html":      ["sales", "manager", "accounting", "executive"],
  "/pages/forms/credit-limit-tracking.html":    ["sales", "manager", "accounting", "executive"],
  "/pages/forms/credit-limit-a4-document.html": ["sales", "manager", "accounting", "executive"],
  "/pages/forms/credit-limit-signature.html":   ["sales", "manager", "accounting", "executive"],
  "/pages/forms/credit-limit-approval.html":    ["manager", "executive"],
  "/pages/Accounting/credit-limit-finance.html":["accounting"],

  // ---------- Manager / การตลาด ----------
  "/pages/marketing/marketingHome.html":        ["manager", "marketing"],
  "/pages/dashboard/managerDashboard.html":     ["manager"],
  "/pages/reports/reportTracker.html":          ["manager", "marketing", "executive"],
  "/pages/dashboard/RfmDashboard.html":         ["manager", "marketing", "executive"],
  "/pages/dashboard/salesDashboard.html":       ["sales", "manager", "marketing"],
  "/pages/components/rfmImport.html":           ["manager", "marketing"],
  "/pages/components/importData.html":          ["manager", "marketing"],
  "/pages/marketing/announcements.html":        ["manager", "marketing"], // ประชาสัมพันธ์ ฝั่งการตลาด (Admin ใช้หน้าของ Admin)
  "/pages/admin/messages-New-Admin.html":       ["manager", "adminQc"],

  // ---------- ผู้บริหาร (อนุมัติขั้นสุดท้ายต่อจาก Manager) ----------
  "/pages/executive/executive-Dashboard.html":  ["executive"],
  "/pages/executive/executiveHome.html":        ["executive"],
  "/pages/executive/executive-Approval.html":   ["executive"],

  // ---------- QC ----------
  "/pages/dashboard/QcDashboard.html":          ["adminQc", "manager"],
  "/pages/Qc-claim/adminQc.html":               ["adminQc"],
  "/pages/Qc-claim/internal-claims.html":       ["adminQc"],
  "/pages/Qc-claim/external-claims.html":       ["adminQc"],

  // ---------- Admin เท่านั้น (ใส่ไว้ให้เห็นชัด) ----------
  "/pages/dashboard/adminDashboard.html":       [],
  "/pages/admin/admintor.html":                 [],
  "/pages/admin/adminSales.html":               [],
  "/pages/admin/adminShops.html":               [],
  "/pages/admin/adminUserEdit.html":            [],
  "/pages/admin/AddProductSpec.html":           [],
  "/pages/admin/Adminannouncements.html":       [], // ประชาสัมพันธ์ ฝั่ง Admin — ประกาศชุดเดียวกับฝั่งการตลาด แสดงที่การ์ดหน้าแรกเซลล์
  "/pages/admin/merge-customers.html":          [],
  // หน้าอื่นที่ไม่อยู่ในรายการ (หน้าตัวอย่าง/หน้าเก่า เช่น special-price-executive, Credit-Limit.html) = Admin เท่านั้น
};

// ======================================================
// 🔧 HELPERS
// ======================================================
// รองรับ role ที่สะกดต่างกันใน DB (เช่น sale / adminqc / Admin)
function normalizeRole(role) {
  if (!role) return role;
  const r = String(role).trim().replace(/\s/g, "");
  if (r.toLowerCase() === "sale") return "sales";
  return ROLES_ALL.find((k) => k.toLowerCase() === r.toLowerCase()) || r;
}

// path ให้อยู่รูปเดียวกัน: "/" → "/index", ตัด .html และ / ท้าย (รองรับเว็บที่ตัดนามสกุล .html)
function normalizePath(path) {
  let p = String(path || "/").split("?")[0].split("#")[0];
  try { p = decodeURI(p); } catch (e) { /* ignore */ }
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+$/, "") || "/index";
  if (p === "/index.html" || p === "/") p = "/index";
  return p.replace(/\.html$/i, "");
}
const _ACCESS = Object.fromEntries(Object.entries(PAGE_ACCESS).map(([k, v]) => [normalizePath(k), v]));
const _PUBLIC = new Set(PUBLIC_PAGES.map(normalizePath));

function isPublicPage(path) {
  const p = normalizePath(path);
  return _PUBLIC.has(p) || PUBLIC_PREFIX.some((x) => p.startsWith(normalizePath(x)));
}

/**
 * role นี้เปิดหน้านี้ได้ไหม
 * @param {string} role
 * @param {string} path — pathname หรือ URL ภายในเว็บ
 */
function canAccessPage(role, path) {
  if (isPublicPage(path)) return true;
  role = normalizeRole(role);
  if (role === "admin") return true;               // Admin เปิดได้ทุกหน้า
  const allowed = _ACCESS[normalizePath(path)];
  if (!allowed) return false;                       // ไม่อยู่ในรายการ = Admin เท่านั้น
  return allowed.includes(role);
}

function getDefaultPage(role) {
  return ROLE_HOME[normalizeRole(role)] || "/pages/auth/login.html";
}

// ---------- รองรับโค้ดเดิมที่อ่าน ROLE_CONFIG ----------
const ROLE_CONFIG = Object.fromEntries(ROLES_ALL.map((r) => [r, {
  defaultPage: ROLE_HOME[r],
  allowedPages: r === "admin" ? Object.keys(PAGE_ACCESS) : Object.keys(PAGE_ACCESS).filter((p) => PAGE_ACCESS[p].includes(r)),
}]));
function getRoleConfig(role) { return ROLE_CONFIG[normalizeRole(role)] || null; }

console.log("✅ roleConfig.js v2 loaded");
