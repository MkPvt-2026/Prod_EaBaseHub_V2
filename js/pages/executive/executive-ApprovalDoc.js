// ============================================================
// executive-ApprovalDoc.js — หน้าเอกสารขออนุมัติ (ผู้บริหาร)
// ------------------------------------------------------------
// เปิดจาก "ดู/อนุมัติ" ในหน้า executive-Approval → ?id=<approval_requests.id>
//   (เคลมระบบเดิมที่ยังไม่อยู่ใน approval_requests → ?id=<claims.id>&src=claim)
// ซ้าย: เอกสาร A4 แบบทางการตามประเภทงาน (ราคาพิเศษใช้แบบฟอร์มเดียวกับหน้าเซลล์/Manager)
// ขวา: สถานะ + ลำดับการอนุมัติ + ลงความเห็น/ลงนาม + บันทึกผล
// ใช้: executive-rules.js (กฎขั้นผู้บริหาร) · special-price-common.js (เอกสารราคาพิเศษ, ช่องเซ็นชื่อ, ตัวจัดรูปแบบ)
//     credit-limit-common.js (วงเงินชั่วคราว) · new-shop-common.js (เปิดร้านค้าใหม่)
// ============================================================

const COMPANY = "บริษัท เอิร์นนี่ แอดวานซ์ จำกัด";
const LIST_URL = "/pages/executive/executive-Approval.html";
const $ = (id) => document.getElementById(id);
const esc = (v) => escHtml(v == null ? "" : v);
const money = (n) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTH = (v) => (v ? new Date(String(v).length <= 10 ? v + "T00:00:00" : v).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" }) : "-");
const dateTimeTH = (v) => (v ? new Date(v).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");
const first = (...a) => a.find((x) => x !== undefined && x !== null && x !== "") ?? "";

const DECISIONS = {
  approved: { label: "อนุมัติ", icon: "check_circle", cls: "is-ok" },
  rejected: { label: "ไม่อนุมัติ", icon: "cancel", cls: "is-bad" },
  request_more_info: { label: "ขอข้อมูลเพิ่ม", icon: "help", cls: "is-warn" },
};

const A = { row: null, claim: null, legacy: false, type: "other", me: null, pending: [], names: new Map() };
let execSig = null;

// ============================================================
// เริ่มต้น
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  const hd = $("headerDateText");
  if (hd) hd.textContent = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
  if (typeof supabaseClient === "undefined") return;

  const q = new URLSearchParams(location.search);
  const id = q.get("id");
  A.legacy = q.get("src") === "claim";
  if (!id) { showFatal("ไม่พบเลขที่คำขอ"); return; }

  loadMe();
  // รายการรออนุมัติ (ใช้กับปุ่มก่อนหน้า/ถัดไป) — ไม่ต้องรอ
  loadExecApprovals().then((r) => { A.pending = r.pending; setExecNavBadge(r.pending.length); renderNav(); }).catch(() => {});

  execSig = createSignaturePad("adSigCanvas", "adSigWrap", "adSigHint");
  $("adSave").addEventListener("click", save);
  $("adPrev").addEventListener("click", () => go(-1));
  $("adNext").addEventListener("click", () => go(1));
  document.addEventListener("keydown", (e) => {
    if (/input|textarea/i.test(document.activeElement?.tagName || "")) return;
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  });

  await loadRow(id);
});

async function loadMe() {
  try { if (!window.currentUser?.id && typeof loadCurrentUser === "function") await loadCurrentUser(); } catch (e) { /* ignore */ }
  A.me = window.currentUser || null;
  if ($("userName")) $("userName").textContent = A.me?.display_name || A.me?.email || "ผู้บริหาร";
}

function showFatal(msg) {
  $("adDoc").innerHTML = `<div class="ed-state is-error">${esc(msg)}</div>`;
  $("adPanel").hidden = true;
}

// ============================================================
// โหลดข้อมูล
// ============================================================
async function loadRow(id) {
  try {
    if (!A.legacy) {
      const { data, error } = await supabaseClient.from("approval_requests").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (data) A.row = data;
    }
    if (!A.row) {
      // เคลมระบบเดิม
      const { data: c, error } = await supabaseClient.from("claims").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!c) { showFatal("ไม่พบคำขอนี้ หรือไม่มีสิทธิ์เปิดดู"); return; }
      A.legacy = true;
      A.claim = c;
      A.row = {
        id: c.id, request_type: "claim", _legacy: true,
        request_status: legacyStatus(c), request_title: `เคลมสินค้า ${first(c.product, c.product_name)}`.trim(),
        sale_name: first(c.emp_name, c.created_by_name), shop_name: first(c.customer, c.customer_name),
        created_at: c.created_at, approved_at: c.exec_at, approved_by: c.exec_by,
        approval_comment: c.exec_comment, approval_signature: c.exec_signature,
      };
    }
    A.type = execNormType(A.row.request_type);
    if (A.type === "claim" && !A.claim && A.row.source_table === "claims" && A.row.source_id) {
      const { data: c } = await supabaseClient.from("claims").select("*").eq("id", A.row.source_id).maybeSingle();
      A.claim = c || null;
    }
    await loadNames();
    if (A.type === "new_area_shop" && typeof nsResolvePhotos === "function") await nsResolvePhotos(A.row); // รูปร้านใน Storage
    render();
  } catch (e) {
    console.error("loadRow:", e);
    showFatal("โหลดเอกสารไม่สำเร็จ: " + (e.message || ""));
  }
}

function legacyStatus(c) {
  const s = String(c.qc_status || c.exec_status || "").toLowerCase();
  if (s === "exec_approved" || s === "approved") return "approved";
  if (s === "exec_rejected" || s === "rejected") return "rejected";
  return "pending";
}

// ชื่อผู้อนุมัติ / ผู้ขอ จาก profiles
async function loadNames() {
  const ids = [A.row.approved_by, A.row.request_by, A.row.created_by, A.claim?.qc_by, A.claim?.exec_by].filter((x) => x && !A.names.has(x));
  if (!ids.length) return;
  const { data } = await supabaseClient.from("profiles").select("id, display_name, full_name, role").in("id", [...new Set(ids)]);
  (data || []).forEach((p) => A.names.set(p.id, p.display_name || p.full_name || ""));
}
const nameOf = (id, fallback = "") => (id && A.names.get(id)) || fallback;

// ============================================================
// สถานะ / ขั้นตอน
// ============================================================
function statusKey() {
  const rs = A.row.request_status;
  if (["approved", "exec_approved"].includes(rs)) return "approved";
  if (["rejected", "exec_rejected"].includes(rs)) return "rejected";
  if (rs === "request_more_info") return "request_more_info";
  return "pending";
}
function canDecide() {
  return statusKey() === "pending" && execAtStage(A.row) && (A.legacy || execIsPending(A.row));
}
function decisionsFor() {
  return ["special_price", "new_area_shop"].includes(A.type) ? ["approved", "rejected", "request_more_info"] : ["approved", "rejected"];
}
function docNo() {
  if (A.type === "special_price") return spDocNo(A.row);
  if (A.type === "new_area_shop" && typeof nsDocNo === "function") return nsDocNo(A.row);
  const y = new Date(A.row.created_at || Date.now()).getFullYear();
  const tag = { temp_credit_limit: "CREDIT", claim: "CLAIM", promotion: "PROMO", new_area_shop: "SHOP" }[A.type] || "APP";
  return `APP-${y}-${tag}-${String(A.row.id || "").slice(0, 8).toUpperCase()}`;
}

// ลำดับการอนุมัติ (ใช้ทั้งไทม์ไลน์ขวา และช่องลงนามในเอกสาร)
function chain() {
  const r = A.row, sk = statusKey();
  const execStep = {
    role: "ผู้บริหาร (อนุมัติขั้นสุดท้าย)",
    name: sk === "pending" ? "" : nameOf(r.approved_by, "ผู้บริหาร"),
    at: sk === "pending" ? null : r.approved_at,
    sig: sk === "pending" ? null : first(r.approval_signature, r.exec_signature) || null,
    state: sk === "pending" ? (canDecide() ? "now" : "") : sk === "approved" ? "ok" : sk === "rejected" ? "bad" : "warn",
    note: sk === "pending" ? (canDecide() ? "รอพิจารณา" : "") : DECISIONS[sk]?.label,
    comment: sk === "pending" ? "" : first(r.approval_comment, r.exec_comment),
  };
  const requester = { role: "ผู้ขออนุมัติ", name: first(r.sale_name, r.requester_name, r.created_by_name, nameOf(r.request_by)), at: r.created_at, sig: r.signature || r.payload?.signature || null, state: "ok", note: "ส่งคำขอ" };
  if (A.type === "special_price" || A.type === "new_area_shop") {
    const m = r.payload?.manager;
    return [requester, { role: "ผู้จัดการ (Manager)", name: m?.name || "", at: m?.at, sig: m?.signature || null, state: m ? (m.decision === "approved" ? "ok" : m.decision === "rejected" ? "bad" : "warn") : "now", note: m ? DECISIONS[m.decision]?.label : "รอพิจารณา", comment: m?.comment }, execStep];
  }
  if (A.type === "temp_credit_limit") {
    const st = r.status;
    const accOk = st && st !== "accounting_review" && st !== "pending";
    const mgrOk = ["executive_review", "waiting_ceo", "approved", "rejected"].includes(st) || ["approved", "rejected"].includes(r.request_status);
    return [requester,
      { role: "ฝ่ายบัญชี (ตรวจสอบ)", name: "", at: null, sig: null, state: accOk ? "ok" : "now", note: accOk ? "ตรวจแล้ว" : "รอตรวจสอบ" },
      { role: "ผู้จัดการ (Manager)", name: "", at: null, sig: null, state: mgrOk ? "ok" : accOk ? "now" : "", note: mgrOk ? "ผ่าน" : "" },
      execStep];
  }
  if (A.type === "claim") {
    const c = A.claim || {};
    return [{ ...requester, name: first(c.emp_name, requester.name), at: first(c.created_at, r.created_at) },
      { role: "QC (ตรวจสอบสินค้า)", name: nameOf(c.qc_by, first(c.qc_name)), at: first(c.qc_at, c.updated_at) || null, sig: c.qc_signature || null, state: "ok", note: "ตรวจแล้ว" },
      execStep];
  }
  return [requester, execStep];
}

// ============================================================
// แสดงผล
// ============================================================
function render() {
  const r = A.row, sk = statusKey();
  const t = EXEC_TYPE[A.type] || { label: "งานอนุมัติ", icon: "approval" };
  document.title = `EABaseHub | ${docNo()}`;
  $("adSubtitle").textContent = `${t.label} · ${docNo()}`;
  $("adType").innerHTML = `<span class="material-symbols-outlined">${t.icon}</span>${esc(t.label)}`;
  const stTxt = sk === "pending" ? (canDecide() ? "รอผู้บริหารพิจารณา" : "ยังไม่ถึงขั้นผู้บริหาร") : DECISIONS[sk].label + (sk === "approved" ? "แล้ว" : "");
  $("adStatus").textContent = stTxt;
  $("adStatus").className = `er-pill ${sk === "pending" ? (canDecide() ? "is-warn" : "") : DECISIONS[sk].cls}`;
  $("adTitle").textContent = first(r.request_title, r.shop_name ? `${t.label} · ${r.shop_name}` : "", t.label);
  $("adNo").textContent = `เลขที่ ${docNo()} · ยื่นเมื่อ ${dateTimeTH(r.created_at)}`;
  $("adTimeline").innerHTML = chain().map((s) => `<li class="is-${s.state || "idle"}"><i></i><b>${esc(s.role)}</b>
    <span>${esc([s.name, s.note].filter(Boolean).join(" · ") || "—")}${s.at ? ` · ${dateTimeTH(s.at)}` : ""}</span>
    ${s.comment ? `<em>“${esc(s.comment)}”</em>` : ""}</li>`).join("");

  // เอกสาร
  let html;
  if (A.type === "special_price") html = docSpecialPrice();
  else if (A.type === "temp_credit_limit") html = docCredit();
  else if (A.type === "claim") html = docClaim();
  else if (A.type === "new_area_shop" && typeof nsBuildDocHTML === "function") html = `<div class="ad-sp">${nsBuildDocHTML({ ...nsDocFromRow(A.row), approver_signature: first(A.row.approval_signature, A.row.exec_signature) || null })}</div>`;
  else html = docGeneric();
  $("adDoc").innerHTML = html;

  // แผงพิจารณา
  const decide = canDecide();
  $("adDecide").hidden = !decide;
  $("adDone").hidden = decide;
  if (decide) {
    $("adChoices").innerHTML = decisionsFor().map((k) => `<label class="ad-choice ${DECISIONS[k].cls}">
      <input type="radio" name="adDecision" value="${k}"><span class="material-symbols-outlined">${DECISIONS[k].icon}</span>${DECISIONS[k].label}</label>`).join("");
    $("adChoices").onchange = () => {
      const v = document.querySelector("input[name='adDecision']:checked")?.value;
      $("adCommentLabel").innerHTML = v && v !== "approved" ? `ความเห็น / เหตุผล <i>*</i>` : "ความเห็น / เงื่อนไข";
    };
    requestAnimationFrame(() => execSig?.refit?.());
  } else {
    $("adDone").innerHTML = sk === "pending"
      ? `<h3><span class="material-symbols-outlined">hourglass_top</span> ยังไม่ถึงขั้นผู้บริหาร</h3><p class="ad-muted">คำขอนี้ยังรอขั้นก่อนหน้า (${A.type === "temp_credit_limit" ? "ฝ่ายบัญชี / Manager" : "Manager"}) เมื่อผ่านแล้วจึงพิจารณาได้</p>`
      : `<h3><span class="material-symbols-outlined">${DECISIONS[sk].icon}</span> ${DECISIONS[sk].label}แล้ว</h3>
         <dl class="ad-dl"><dt>ผู้พิจารณา</dt><dd>${esc(nameOf(r.approved_by, "ผู้บริหาร"))}</dd><dt>วันที่</dt><dd>${esc(dateTimeTH(r.approved_at))}</dd>
         ${first(r.approval_comment, r.exec_comment) ? `<dt>ความเห็น</dt><dd>${esc(first(r.approval_comment, r.exec_comment))}</dd>` : ""}</dl>
         ${nextPendingBtn()}`;
  }
  renderNav();
}

function nextPendingBtn() {
  const nxt = A.pending.find((p) => String(p.id) !== String(A.row.id));
  return nxt ? `<a class="er-btn ad-save" href="${docUrl(nxt)}"><span class="material-symbols-outlined">arrow_forward</span>ไปรายการรออนุมัติถัดไป</a>` : `<a class="er-btn is-ghost ad-save" href="${LIST_URL}">กลับรายการอนุมัติ</a>`;
}

function docUrl(r) { return `/pages/executive/executive-ApprovalDoc.html?id=${encodeURIComponent(r.id)}${r._legacy ? "&src=claim" : ""}`; }
function renderNav() {
  if (!A.row || !A.pending.length) return;
  const i = A.pending.findIndex((p) => String(p.id) === String(A.row.id));
  $("adNav").hidden = false;
  $("adPos").textContent = i >= 0 ? `รออนุมัติ ${i + 1} / ${A.pending.length}` : `รออนุมัติ ${A.pending.length} รายการ`;
  $("adPrev").disabled = i <= 0;
  $("adNext").disabled = i < 0 ? !A.pending.length : i >= A.pending.length - 1;
}
function go(step) {
  if (!A.pending.length) return;
  const i = A.pending.findIndex((p) => String(p.id) === String(A.row?.id));
  const j = i < 0 ? 0 : i + step;
  if (j >= 0 && j < A.pending.length && j !== i) location.href = docUrl(A.pending[j]);
}

// ---------- ส่วนประกอบเอกสาร ----------
function docHead(title, sub) {
  const sk = statusKey();
  const stamp = sk === "pending" ? "" : `<div class="ad-stamp ${DECISIONS[sk].cls}">${DECISIONS[sk].label}</div>`;
  return `<header class="ad-dh">
    <div><div class="ad-co">${esc(COMPANY)}</div><div class="ad-dt">${esc(title)}</div>${sub ? `<div class="ad-ds">${esc(sub)}</div>` : ""}</div>
    <div class="ad-dno">เลขที่<b>${esc(docNo())}</b>วันที่ ${esc(dateTH(first(A.row.request_date, A.row.created_at)))}</div>${stamp}
  </header>`;
}
function metaGrid(pairs) {
  // ตาราง 4 คอลัมน์ (หัวข้อ | ค่า | หัวข้อ | ค่า) · รายการที่ full = เต็มแถว
  const rows = [];
  let cur = [];
  pairs.filter(Boolean).forEach(([k, v, full]) => {
    if (full) { if (cur.length) rows.push(cur); rows.push([[k, v, true]]); cur = []; return; }
    cur.push([k, v]);
    if (cur.length === 2) { rows.push(cur); cur = []; }
  });
  if (cur.length) rows.push(cur);
  return `<table class="ad-meta"><colgroup><col style="width:17%"><col style="width:33%"><col style="width:17%"><col style="width:33%"></colgroup>${rows.map((r) =>
    `<tr>${r.map(([k, v, full]) => `<th>${esc(k)}</th><td${full || r.length === 1 ? ' colspan="3"' : ""}>${v}</td>`).join("")}</tr>`).join("")}</table>`;
}
function signBlock() {
  const steps = chain();
  return `<section class="ad-signs" style="--n:${steps.length}">${steps.map((s) => `<div class="ad-sb">
    <div class="ad-si">${s.sig ? `<img src="${esc(s.sig)}" alt="ลายเซ็น">` : ""}</div>
    <div class="ad-sn">(${esc(s.name || "..............................................")})</div>
    <div class="ad-sr">${esc(s.role)}${s.note && s.state !== "now" && s.state !== "idle" ? ` · <b>${esc(s.note)}</b>` : ""}</div>
    <div class="ad-sd">${s.at && s.state !== "now" ? "วันที่ " + esc(dateTH(s.at)) : "วันที่ ......../......../........"}</div></div>`).join("")}</section>`;
}
function execDecisionBox() {
  const sk = statusKey();
  if (sk === "pending") return "";
  const c = first(A.row.approval_comment, A.row.exec_comment);
  return `<div class="ad-box"><b>ผลพิจารณาผู้บริหาร :</b> ${esc(DECISIONS[sk].label)}${c ? " — " + esc(c) : ""}</div>`;
}
function attachments(obj) {
  const urls = [];
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (/signature/i.test(k)) return;
    if (typeof v === "string" && /^https?:\/\//.test(v)) urls.push([k, v]);
    if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === "string" && /^https?:\/\//.test(x)) urls.push([`${k} ${i + 1}`, x]); });
  });
  if (!urls.length) return "";
  const isImg = (u) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u);
  return `<section class="ad-sec"><h4>เอกสาร / รูปประกอบ</h4><div class="ad-att">${urls.map(([k, u]) => isImg(u)
    ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(k)}"></a>`
    : `<a class="ad-file" href="${esc(u)}" target="_blank" rel="noopener"><span class="material-symbols-outlined">attach_file</span>${esc(k)}</a>`).join("")}</div></section>`;
}

// ---------- เอกสารแต่ละประเภท ----------
function docSpecialPrice() {
  // ใช้แบบฟอร์มเดียวกับหน้าเซลล์ / Manager (special-price-common.js)
  return `<div class="ad-sp">${spBuildDocHTML({ ...spDocFromRow(A.row), approver_signature: first(A.row.approval_signature, A.row.exec_signature) || null })}</div>`;
}

function docCredit() {
  // ใช้แบบฟอร์มเดียวกับหน้าเซลล์ (credit-limit-common.js) — มีผลตรวจฝ่ายบัญชีในเอกสาร
  if (typeof clBuildDocHTML === "function") return `<div class="ad-sp">${clBuildDocHTML(clDocFromRow(A.row))}</div>`;
  const r = A.row;
  return `${docHead("ใบขออนุมัติวงเงินเครดิตชั่วคราว", "Temporary Credit Limit Approval")}
    ${metaGrid([["ลูกค้า", esc(first(r.shop_name, "-"))], ["ผู้ขอ", esc(first(r.sale_name, "-"))]])}
    <div class="ad-box"><b>ยอดบิลที่ขอเปิด :</b> ${money(r.request_amount)} บาท</div>
    <div class="ad-box"><b>เหตุผลการขอ :</b> ${esc(first(r.request_detail, r.reason, "-"))}</div>
    ${execDecisionBox()}
    ${signBlock()}`;
}

function gradeRows(qc) {
  return [
    ["A", "คืนสต็อก / พร้อมขาย", qc.grade_a_qty], ["B", "ขายเกรดรอง / Outlet", qc.grade_b_qty],
    ["R", "ส่งกลับบด / หลอมใหม่", qc.repair_qty ?? qc.grade_r_qty], ["S", "สำรองอะไหล่ / ใช้ภายใน", qc.spare_qty ?? qc.grade_s_qty],
    ["C", "ทิ้ง / ตัดจ่าย / คืน Supplier", qc.scrap_qty ?? qc.grade_c_qty],
  ];
}
function docClaim() {
  const r = A.row, c = A.claim || {};
  let qc = c.qc_result || {};
  if (typeof qc === "string") { try { qc = JSON.parse(qc); } catch (e) { qc = {}; } }
  const types = Array.isArray(c.claim_types) ? c.claim_types.join(", ") : first(c.claim_types, c.claim_type);
  const grades = gradeRows(qc);
  const hasQc = grades.some(([, , q]) => Number(q || 0) > 0) || qc.defect_reason || c.qc_comment;
  return `${docHead("ใบขออนุมัติการเคลมสินค้า", c.claim_scope === "internal" ? "เคลมภายใน (วัตถุดิบ / สินค้า)" : "เคลมสินค้าสำเร็จรูป (ภายนอก)")}
    ${metaGrid([
      ["ลูกค้า", esc(first(c.customer, c.customer_name, r.shop_name, "-"))],
      ["ผู้แจ้ง", esc(first(c.emp_name, r.sale_name, "-"))],
      ["สินค้า", esc(first(c.product, c.product_name, "-"))],
      ["จำนวน", esc(first(c.qty, c.quantity, "-"))],
      ["วันที่แจ้งเคลม", esc(dateTH(first(c.claim_date, c.created_at, r.created_at)))],
      ["ลักษณะปัญหา", esc(types || "-")],
      ["รายละเอียด", esc(first(c.detail, c.claim_detail, c.problem_detail, r.request_detail, "-")), true],
    ])}
    ${hasQc ? `<section class="ad-sec"><h4>ผลตรวจสอบจาก QC</h4>
      <table class="ad-items"><thead><tr><th style="width:12%">เกรด</th><th>การจัดการ</th><th style="width:18%">จำนวน</th></tr></thead>
      <tbody>${grades.map(([g, l, q]) => `<tr><td>${g}</td><td class="l">${esc(l)}</td><td class="r">${Number(q || 0).toLocaleString("th-TH")}</td></tr>`).join("")}</tbody></table>
      ${metaGrid([["สาเหตุหลัก", esc(first(qc.defect_reason, "-"))], ["ผู้รับผิดชอบ", esc(first(qc.responsibility, "-"))], ["ความเห็น QC", esc(first(c.qc_comment, qc.comment, "-")), true]])}
    </section>` : ""}
    ${execDecisionBox()}
    ${attachments({ media_urls: c.media_urls, ...Object.fromEntries(Object.entries(c).filter(([k]) => /_url$/.test(k))) })}
    ${signBlock()}`;
}

function docGeneric() {
  const r = A.row;
  const t = EXEC_TYPE[A.type] || { label: "งานอนุมัติ" };
  const amt = Number(first(r.amount, r.total_amount, r.request_amount, r.price_amount)) || 0;
  return `${docHead(`ใบขออนุมัติ${t.label}`, first(r.request_title))}
    ${metaGrid([
      ["เรื่อง", esc(first(r.request_title, t.label)), true],
      ["ผู้ขอ", esc(first(r.sale_name, r.requester_name, r.created_by_name, nameOf(r.request_by), "-"))],
      ["ร้าน / หน่วยงาน", esc(first(r.shop_name, r.department, "-"))],
      amt ? ["มูลค่า", `${money(amt)} บาท`] : null,
      ["ความเร่งด่วน", esc(first(r.priority, "ปกติ"))],
    ])}
    <div class="ad-box"><b>รายละเอียด :</b> ${esc(first(r.request_detail, r.detail, r.description, r.reason, "-"))}</div>
    ${execDecisionBox()}
    ${attachments(r)}
    ${signBlock()}`;
}

// ============================================================
// บันทึกผลการพิจารณา
// ============================================================
function showErr(msg) { $("adErr").textContent = msg; $("adErr").hidden = !msg; }

async function save() {
  showErr("");
  const decision = document.querySelector("input[name='adDecision']:checked")?.value;
  const comment = $("adComment").value.trim();
  const sig = execSig?.get();
  if (!decision) return showErr("กรุณาเลือกผลการพิจารณา");
  if (decision !== "approved" && !comment) { $("adComment").focus(); return showErr("กรุณาระบุเหตุผล"); }
  if (decision !== "request_more_info" && !sig) return showErr("กรุณาเซ็นชื่อก่อนบันทึก");
  if (!confirm(`ยืนยัน "${DECISIONS[decision].label}" คำขอ ${docNo()} ?`)) return;

  const btn = $("adSave");
  btn.disabled = true;
  try {
    const me = A.me?.id || (await eaGetMyProfile()).session?.user?.id;
    const now = new Date().toISOString();
    const r = A.row;

    if (!A.legacy) {
      const upd = { request_status: decision, approval_comment: comment || null, approval_signature: sig || null, approved_by: me || null, approved_at: now, updated_at: now };
      // วงเงินชั่วคราว: สถานะที่เซลล์/บัญชีติดตาม (status) ต้องจบด้วย
      if (A.type === "temp_credit_limit" && decision !== "request_more_info") upd.status = decision;
      // กันบันทึกซ้ำ / ทับผลที่มีคนตัดสินไปแล้ว
      const { data, error } = await supabaseClient.from("approval_requests").update(upd)
        .eq("id", r.id).not("request_status", "in", "(approved,rejected,request_more_info)").select();
      if (error) throw error;
      if (!data || !data.length) throw new Error("รายการนี้ถูกพิจารณาไปแล้ว หรือไม่มีสิทธิ์บันทึก — กรุณารีเฟรชหน้า");
      Object.assign(r, data[0]);
    }
    // เคลม: อัปเดตตาราง claims ด้วย (ทั้งเคลมเดิม และเคลมที่ผูกกับ approval_requests)
    const claimId = A.legacy ? r.id : (A.type === "claim" && r.source_table === "claims" ? r.source_id : null);
    if (claimId && decision !== "request_more_info") {
      const { data, error } = await supabaseClient.from("claims").update({
        exec_status: decision, qc_status: decision === "approved" ? "exec_approved" : "exec_rejected",
        exec_comment: comment || null, exec_signature: sig || null, exec_by: me || null, exec_at: now, updated_at: now,
      }).eq("id", claimId).select();
      if (error) throw error;
      if (!data || !data.length) throw new Error("อัปเดตเคลมไม่สำเร็จ (ไม่พบเคลม หรือไม่มีสิทธิ์)");
      A.claim = { ...(A.claim || {}), ...data[0] };
      if (A.legacy) Object.assign(r, { request_status: decision, approval_comment: comment, approval_signature: sig, approved_by: me, approved_at: now });
    }
    // แจ้งเซลล์ผู้ขอ (ราคาพิเศษ / วงเงิน / เปิดร้าน)
    if (!A.legacy && A.type !== "claim") window.eaApprovalNotify?.notifyDecision({ type: A.type === "temp_credit_limit" ? "credit_limit_temp" : A.type, requesterId: r.request_by || r.created_by, shopName: r.shop_name, decision, by: "ผู้บริหาร", comment });
    A.pending = A.pending.filter((p) => String(p.id) !== String(r.id));
    setExecNavBadge(A.pending.length);
    await loadNames();
    render();
    toast(`บันทึก "${DECISIONS[decision].label}" แล้ว`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    console.error("save:", e);
    showErr("บันทึกไม่สำเร็จ: " + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

let _toastT = null;
function toast(msg, bad) {
  const el = $("erToast");
  el.textContent = msg;
  el.classList.toggle("is-err", !!bad);
  el.classList.add("is-show");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove("is-show"), 3000);
}
