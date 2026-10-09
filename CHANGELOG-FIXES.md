# บันทึกการแก้ไข EABaseHub V2 (dev) — 9 ต.ค. 2569

ตรวจทั้งโปรเจกต์ (269 ไฟล์) ด้วย 3 วิธี:
1. ตรวจ syntax ของ JS ทุกไฟล์ และสคริปต์ inline ใน HTML
2. ตรวจลิงก์ / `<script src>` / `<link href>` / `location.href` / `import` ว่าชี้ไปไฟล์ที่มีอยู่จริง (แยกตัวพิมพ์เล็ก-ใหญ่ เพราะ server ส่วนใหญ่แยก)
3. เปิดทุกหน้าจริงใน Chromium ด้วยบัญชีจำลองทั้ง 7 role (admin, adminQc, manager, executive, sales, user, accounting) โดยจำลอง Supabase ทั้งแบบไม่มีข้อมูลและแบบมีข้อมูล แล้วเก็บ error ทั้งหมด

---

## 🔴 ปัญหาร้ายแรง (ใช้งานไม่ได้)

| ไฟล์ | ปัญหา | แก้ |
|---|---|---|
| `js/core/roleConfig.js` | Admin login แล้วไปหน้า `/pages/admin/adminDashboard.html` ซึ่ง **ไม่มีอยู่จริง (404)**; role `user` ก็ไป 404 เช่นกัน; `allowedPages` เกือบทั้งหมดชี้ path ผิด | defaultPage → `/pages/dashboard/adminDashboard.html`, user → `/index.html`; แก้ allowedPages ให้ตรงไฟล์จริง; เพิ่ม `normalizeRole()` รองรับ `adminqc`/`ADMINQC` |
| `js/pages/admin/merge-customers.js` | **ไฟล์ถูกตัดหายครึ่งบน** (syntax error) — `loadCandidates`, `toggleCustomer` หายไป | เขียนส่วนที่หายใหม่: ดึงลูกค้าจาก `customer_rfm`, จับกลุ่มชื่อซ้ำ, เลือก/ยกเลิก, แสดงว่ารวมไปแล้วหรือยัง; เพิ่มตรวจสิทธิ์ admin + CSS layout |
| `pages/reports/report-manager.html` | เป็น **2 หน้าเว็บวางซ้อนกัน + มีข้อความแชทปนอยู่**, id ซ้ำ 7 ตัว, CSS 2 ไฟล์ไม่มีอยู่ | เปลี่ยนเป็นหน้า redirect ไป `reportTracker.html` (หน้ารายงานตัวจริง) |
| `pages/forms/special-price-*.html` (5 ไฟล์) | มี `<!DOCTYPE><html><head><body>` ซ้อน 2 ชั้น | รวมเป็นเอกสารเดียว ย้าย CSS ขึ้น `<head>` |
| `pages/dashboard/salesDashboard.html` | โหลดสคริปต์ผิดไฟล์ (`manager/Salesdashboard.js` ที่ id ไม่ตรง) ไม่โหลด Supabase, ปุ่ม sidebar/สัปดาห์/เดือน/ไตรมาส error, ชื่อผู้ใช้ fix ตายตัว "Tontoey N." | ใช้ `dashboard/salesDashboard.js` ที่ตรงกับหน้า, โหลด Supabase + auth + ตรวจสิทธิ์, แสดงชื่อ/role จริง, ปุ่มรีเฟรชทำงาน |
| `npm run build` | `vite build` สร้าง dist ที่มีแค่ `index.html` (ไม่มี /pages /js /css) → deploy แล้วใช้งานไม่ได้ | เพิ่ม `scripts/build-static.mjs` คัดลอกไฟล์ที่ต้อง deploy ไป `dist/` |

## 🟠 ไฟล์ / ลิงก์ที่ชี้ผิด (404)

- `themeToggle.js` → `Themetoggle.js` (ตัวพิมพ์) — external-claims, internal-claims, executive-Approval
- `forgot-password.js`/`reset-password.js` → `forgotPassword.js`/`resetPassword.js`; ลิงก์ "ลืมรหัสผ่าน" ในหน้า login; `redirectTo` ในอีเมลรีเซ็ตรหัสผ่าน
- `credit-limit-tracking.html` โหลด `./credit-limit-tracking.js` (ผิดโฟลเดอร์)
- `credit-limit-finance2.html` โหลด `/js/pages/forms/credit-limit-finance.js` (ไม่มี)
- ปุ่มเปลี่ยนหน้าของชุด Credit-Limit ใช้ path สัมพัทธ์ ทำให้ไป `pages/forms/credit-limit-finance.html` (อยู่ใน Accounting จริง) → ใช้ path เต็มทั้งหมด
- `adminUserEdit.html`: CSS/JS path ผิดทั้งหมด, เรียก `protectAdmin()` ที่ไม่มีอยู่
- `approval.html`: CSS และลิงก์ QC ผิดโฟลเดอร์
- ลิงก์ `/pages/admin/adminDashboard.html` (adminSales, adminShops, admintor) → `/pages/dashboard/adminDashboard.html`
- ลิงก์หน้าหลัก `/pages/index.html`, `index.html` → `/index.html`
- `/pages/home.html`, `/pages/executive/home.html` → `executiveHome.html`
- ปุ่ม "สร้างประกาศ" → `/pages/admin/Adminannouncements.html`
- เมนู Admin Console 9 รายการชี้ไฟล์ที่ไม่มี (`admin-shops.html` ฯลฯ) → ชี้หน้าจริงที่มี หรือหน้า Coming Soon
- Manager: ลิงก์ `claimManager.html` / `salesManagement.html` (ไม่มี) → QC Dashboard (กรอง `?status=pending` ได้) / Report Tracker
- แจ้งเตือน: `report.html?id=` และ `/post.html` → `/pages/reports/report.html?id=` และหน้ารายงานเปิดรายการนั้นให้อัตโนมัติ
- `login.html`/`/login.html` (formPlan, formActual, shopUser, shopDetail) → `/pages/auth/login.html`
- `/favicon.ico` → ไอคอนของระบบ
- `export_plan.html` ไม่โหลดไลบรารี Supabase (error ทันทีที่เปิด)

## 🟡 ฟังก์ชันที่เรียกใช้แต่ไม่มี

- `report.html`: ปุ่มบันทึกเรียก `saveEdit()` ที่ไม่มี → เพิ่มฟังก์ชันบันทึกหมายเหตุ
- `executive-Approval.js`: `dateStart`/`dateEnd` ไม่ได้ประกาศ, `loadReports()` ไม่มี → ประกาศตัวแปร, ใช้ `loadExecClaims()`; ลบ `onclick="toggleAdvanceFilter()"` ที่ซ้ำกับ listener
- `Credit-Limit.html`: `showPage('sale')` แต่ไม่มี section `page-sale` → crash; เพิ่ม fallback
- ชุด Credit-Limit: ฟังก์ชันลายเซ็นอ้าง element ที่ไม่มี → กันค่า null

## 🔐 การตรวจสิทธิ์ (เดิมใครก็เปิดได้)

| หน้า | สิทธิ์ที่ตั้ง |
|---|---|
| Admin Console (`adminDashboard`) | admin |
| จัดการสินค้า (`AddProductSpec`) | admin |
| Merge Customers | admin |
| จัดการประกาศ (`Adminannouncements`) | admin, adminQc, manager (ตรงกับคนที่เห็นปุ่ม "สร้างประกาศ") |
| Manager Dashboard | admin, manager |
| Executive Approval (CEO) | admin, executive |
| Sales Dashboard | admin, executive, manager, sales, user |
| `admin-Index.html` (Console เวอร์ชันเก่า ไม่มีตรวจสิทธิ์) | redirect ไป Admin Console |

> หมายเหตุ: การตรวจสิทธิ์ฝั่งหน้าเว็บเป็นแค่ด่านแรก ข้อมูลจริงต้องป้องกันด้วย RLS ใน Supabase ด้วย

## ➕ อื่น ๆ
- เพิ่ม role **accounting** ในหน้าจัดการผู้ใช้ (เดิมมีใน roleConfig แต่ admin กำหนดให้ใครไม่ได้)
- เพิ่มเมนู "รวมรหัสลูกค้า" ใน nav admin และ Admin Console
- ล็อกเวอร์ชัน CDN ที่ไม่ระบุเวอร์ชัน (supabase-js@2, xlsx@0.18.5, exceljs@4.4.0, file-saver@2.0.5) กันไลบรารีออกเวอร์ชันใหม่แล้วพัง
- หน้าว่าง 0 byte (`claim-evaluation.html`, `admin-Console.html`) → ไปหน้า Coming Soon แทนจอขาว
- `Credit-Limit.html`/`Special-Price.html`: `<script>` อยู่หลัง `</html>` → ย้ายเข้า `<body>`
- `executive-Dashboard.js`: ประกาศ `initAvatarUpload` ซ้ำ 2 ครั้ง → ลบตัวเก่าที่ถูกทับ (เหลือตัวที่อัปโหลดรูปจริง)
- QC Dashboard / Manager Dashboard: กัน error เมื่อ id เป็นตัวเลข หรือ `submitted_at` ว่าง

## ⚠️ สิ่งที่ยังไม่ได้ทำ (ต้องการข้อมูลเพิ่ม)
- `pages/Qc-claim/admin_preview.html` เรียก `/api/promotions` ซึ่งต้องมี backend (ไม่มีในโปรเจกต์)
- `pages/dashboard/export_cost.html` เป็นหน้าสำหรับ Google Apps Script (`google.script.run`) ใช้บนเว็บนี้ไม่ได้
- หน้า Coming Soon: ประวัติเข้าใช้งาน, พื้นที่ขาย, ตั้งค่าการอนุมัติ/เอกสาร/แจ้งเตือน, Audit Log, System Config, Claim Evaluation — ยังไม่มีหน้าจริง
- `minipro/`, `MASTER TEMPLATE.html`, `Daily section snippet.html`, `css/components/DemoBtn.html` เป็นไฟล์ทดลอง/เทมเพลต ไม่ได้แก้
- การทดสอบใช้ Supabase จำลอง — ยังไม่ได้ทดสอบกับฐานข้อมูลจริง (ชื่อตาราง/คอลัมน์/RLS)

## วิธีรัน
```bash
npm install
npm run dev      # http://localhost:3000  (ใช้ Supabase DEV อัตโนมัติ)
npm run build    # สร้าง dist/ สำหรับ deploy
```
