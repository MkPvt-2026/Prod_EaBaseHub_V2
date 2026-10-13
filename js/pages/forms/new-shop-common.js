// =====================================================
// new-shop-common.js — ขอเปิดร้านค้าใหม่ (ใช้ร่วม: หน้าเซลล์ / Manager / ผู้บริหาร)
// ต้องโหลด special-price-common.js ก่อน (escHtml, fmtMoney, formatDateTH, spStatus, spTimelineHTML, spPrintPage ฯลฯ)
//
// ลำดับอนุมัติ (approval_requests · request_type = "new_area_shop") — แบบเดียวกับราคาพิเศษ
//   1) เซลล์ส่ง          → request_status "waiting_manager"   status "manager_review"
//   2) Manager อนุมัติ   → request_status "pending"           status "executive_review"  (ผู้บริหารจึงเห็น)
//      ไม่อนุมัติ → "rejected" / "manager_rejected" · ขอข้อมูลเพิ่ม → "request_more_info" / "manager_more_info"
//   3) ผู้บริหาร          → "approved" / "rejected" / "request_more_info" (executive-ApprovalDoc)
//   ขอข้อมูลเพิ่ม (ขั้นใดก็ได้) → เซลล์ "แก้ไขแล้วส่งใหม่" = อัปเดตคำขอเดิม กลับไปขั้น Manager (ผลเดิมเก็บใน payload.history)
// ข้อมูลร้านเก็บใน payload.shop_new · ผล Manager ใน payload.manager
// รูปร้าน (ย่อขนาดแล้ว) อัปโหลดไป Storage bucket "shop-images" (ส่วนตัว · bucket เดียวกับรูปร้านใน shop_details)
//   payload.photos = [{ path, name }] · แสดงด้วยลิงก์ชั่วคราว (nsResolvePhotos) · อัปโหลดไม่ได้ → เก็บเป็น data URL ในคำขอแทน (คำขอรุ่นแรกก็เป็นแบบนี้)
// =====================================================
"use strict";

const NS_TYPE = "new_area_shop";
const NS_SHOP_TYPES = ["ร้านค้าปลีก", "ร้านค้าส่ง / ยี่ปั๊ว", "ตัวแทนจำหน่าย", "ผู้รับเหมา / โครงการ", "อื่น ๆ"];
const NS_PAY = { cash: "เงินสด", credit: "เครดิต" };
const NS_MAX_PHOTOS = 4;

/** สถานะ (ใช้คำเดียวกับราคาพิเศษ) + action = ต้องแก้ไขแล้วส่งใหม่ */
function nsStatus(r) {
  const s = spStatus(r);
  return { ...s, action: s.key === "request_more_info" };
}
function nsDocNo(r) {
  const y = new Date(r?.created_at || Date.now()).getFullYear();
  return `APP-${y}-NEWSHOP-${String(r?.id || "").slice(0, 8).toUpperCase()}`;
}
function nsShop(r) { return r?.payload?.shop_new || {}; }
const NS_PHOTO_BUCKET = "shop-images";
const NS_SIGNED = {}; // path → ลิงก์ชั่วคราว (ไม่บันทึกลงฐานข้อมูล)
function nsPhotos(r) { return Array.isArray(r?.payload?.photos) ? r.payload.photos.filter((p) => p && (p.path || p.url || p.data)) : []; }
const nsPhotoSrc = (p) => (p.path && NS_SIGNED[p.path]) || p.url || p.data || "";

// ขอลิงก์ชั่วคราวของรูปที่เก็บใน Storage (ทำก่อนสร้างเอกสาร / แสดงรูป)
async function nsResolvePhotos(rowOrList) {
  const list = Array.isArray(rowOrList) ? rowOrList : nsPhotos(rowOrList);
  const paths = [...new Set(list.map((p) => p?.path).filter((x) => x && !NS_SIGNED[x]))];
  if (!paths.length || typeof supabaseClient === "undefined") return;
  try {
    const { data, error } = await supabaseClient.storage.from(NS_PHOTO_BUCKET).createSignedUrls(paths, 60 * 60);
    if (error) throw error;
    (data || []).forEach((d) => { if (d?.signedUrl && d.path) NS_SIGNED[d.path] = d.signedUrl; });
  } catch (e) {
    console.warn("nsResolvePhotos (batch):", e.message || e);
    await Promise.all(paths.map(async (path) => {
      try { const { data } = await supabaseClient.storage.from(NS_PHOTO_BUCKET).createSignedUrl(path, 60 * 60); if (data?.signedUrl) NS_SIGNED[path] = data.signedUrl; } catch (e2) { /* ignore */ }
    }));
  }
}

// อัปโหลดรูปที่ยังเป็น data URL → [{ path, name }] · ที่อัปโหลดไม่ได้คงเป็น { data, name } (ไม่ทำให้ส่งคำขอล้ม)
async function nsUploadPhotos(list, userId) {
  const out = [];
  let failed = 0;
  for (let i = 0; i < (list || []).length; i++) {
    const p = list[i];
    if (!p) continue;
    if (p.path || p.url || !p.data) { out.push(p.path ? { path: p.path, name: p.name || "" } : { ...p }); continue; }
    try {
      const blob = await (await fetch(p.data)).blob();
      const path = `new-shop/${userId || "anon"}/${Date.now()}-${i}.jpg`;
      const { error } = await supabaseClient.storage.from(NS_PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      NS_SIGNED[path] = p.data; // แสดงจากรูปในเครื่องได้ทันที
      out.push({ path, name: p.name || "" });
    } catch (e) {
      failed++;
      console.warn("nsUploadPhotos:", e.message || e);
      out.push({ data: p.data, name: p.name || "" });
    }
  }
  return { photos: out, failed };
}
function nsMapUrl(s) { return s?.lat && s?.lng ? `https://www.google.com/maps?q=${encodeURIComponent(s.lat)},${encodeURIComponent(s.lng)}` : ""; }
function nsAddress(s) { return [s.address, s.district ? `อ.${s.district}` : "", s.province ? `จ.${s.province}` : "", s.postcode].filter(Boolean).join(" "); }
function nsPayText(s) {
  if (s.pay_term === "credit") return `เครดิต ${s.credit_days ? s.credit_days + " วัน" : ""}${Number(s.credit_limit) ? ` · วงเงินที่ขอ ${fmtMoney(s.credit_limit)} บาท` : ""}`.trim();
  return NS_PAY[s.pay_term] || "-";
}

// ข้อควรตรวจสำหรับผู้พิจารณา (Manager / ผู้บริหาร)
function nsFlags(r, dupNames) {
  const s = nsShop(r), f = [];
  if (dupNames && dupNames.length) f.push(`มีร้านชื่อคล้ายกันในระบบแล้ว: ${dupNames.slice(0, 3).join(", ")}${dupNames.length > 3 ? " …" : ""}`);
  if (!s.lat || !s.lng) f.push("ไม่มีพิกัด GPS ของร้าน");
  if (!s.tax_id) f.push("ไม่มีเลขประจำตัวผู้เสียภาษี");
  if (s.pay_term === "credit") f.push(`ขอเครดิต${s.credit_days ? " " + s.credit_days + " วัน" : ""}${Number(s.credit_limit) ? " วงเงิน " + fmtMoney(s.credit_limit) + " บาท" : ""} — ฝ่ายบัญชีควรตรวจก่อนเปิดวงเงิน`);
  if (!nsPhotos(r).length) f.push("ไม่มีรูปร้าน");
  return f;
}

// ค้นร้านชื่อคล้ายกันในตาราง shops (กันเปิดซ้ำ)
async function nsFindSimilarShops(name) {
  const q = String(name || "").replace(/[%,()*]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 3) return [];
  try {
    const { data, error } = await supabaseClient.from("shops").select("id,shop_code,shop_name,province").ilike("shop_name", `%${q}%`).limit(8);
    if (error) throw error;
    return (data || []).map((s) => `${s.shop_name}${s.shop_code ? " (" + s.shop_code + ")" : ""}${s.province ? " · " + s.province : ""}`);
  } catch (e) { console.warn("nsFindSimilarShops:", e.message || e); return []; }
}

// ไทม์ไลน์ 3 ขั้น (เหมือนราคาพิเศษ)
function nsTimelineHTML(r) { return spTimelineHTML(r); }

// ย่อรูปก่อนเก็บ (กว้าง/สูงไม่เกิน max px · JPEG) → data URL
function nsCompressImage(file, max = 1000, quality = 0.68) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพ"));
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// แถวในฐานข้อมูล → ข้อมูลเอกสาร
function nsDocFromRow(r) {
  const p = r.payload || {};
  return {
    row: r, id: r.id, created_at: r.created_at, doc_date: r.request_date,
    shop: p.shop_new || { shop_name: r.shop_name, province: r.province },
    requester: r.sale_name || p.requester?.name, reason: p.shop_new?.reason || r.request_detail,
    photos: nsPhotos(r), signature: r.signature, manager: p.manager || null,
    approver_signature: r.approval_signature || r.exec_signature, approved_at: r.approved_at,
    exec_comment: r.approval_comment || r.exec_comment,
  };
}

// เอกสาร A4 ใบขออนุมัติเปิดร้านค้าใหม่ (ตัวอย่างก่อนส่ง / หน้าเซลล์ / Manager / ผู้บริหาร)
function nsBuildDocHTML(d) {
  const s = d.shop || {};
  const st = d.row ? nsStatus(d.row) : null;
  const m = d.manager || null;
  const decWord = (x) => ({ approved: "อนุมัติ", rejected: "ไม่อนุมัติ", request_more_info: "ขอข้อมูลเพิ่ม" })[x] || "";
  const execDone = !!(st && d.row && spReachedExec(d.row) && st.done);
  const execDecision = execDone ? decWord(st.key) : "";
  const stamp = execDone && st.key !== "request_more_info" ? `<div class="ns-stamp ${st.key === "approved" ? "ok" : "bad"}">${execDecision}</div>` : "";
  const sig = (url, name, role, date, note) => `<div class="sb"><div class="si">${url ? `<img src="${escHtml(url)}" alt="ลายเซ็น">` : ""}</div><div class="sn">(${escHtml(name || "..........................................")})</div><div class="sr">${escHtml(role)}${note ? ` · <b>${escHtml(note)}</b>` : ""}</div><div class="sd">${date ? "วันที่ " + escHtml(date) : "วันที่ ......../......../........"}</div></div>`;
  const types = NS_SHOP_TYPES.includes(s.shop_type) || !s.shop_type ? NS_SHOP_TYPES : [...NS_SHOP_TYPES, s.shop_type];
  const ck = (on, label) => `<span class="ck"><i>${on ? "✓" : ""}</i>${escHtml(label)}</span>`;
  const map = nsMapUrl(s);
  const photos = (d.photos || []).slice(0, NS_MAX_PHOTOS);
  const v = (x) => escHtml(x || "-");
  return `
<style>
.ns-doc{font-family:'Kanit',sans-serif;font-size:12.5px;color:#1a1a1a;line-height:1.45;position:relative}
.ns-doc .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #1a1a1a;padding-bottom:6px;margin-bottom:10px}
.ns-doc .cn{font-size:17px;font-weight:700}.ns-doc .tt{font-size:14px;font-weight:600}.ns-doc .st{font-size:11px;color:#555}
.ns-doc .no{text-align:right;font-size:11.5px;color:#444}.ns-doc .no b{display:block;font-size:12.5px;color:#111}
.ns-doc table{width:100%;border-collapse:collapse;margin-bottom:10px;table-layout:fixed}
.ns-doc .mt th{width:17%;text-align:left;background:#f4f6f9;color:#444;font-weight:600;border:1px solid #c8ced6;padding:5px 8px;vertical-align:top}
.ns-doc .mt td{border:1px solid #c8ced6;padding:5px 9px;white-space:pre-wrap;word-break:break-word}
.ns-doc .mt a{color:#1d4ed8}
.ns-doc h4{margin:12px 0 6px;font-size:13px;font-weight:700;border-left:3px solid #1a1a1a;padding-left:7px}
.ns-doc .bx{border:1px solid #b7bec8;border-radius:3px;padding:6px 10px;margin-bottom:8px;white-space:pre-wrap;font-size:13px}
.ns-doc .ml{font-weight:700;color:#444;margin-right:4px}
.ns-doc .ck{display:inline-flex;align-items:center;gap:4px;margin-right:12px;white-space:nowrap}.ns-doc .ck i{width:12px;height:12px;border:1px solid #333;display:inline-grid;place-items:center;font-style:normal;font-size:10px;line-height:1}
.ns-doc .ph{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
.ns-doc .ph a{display:block;border:1px solid #c8ced6;border-radius:3px;overflow:hidden;aspect-ratio:4/3;background:#f4f6f9}
.ns-doc .ph img{width:100%;height:100%;object-fit:cover;display:block}
.ns-doc .sg{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;text-align:center;margin-top:16px;break-inside:avoid}
.ns-doc .si{height:56px;border-bottom:1px solid #555;display:flex;align-items:flex-end;justify-content:center}.ns-doc .si img{max-height:54px;max-width:100%;mix-blend-mode:multiply}
.ns-doc .sn{font-weight:600;margin-top:4px;font-size:12px}.ns-doc .sr,.ns-doc .sd{color:#555;font-size:11px}
.ns-doc .ns-stamp{position:absolute;right:170px;top:-6px;transform:rotate(-8deg);padding:3px 14px;border:3px solid;border-radius:8px;font-size:19px;font-weight:700;opacity:.85}
.ns-doc .ns-stamp.ok{color:#15803d;border-color:#15803d}.ns-doc .ns-stamp.bad{color:#b91c1c;border-color:#b91c1c}
</style>
<div class="ns-doc">
  ${stamp}
  <div class="hd"><div><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">ใบขออนุมัติเปิดร้านค้าใหม่</div><div class="st">New Customer / Shop Opening Request</div></div>
    <div class="no">${d.id ? `เลขที่<b>${escHtml(nsDocNo(d.row || d))}</b>` : "<b>ร่าง — ยังไม่ส่ง</b>"}${st ? `สถานะ: ${escHtml(st.label)}` : ""}</div></div>

  <h4>ข้อมูลร้านค้า</h4>
  <table class="mt"><tbody>
    <tr><th>ชื่อร้าน</th><td colspan="3"><b>${v(s.shop_name)}</b></td></tr>
    <tr><th>ประเภทร้าน</th><td colspan="3">${types.map((t) => ck(s.shop_type === t, t)).join("")}</td></tr>
    <tr><th>เลขผู้เสียภาษี</th><td>${v(s.tax_id)}</td><th>ผู้ขอ (เซลล์)</th><td>${v(d.requester)}</td></tr>
    <tr><th>ที่อยู่</th><td colspan="3">${v(nsAddress(s))}</td></tr>
    <tr><th>พิกัด GPS</th><td colspan="3">${map ? `${escHtml(s.lat)}, ${escHtml(s.lng)} · <a href="${escHtml(map)}" target="_blank" rel="noopener">เปิดแผนที่</a>` : "-"}</td></tr>
    <tr><th>ผู้ติดต่อ</th><td>${v(s.contact_name)}</td><th>โทรศัพท์</th><td>${v(s.phone)}${s.line_id ? `<br>LINE: ${escHtml(s.line_id)}` : ""}</td></tr>
  </tbody></table>

  <h4>ข้อมูลการค้า</h4>
  <table class="mt"><tbody>
    <tr><th>ยอดซื้อคาดการณ์</th><td>${Number(s.est_monthly) ? fmtMoney(s.est_monthly) + " บาท / เดือน" : "-"}</td><th>เงื่อนไขชำระ</th><td>${ck(s.pay_term === "cash", "เงินสด")}${ck(s.pay_term === "credit", "เครดิต")}</td></tr>
    ${s.pay_term === "credit" ? `<tr><th>เครดิต (วัน)</th><td>${v(s.credit_days)}</td><th>วงเงินที่ขอ</th><td>${Number(s.credit_limit) ? fmtMoney(s.credit_limit) + " บาท" : "-"}</td></tr>` : ""}
    <tr><th>สินค้าที่สนใจ</th><td colspan="3">${v(s.products)}</td></tr>
  </tbody></table>

  <div class="bx"><span class="ml">เหตุผล / โอกาสทางการขาย :</span>${escHtml(d.reason || "-")}</div>
  ${photos.length ? `<h4>รูปร้าน</h4><div class="ph">${photos.map((p, i) => `<a href="${escHtml(nsPhotoSrc(p))}" target="_blank" rel="noopener"><img src="${escHtml(nsPhotoSrc(p))}" alt="รูปร้าน ${i + 1}"></a>`).join("")}</div>` : ""}
  ${m ? `<div class="bx"><span class="ml">ความเห็น Manager :</span>${escHtml(decWord(m.decision))}${m.comment ? " — " + escHtml(m.comment) : ""}</div>` : ""}
  ${execDone ? `<div class="bx"><span class="ml">ผลพิจารณาผู้บริหาร :</span>${escHtml(execDecision)}${d.exec_comment ? " — " + escHtml(d.exec_comment) : ""}</div>` : ""}
  <div class="sg">
    ${sig(d.signature, d.requester, "ผู้ขออนุมัติ (เซลล์)", d.created_at ? formatDateTH(String(d.created_at).slice(0, 10)) : formatDateTH(d.doc_date))}
    ${sig(m?.signature, m?.name, "ผู้จัดการ (Manager)", m?.at ? formatDateTH(String(m.at).slice(0, 10)) : "", decWord(m?.decision))}
    ${sig(execDone ? d.approver_signature : null, null, "ผู้บริหาร (อนุมัติขั้นสุดท้าย)", execDone && d.approved_at ? formatDateTH(String(d.approved_at).slice(0, 10)) : "", execDecision)}
  </div>
</div>`;
}

function nsPrintPage(body) {
  return spPrintPage(body).replace("<title>ใบขออนุมัติราคาพิเศษ</title>", "<title>ใบขออนุมัติเปิดร้านค้าใหม่</title>");
}
