// =====================================================
// cleanup-legacy.mjs — ลบไฟล์ CSS/JS เก่าที่ไม่มีหน้าไหนใช้แล้ว (รอบ 49)
//   node scripts/cleanup-legacy.mjs          → แสดงรายการ (ยังไม่ลบ)
//   node scripts/cleanup-legacy.mjs --apply  → ลบจริง
// ตรวจซ้ำก่อนลบ: ถ้าไฟล์ยังถูกอ้างถึงจาก .html/.js/.css ใด ๆ จะข้าม (ไม่ลบ)
// =====================================================
import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FILES = [
  // ถูกแทนด้วยไฟล์ -ux / หน้าใหม่ในรอบก่อน ๆ
  "css/pages/Accounting/credit-limit-finance.css",   // → credit-limit-finance-ux.css (รอบ 47)
  "css/pages/Accounting/credit-limit-finance2.css",
  "css/pages/forms/formHub.css",                     // → formHub-ux.css
  "css/pages/forms/formPlan.css",                    // → formPlan-ux.css
  "css/pages/forms/formActual.css",
  "css/pages/forms/credit-limit-sale.css",           // → special-price-sale-ux.css (รอบ 42)
  "css/pages/forms/special-price-sale.css",
  "css/pages/forms/special-price-manager.css",
  "css/pages/forms/credit-limit-approval.css",
  "css/pages/executive/executive-Dashboard.css",     // → executive-Dashboard-ux.css (รอบ 34)
  "css/pages/report/report-manager.css",             // report-manager.html เป็นหน้าพาไป reportTracker แล้ว
  "js/pages/report/report-manager.js",
  // หน้าตัวอย่างข้อมูลตายตัว (เปลี่ยนเป็นหน้าทางผ่าน legacy-redirect.js แล้ว)
  "js/pages/forms/Price-Exception-Request.js",
  "css/pages/forms/Price-Exception-Request.css",
  "js/pages/forms/Credit-Limit.js",
  "css/pages/forms/Credit-Limit.css",
  "js/pages/forms/Special-Price.js",
  "css/pages/forms/Special-Price.css",
  "js/pages/forms/credit-limit-tracking.js",
  "css/pages/forms/credit-limit-tracking.css",
  "js/pages/forms/credit-limit-detail.js",
  "css/pages/forms/credit-limit-detail.css",
  "js/pages/forms/credit-limit-signature.js",
  "css/pages/forms/credit-limit-signature.css",
  "js/pages/forms/credit-limit-a4-document.js",
  "js/pages/Accounting/credit-limit-finance2.js",
  "js/pages/forms/special-price-tracking.js",
  "css/pages/forms/special-price-tracking.css",
  "js/pages/forms/special-price-document.js",
  "css/pages/forms/special-price-document.css",
  "js/pages/forms/special-price-executive.js",
  "css/pages/forms/special-price-executive.css",
];

const apply = process.argv.includes("--apply");
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", ".vscode"].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|js|css|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};
const sources = walk(ROOT).map((p) => [p, fs.readFileSync(p, "utf8")]);
let removed = 0, kept = 0;
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.log("·  ไม่มีไฟล์แล้ว   ", rel); continue; }
  // ไม่นับการอ้างถึงจากไฟล์ที่อยู่ในรายการลบด้วยกัน (เช่น @import ระหว่างไฟล์เก่า)
  const usedBy = sources.filter(([p, txt]) => p !== abs && p !== new URL(import.meta.url).pathname && !FILES.includes(path.relative(ROOT, p)) && txt.includes("/" + rel)).map(([p]) => path.relative(ROOT, p));
  if (usedBy.length) { kept++; console.log("!  ยังถูกใช้ — ข้าม ", rel, "←", usedBy.join(", ")); continue; }
  if (apply) { fs.unlinkSync(abs); removed++; console.log("✓  ลบแล้ว        ", rel); }
  else console.log("-  จะลบ          ", rel);
}
console.log(apply ? `\nลบ ${removed} ไฟล์ · ข้าม ${kept}` : `\n(ยังไม่ลบ) เพิ่ม --apply เพื่อลบจริง · ข้าม ${kept}`);
