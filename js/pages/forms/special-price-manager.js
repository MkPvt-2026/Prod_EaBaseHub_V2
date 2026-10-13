// =====================================================
// special-price-manager.js v2.0 — อนุมัติราคาพิเศษ ขั้นที่ 1 (Manager)
// ต้องโหลด special-price-common.js ก่อน
//
// คิว: approval_requests (request_type "special_price")
//   รออนุมัติ        = request_status "waiting_manager"
//   ส่งผู้บริหารแล้ว = payload.manager.decision "approved"
//   ปิดแล้ว          = Manager ไม่อนุมัติ / ขอข้อมูลเพิ่ม
// ขอบเขต: Manager เห็นคำขอของพนักงานที่ profiles.manager_id = ตัวเอง
//         (ถ้ายังไม่ได้ผูกทีมไว้ จะแสดงทั้งหมด) · Admin เห็นทั้งหมด
// =====================================================
"use strict";

const MGR_ROLES = ["admin", "manager"];

let me = { id: null, name: "", role: "" };
let mgrSig = null;
let _all = [];
let _teamIds = null;     // null = ไม่จำกัด
let _tab = "waiting";
let _selectedId = null;
let _deciding = false;

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
  const q = new URLSearchParams(location.search).get("id");
  if (q) { location.replace(`/pages/forms/special-price-manager-doc.html?id=${encodeURIComponent(q)}`); return; }
});

// =====================================================
// 👥 ทีม
// =====================================================
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

// =====================================================
// 📥 คิว
// =====================================================
function bucketOf(r) {
  const m = spManager(r), rs = r.request_status || "waiting_manager";
  if (rs === "waiting_manager" && !m) return "waiting";
  if (m?.decision === "approved") return "forwarded";
  if (m) return "closed";
  return spReachedExec(r) ? "forwarded" : "waiting"; // คำขอรุ่นแรกที่ไม่มีขั้น Manager
}
async function loadQueue() {
  const c = document.getElementById("queueList");
  c.innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  try {
    const { data, error } = await supabaseClient.from("approval_requests").select("*")
      .eq("request_type", SP_TYPE).order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    _all = (data || []).filter((r) => !_teamIds || _teamIds.has(r.request_by) || r.request_by === me.id);
    renderQueue();
    if (_selectedId) { if (findReq(_selectedId)) renderDetail(); else clearDetail(); }
  } catch (e) {
    c.innerHTML = `<div class="fp-empty is-error">โหลดไม่สำเร็จ: ${escHtml(e.message)}<br><button type="button" class="fp-link-btn" onclick="loadQueue()">ลองใหม่</button></div>`;
  }
}
function findReq(id) { return _all.find((r) => String(r.id) === String(id)) || null; }
function renderQueue() {
  const counts = { waiting: 0, forwarded: 0, closed: 0 };
  _all.forEach((r) => { counts[bucketOf(r)]++; });
  setText("cntWaiting", counts.waiting); setText("cntForwarded", counts.forwarded); setText("cntClosed", counts.closed);
  const q = document.getElementById("queueSearch").value.trim().toLowerCase();
  const rows = _all.filter((r) => bucketOf(r) === _tab).filter((r) => {
    if (!q) return true;
    return [r.shop_name, r.shop_code, r.sale_name, ...(r.payload?.items || []).map((i) => i.name)].join(" ").toLowerCase().includes(q);
  });
  // รออนุมัติ: เก่าสุดก่อน (มาก่อนพิจารณาก่อน)
  if (_tab === "waiting") rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const c = document.getElementById("queueList");
  if (!rows.length) {
    c.innerHTML = `<div class="fp-empty">${q ? "ไม่พบรายการที่ค้นหา" : _tab === "waiting" ? "ไม่มีคำขอรออนุมัติ 🎉" : "ยังไม่มีรายการ"}</div>`;
    return;
  }
  c.innerHTML = rows.map((r) => {
    const st = spStatus(r), t = totalsOf(itemsOf(r)), id = escHtml(r.id);
    return `
      <div class="fp-item${String(r.id) === String(_selectedId) ? " is-active" : ""}" id="q-${id}">
        <button type="button" class="fp-item-main" onclick="selectRequest('${id}')">
          <span class="fp-item-title">${escHtml(r.shop_name || "-")}${_tab !== "waiting" ? ` <span class="fp-badge ${st.cls}">${escHtml(st.label)}</span>` : ""}</span>
          <span class="fp-item-sub"><span>${escHtml(r.sale_name || "-")}</span><span>${t.count} รายการ</span><span class="spm-pct${t.pct > SP_HIGH_DISCOUNT_PCT ? " is-high" : ""}">ลด ${fmtPct(t.pct)}</span></span>
          <span class="fp-item-sub"><span>ส่วนต่าง ${fmtMoney(t.diff)} บาท</span><span>${formatDateTimeTH(r.created_at)}</span></span>
        </button>
      </div>`;
  }).join("");
}

// =====================================================
// 🔎 รายละเอียด
// =====================================================
// เปิดคำขอ → หน้าเอกสาร (A4 + แผงพิจารณา) แบบเดียวกับหน้าผู้บริหาร
function selectRequest(id) {
  location.href = `/pages/forms/special-price-manager-doc.html?id=${encodeURIComponent(id)}`;
}
// แผงรายละเอียดเดิม (ไม่ได้ใช้จากรายการแล้ว)
function selectRequestInline(id) {
  if (String(id) !== String(_selectedId) && hasUnsavedDecision() && !confirm("ความเห็น/ลายเซ็นที่กรอกไว้จะหาย — เปิดคำขออื่น?")) return;
  _selectedId = id;
  document.getElementById("mgrComment").value = "";
  document.querySelectorAll("#queueList .fp-item").forEach((el) => el.classList.toggle("is-active", el.id === `q-${id}`));
  renderDetail();
  mgrSig.clear();
  if (window.innerWidth <= 900) document.getElementById("detailCard").scrollIntoView({ behavior: "smooth", block: "start" });
}
function hasUnsavedDecision() { return !!(document.getElementById("mgrComment")?.value.trim() || mgrSig?.get()); }
function clearDetail() {
  _selectedId = null;
  document.getElementById("detailEmpty").hidden = false;
  document.getElementById("detailBody").hidden = true;
}
function renderDetail() {
  const r = findReq(_selectedId); if (!r) { clearDetail(); return; }
  document.getElementById("detailEmpty").hidden = true;
  document.getElementById("detailBody").hidden = false;
  const st = spStatus(r), items = itemsOf(r), t = totalsOf(items), m = spManager(r);
  setText("dTitle", r.shop_name || "-");
  const badge = document.getElementById("dBadge"); badge.textContent = st.label; badge.className = `fp-badge ${st.cls}`;
  document.getElementById("dTimeline").innerHTML = spTimelineHTML(r);
  setText("kNormal", fmtMoney(t.normal)); setText("kRequest", fmtMoney(t.request)); setText("kDiff", fmtMoney(t.diff)); setText("kPct", fmtPct(t.pct));
  document.getElementById("dDoc").innerHTML = spBuildDocHTML(spDocFromRow(r));

  // ข้อควรตรวจสำหรับผู้พิจารณา
  const flags = [];
  items.forEach((it, i) => { if (it.discount_pct > SP_HIGH_DISCOUNT_PCT) flags.push(`รายการ ${i + 1} (${it.name}) ส่วนลดสูง ${fmtPct(it.discount_pct)}`); });
  if (!r.shop_id) flags.push("ลูกค้าไม่ได้เลือกจากรายชื่อในระบบ (พิมพ์ชื่อเอง)");
  const fb = document.getElementById("dFlags");
  fb.hidden = !flags.length;
  fb.innerHTML = flags.length ? `<b>ข้อควรตรวจ</b><ul>${flags.map((f) => `<li>${escHtml(f)}</li>`).join("")}</ul>` : "";

  // ส่วนพิจารณา
  const canDecide = bucketOf(r) === "waiting";
  const own = r.request_by === me.id;
  const note = document.getElementById("decideNote");
  let noteHtml = "";
  if (!canDecide && m) noteHtml = `<span class="material-symbols-outlined">verified</span><span>พิจารณาแล้ว: <b>${escHtml(({ approved: "อนุมัติและส่งต่อผู้บริหาร", rejected: "ไม่อนุมัติ", request_more_info: "ขอข้อมูลเพิ่ม" })[m.decision] || m.decision)}</b> โดย ${escHtml(m.name || "-")} · ${formatDateTimeTH(m.at)}${m.comment ? `<br>“${escHtml(m.comment)}”` : ""}</span>`;
  else if (!canDecide) noteHtml = `<span class="material-symbols-outlined">info</span><span>คำขอนี้ไม่ได้อยู่ในขั้น Manager แล้ว</span>`;
  else if (own) noteHtml = `<span class="material-symbols-outlined">block</span><span>เป็นคำขอของคุณเอง — ต้องให้ Manager คนอื่นหรือ Admin เป็นผู้พิจารณา</span>`;
  note.hidden = !noteHtml; note.innerHTML = noteHtml;
  const open = canDecide && !own;
  document.getElementById("decideForm").hidden = !open;
  document.getElementById("sigClearBtn").hidden = !open;
  document.getElementById("decideBar").hidden = !open;
  document.querySelector("#decideSec .fp-sec-title").innerHTML = open ? `<b>✓</b> ความเห็นและลายเซ็น Manager` : `<b>✓</b> ผลการพิจารณาของ Manager`;
  setText("decideStatus", open ? `รอคุณพิจารณา · ส่งมา ${formatDateTimeTH(r.created_at)}` : "");
  if (open) requestAnimationFrame(() => mgrSig.refit());
}
function printCurrent() { const r = findReq(_selectedId); if (r) spOpenPrint(spPrintPage(spBuildDocHTML(spDocFromRow(r)))); }

// =====================================================
// ✅ บันทึกผลพิจารณา
// =====================================================
const DECISION = {
  approved: { word: "อนุมัติ", request_status: "pending", status: "executive_review", ask: "อนุมัติและส่งต่อให้ผู้บริหารพิจารณา?" },
  rejected: { word: "ไม่อนุมัติ", request_status: "rejected", status: "manager_rejected", ask: "ไม่อนุมัติคำขอนี้? (ผู้ขอจะเห็นผลและความเห็นของคุณ)" },
  request_more_info: { word: "ขอข้อมูลเพิ่ม", request_status: "request_more_info", status: "manager_more_info", ask: "ส่งกลับให้ผู้ขอเพิ่มข้อมูล?" },
};
async function decide(decision) {
  if (_deciding) return;
  const r = findReq(_selectedId), d = DECISION[decision];
  if (!r || !d) return;
  if (bucketOf(r) !== "waiting") { alert("คำขอนี้ถูกพิจารณาไปแล้ว"); return; }
  if (r.request_by === me.id) { alert("ไม่สามารถพิจารณาคำขอของตัวเองได้"); return; }
  const comment = document.getElementById("mgrComment").value.trim();
  if (decision !== "approved" && comment.length < 5) { alert("กรุณาเขียนความเห็น (อย่างน้อย 5 ตัวอักษร) เพื่อให้ผู้ขอรู้ว่าต้องแก้อะไร"); document.getElementById("mgrComment").focus(); return; }
  const signature = mgrSig.get();
  if (decision !== "request_more_info" && !signature) { alert("กรุณาเซ็นชื่อก่อนบันทึกผล"); return; }
  const t = totalsOf(itemsOf(r));
  if (!confirm(`${r.shop_name} · ${t.count} รายการ · ส่วนต่าง ${fmtMoney(t.diff)} บาท (${fmtPct(t.pct)})\n\n${d.ask}`)) return;

  _deciding = true;
  const btns = [...document.querySelectorAll(".spm-actions button")];
  btns.forEach((b) => { b.disabled = true; });
  try {
    const now = new Date().toISOString();
    const manager = { decision, comment, signature: signature || null, by: me.id, name: me.name, at: now };
    const update = {
      request_status: d.request_status,
      status: d.status,
      payload: { ...(r.payload || {}), manager },
      request_detail: `${r.request_detail || ""}\n\nความเห็น Manager (${me.name}): ${d.word}${comment ? " — " + comment : ""}`.trim(),
      updated_at: now,
    };
    // อัปเดตเฉพาะเมื่อยังอยู่ขั้น Manager (กัน Manager 2 คนกดพร้อมกัน)
    const { data, error } = await supabaseClient.from("approval_requests").update(update)
      .eq("id", r.id).eq("request_status", "waiting_manager").select("id");
    if (error) throw error;
    if (Array.isArray(data) && !data.length) throw new Error("คำขอนี้ถูกพิจารณาไปแล้ว หรือไม่มีสิทธิ์แก้ไข — กรุณารีเฟรช");
    document.getElementById("mgrComment").value = ""; mgrSig.clear();
    showNotification(decision === "approved" ? "อนุมัติแล้ว — ส่งต่อผู้บริหารเรียบร้อย" : `บันทึกผล “${d.word}” แล้ว`, "success");
    await loadQueue();
  } catch (e) {
    alert("บันทึกไม่สำเร็จ: " + e.message);
  } finally {
    _deciding = false;
    btns.forEach((b) => { b.disabled = false; });
  }
}
window.addEventListener("beforeunload", (e) => { if (hasUnsavedDecision()) { e.preventDefault(); e.returnValue = ""; } });
