// =====================================================
// new-shop-manager.js — รายการคำขอเปิดร้านค้าใหม่ (Manager · ขั้นที่ 1)
// ต้องโหลด special-price-common.js + new-shop-common.js ก่อน
// กดคำขอ → new-shop-manager-doc.html (เอกสาร A4 + ลงความเห็น/ลงนาม) แบบเดียวกับราคาพิเศษ
// ขอบเขต: Manager เห็นคำขอของพนักงานที่ profiles.manager_id = ตัวเอง (ยังไม่ผูกทีม = ทั้งหมด) · Admin ทั้งหมด
// =====================================================
"use strict";

const MGR_ROLES = ["admin", "manager"];
const DOC_URL = (id) => `/pages/forms/new-shop-manager-doc.html?id=${encodeURIComponent(id)}`;
// ดึงแบบเบา: ไม่ดึงรูป/ลายเซ็น
const COLS = "id, request_by, request_status, status, shop_name, province, sale_name, approved_at, created_at, pl_type:payload->shop_new->>shop_type, pl_district:payload->shop_new->>district, pl_est:payload->shop_new->>est_monthly, pl_pay:payload->shop_new->>pay_term, pl_cdays:payload->shop_new->>credit_days, pl_climit:payload->shop_new->>credit_limit, pl_m_decision:payload->manager->>decision, pl_m_name:payload->manager->>name, pl_m_at:payload->manager->>at";

let me = { id: null, name: "", role: "" };
let _all = [];
let _teamIds = null;
let _tab = "waiting";

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof supabaseClient === "undefined") { alert("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  try { if (typeof protectPage === "function") await protectPage(MGR_ROLES); } catch (e) { console.error(e); return; }
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") { try { await loadCurrentUser(); } catch (e) { /* ignore */ } }
  me = await spLoadMe();
  document.querySelectorAll("#queueTabs button").forEach((b) => b.addEventListener("click", () => {
    _tab = b.dataset.f;
    document.querySelectorAll("#queueTabs button").forEach((x) => x.classList.toggle("is-on", x === b));
    renderQueue();
  }));
  document.getElementById("queueSearch").addEventListener("input", renderQueue);
  await loadTeam();
  await loadQueue();
});

async function loadTeam() {
  let text = "แสดงคำขอทั้งหมด";
  if (me.role === "manager") {
    try {
      const { data, error } = await supabaseClient.from("profiles").select("id").eq("manager_id", me.id);
      if (error) throw error;
      const ids = (data || []).map((p) => p.id);
      if (ids.length) { _teamIds = new Set(ids); text = `คำขอจากทีมของคุณ ${ids.length} คน`; }
      else text = "ยังไม่มีพนักงานที่ผูกกับคุณในระบบ — แสดงคำขอทั้งหมด";
    } catch (e) { console.warn("loadTeam:", e); text = "โหลดรายชื่อทีมไม่สำเร็จ — แสดงคำขอทั้งหมด"; }
  }
  setText("scopeText", text);
}

function lift(r) {
  if (!("pl_m_decision" in r)) return r;
  r.payload = {
    shop_new: { shop_type: r.pl_type, district: r.pl_district, est_monthly: r.pl_est, pay_term: r.pl_pay, credit_days: r.pl_cdays, credit_limit: r.pl_climit },
    manager: r.pl_m_decision ? { decision: r.pl_m_decision, name: r.pl_m_name, at: r.pl_m_at } : null,
  };
  Object.keys(r).filter((k) => k.startsWith("pl_")).forEach((k) => delete r[k]);
  return r;
}
function bucketOf(r) {
  const m = spManager(r);
  if ((r.request_status || "waiting_manager") === "waiting_manager" && !m) return "waiting";
  if (m?.decision === "approved") return "forwarded";
  return "closed";
}
async function loadQueue() {
  const c = document.getElementById("queueList");
  c.innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  try {
    const q = (sel) => supabaseClient.from("approval_requests").select(sel).eq("request_type", NS_TYPE).order("created_at", { ascending: false }).limit(300);
    let { data, error } = await q(COLS);
    if (error) { console.warn("loadQueue (light):", error.message); ({ data, error } = await q("*")); if (error) throw error; }
    _all = (data || []).map(lift).filter((r) => !_teamIds || _teamIds.has(r.request_by) || r.request_by === me.id);
    renderQueue();
  } catch (e) {
    c.innerHTML = `<div class="fp-empty is-error">โหลดไม่สำเร็จ: ${escHtml(e.message)}<br><button type="button" class="fp-link-btn" onclick="loadQueue()">ลองใหม่</button></div>`;
  }
}
function renderQueue() {
  const counts = { waiting: 0, forwarded: 0, closed: 0 };
  _all.forEach((r) => { counts[bucketOf(r)]++; });
  setText("cntWaiting", counts.waiting); setText("cntForwarded", counts.forwarded); setText("cntClosed", counts.closed);
  const q = document.getElementById("queueSearch").value.trim().toLowerCase();
  const rows = _all.filter((r) => bucketOf(r) === _tab).filter((r) => !q || [r.shop_name, r.province, r.sale_name, nsShop(r).district].join(" ").toLowerCase().includes(q));
  if (_tab === "waiting") rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // มาก่อนพิจารณาก่อน
  const c = document.getElementById("queueList");
  if (!rows.length) {
    c.innerHTML = `<div class="fp-empty">${q ? "ไม่พบรายการที่ค้นหา" : _tab === "waiting" ? "ไม่มีคำขอรออนุมัติ 🎉" : "ยังไม่มีรายการ"}</div>`;
    return;
  }
  c.innerHTML = rows.map((r) => {
    const st = nsStatus(r), s = nsShop(r);
    const where = [s.district, r.province].filter(Boolean).join(" · ") || "-";
    return `
      <div class="fp-item">
        <button type="button" class="fp-item-main" onclick="location.href='${DOC_URL(r.id)}'">
          <span class="fp-item-title">${escHtml(r.shop_name || "-")}${_tab !== "waiting" ? ` <span class="fp-badge ${st.cls}">${escHtml(st.label)}</span>` : ""}</span>
          <span class="fp-item-sub"><span>${escHtml(r.sale_name || "-")}</span><span>${escHtml(where)}</span><span>${escHtml(s.shop_type || "")}</span></span>
          <span class="fp-item-sub"><span>คาดการณ์ ${Number(s.est_monthly) ? fmtMoney(s.est_monthly) : "-"} บาท/เดือน</span><span class="spm-pct${s.pay_term === "credit" ? " is-high" : ""}">${escHtml(nsPayText(s))}</span><span>${formatDateTimeTH(r.created_at)}</span></span>
        </button>
      </div>`;
  }).join("");
}
