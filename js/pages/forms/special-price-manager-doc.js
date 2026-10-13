// =====================================================
// special-price-manager-doc.js — เอกสารขออนุมัติราคาพิเศษ (Manager · ขั้นที่ 1)
// เปิดจากรายการ special-price-manager.html → ?id=<approval_requests.id>
// ซ้าย: เอกสาร A4 (แบบฟอร์มเดียวกับหน้าเซลล์/ผู้บริหาร) · ขวา: สรุปตัวเลข + ข้อควรตรวจ + ลำดับอนุมัติ + ความเห็น/ลงนาม
// กติกาเดียวกับหน้าเดิม:
//   อนุมัติ        → request_status "pending" · status "executive_review" (ส่งต่อผู้บริหาร)
//   ไม่อนุมัติ      → "rejected" · "manager_rejected"
//   ขอข้อมูลเพิ่ม   → "request_more_info" · "manager_more_info"
//   บันทึกเฉพาะเมื่อยัง "waiting_manager" (กัน 2 คนกดพร้อมกัน) · ห้ามพิจารณาคำขอของตัวเอง
//   Manager เห็น/พิจารณาเฉพาะทีมตัวเอง (profiles.manager_id) — ถ้ายังไม่ผูกทีม = ทั้งหมด · Admin ทั้งหมด
// ต้องโหลด special-price-common.js ก่อน
// =====================================================
"use strict";

const LIST_URL = "/pages/forms/special-price-manager.html";
const $ = (id) => document.getElementById(id);
const DEC = {
  approved: { word: "อนุมัติ & ส่งต่อผู้บริหาร", short: "อนุมัติ", request_status: "pending", status: "executive_review", icon: "send", cls: "is-ok" },
  rejected: { word: "ไม่อนุมัติ", short: "ไม่อนุมัติ", request_status: "rejected", status: "manager_rejected", icon: "cancel", cls: "is-bad" },
  request_more_info: { word: "ขอข้อมูลเพิ่ม", short: "ขอข้อมูลเพิ่ม", request_status: "request_more_info", status: "manager_more_info", icon: "help", cls: "is-warn" },
};

let me = { id: null, name: "", role: "" };
let mgrSig = null;
let R = null;              // คำขอที่เปิดอยู่
let _teamIds = null;       // null = ไม่จำกัด
let _queue = [];           // คำขอรออนุมัติ (ในขอบเขต) เรียงเก่า → ใหม่
let _saving = false;

document.addEventListener("DOMContentLoaded", async () => {
  for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
  if (typeof supabaseClient === "undefined") return;
  const id = new URLSearchParams(location.search).get("id");
  if (!id) { fatal("ไม่พบเลขที่คำขอ"); return; }

  mgrSig = createSignaturePad("adSigCanvas", "adSigWrap", "adSigHint");
  $("adSave").addEventListener("click", save);
  $("adPrev").addEventListener("click", () => go(-1));
  $("adNext").addEventListener("click", () => go(1));
  document.querySelectorAll("input[name='adDecision']").forEach((el) => el.addEventListener("change", onChoice));
  document.addEventListener("keydown", (e) => {
    if (/input|textarea/i.test(document.activeElement?.tagName || "")) return;
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  });

  // ⚡ โหลดพร้อมกัน: ผู้ใช้ + คำขอ
  const rowP = supabaseClient.from("approval_requests").select("*").eq("id", id).maybeSingle();
  // โปรไฟล์ที่ดึงครั้งเดียวต่อหน้า (ชื่อจริง ไม่ใช่อีเมล)
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") { try { await loadCurrentUser(); } catch (e) { /* ignore */ } }
  me = await spLoadMe();
  setText("mgrName", me.name || "-");
  setText("mgrRole", me.position || "-");
  await loadTeam();
  try {
    const { data, error } = await rowP;
    if (error) throw error;
    if (!data || data.request_type !== SP_TYPE) { fatal("ไม่พบคำขอราคาพิเศษนี้ หรือไม่มีสิทธิ์เปิดดู"); return; }
    R = data;
    render();
  } catch (e) {
    fatal("โหลดเอกสารไม่สำเร็จ: " + (e.message || ""));
  }
  loadQueue();
});

function fatal(msg) {
  $("adDoc").innerHTML = `<div class="ed-state is-error">${escHtml(msg)}</div>`;
  $("adPanel").hidden = true;
}

async function loadTeam() {
  if (me.role !== "manager") return;
  try {
    const { data } = await supabaseClient.from("profiles").select("id").eq("manager_id", me.id);
    const ids = (data || []).map((p) => p.id);
    if (ids.length) _teamIds = new Set(ids);
  } catch (e) { /* ไม่ผูกทีม = ทั้งหมด */ }
}
const inScope = (r) => !_teamIds || _teamIds.has(r.request_by) || r.request_by === me.id;

// คิวรออนุมัติสำหรับปุ่ม ‹ ›  (ดึงเฉพาะคอลัมน์ที่ใช้)
async function loadQueue() {
  try {
    const { data } = await supabaseClient.from("approval_requests").select("id, request_by, created_at")
      .eq("request_type", SP_TYPE).eq("request_status", "waiting_manager").order("created_at", { ascending: true }).limit(300);
    _queue = (data || []).filter((r) => inScope(r) && r.request_by !== me.id);
    renderNav();
  } catch (e) { /* ignore */ }
}
const docUrl = (id) => `/pages/forms/special-price-manager-doc.html?id=${encodeURIComponent(id)}`;
function renderNav() {
  if (!_queue.length || !R) return;
  const i = _queue.findIndex((q) => String(q.id) === String(R.id));
  $("adNav").hidden = false;
  $("adPos").textContent = i >= 0 ? `รออนุมัติ ${i + 1} / ${_queue.length}` : `รออนุมัติ ${_queue.length} รายการ`;
  $("adPrev").disabled = i <= 0;
  $("adNext").disabled = i >= 0 && i >= _queue.length - 1;
}
function go(step) {
  if (!_queue.length || !R) return;
  const i = _queue.findIndex((q) => String(q.id) === String(R.id));
  const j = i < 0 ? 0 : i + step;
  if (j < 0 || j >= _queue.length || j === i) return;
  if (hasDraft() && !confirm("ความเห็น/ลายเซ็นที่กรอกไว้จะหาย — ไปคำขออื่น?")) return;
  _skipUnload = true;
  location.href = docUrl(_queue[j].id);
}

// =====================================================
// แสดงผล
// =====================================================
function isWaiting(r) { return (r.request_status || "waiting_manager") === "waiting_manager" && !spManager(r); }

function render() {
  const r = R, st = spStatus(r), items = itemsOf(r), t = totalsOf(items), m = spManager(r);
  document.title = `EABaseHub | ${spDocNo(r)}`;
  setText("adTitle", `${r.shop_name || "-"}`);
  setText("adNo", `เลขที่ ${spDocNo(r)} · ผู้ขอ ${r.sale_name || "-"} · ส่งเมื่อ ${formatDateTimeTH(r.created_at)}`);
  const sp = $("adStatus"); sp.textContent = st.label; sp.className = `er-pill ${st.key === "waiting_manager" ? "is-warn" : st.cls}`;
  setText("kNormal", fmtMoney(t.normal)); setText("kRequest", fmtMoney(t.request)); setText("kDiff", fmtMoney(t.diff)); setText("kPct", fmtPct(t.pct));
  $("kPct").classList.toggle("is-high", t.pct > SP_HIGH_DISCOUNT_PCT);

  // ข้อควรตรวจ
  const flags = [];
  items.forEach((it, i) => { if (it.discount_pct > SP_HIGH_DISCOUNT_PCT) flags.push(`รายการ ${i + 1} (${it.name}) ส่วนลดสูง ${fmtPct(it.discount_pct)}`); });
  if (!r.shop_id) flags.push("ลูกค้าไม่ได้เลือกจากรายชื่อในระบบ (พิมพ์ชื่อเอง)");
  $("adFlags").hidden = !flags.length;
  $("adFlags").innerHTML = flags.length ? `<b><span class="material-symbols-outlined">warning</span>ข้อควรตรวจ</b><ul>${flags.map((f) => `<li>${escHtml(f)}</li>`).join("")}</ul>` : "";

  // ลำดับอนุมัติ
  const execKey = spReachedExec(r) ? st.key : "";
  const execState = { pending: "now", approved: "ok", rejected: "bad", request_more_info: "warn" }[execKey] || "idle";
  const mState = m ? (m.decision === "approved" ? "ok" : m.decision === "rejected" ? "bad" : "warn") : "now";
  const step = (state, role, sub, note) => `<li class="is-${state}"><i></i><b>${escHtml(role)}</b><span>${escHtml(sub || "—")}</span>${note ? `<em>“${escHtml(note)}”</em>` : ""}</li>`;
  $("adTimeline").innerHTML =
    step("ok", "ผู้ขออนุมัติ", `${r.sale_name || "-"} · ${formatDateTimeTH(r.created_at)}`) +
    step(mState, "Manager (ขั้นที่ 1)", m ? `${m.name || ""} · ${DEC[m.decision]?.short || m.decision} · ${formatDateTimeTH(m.at)}` : "รอพิจารณา", m?.comment) +
    step(execState, "ผู้บริหาร (ขั้นสุดท้าย)", execState === "now" ? "รอพิจารณา" : r.approved_at ? `${({ approved: "อนุมัติ", rejected: "ไม่อนุมัติ", request_more_info: "ขอข้อมูลเพิ่ม" })[st.key] || ""} · ${formatDateTimeTH(r.approved_at)}` : "", execState !== "now" && execState !== "idle" ? (r.approval_comment || r.exec_comment) : "");

  // เอกสาร
  $("adDoc").innerHTML = `<div class="ad-sp">${spBuildDocHTML(spDocFromRow(r))}</div>`;

  // แผงพิจารณา
  const own = r.request_by === me.id;
  const scope = inScope(r);
  const open = isWaiting(r) && !own && scope;
  $("adDecide").hidden = !open;
  $("adDone").hidden = open;
  if (open) {
    requestAnimationFrame(() => mgrSig.refit());
  } else {
    let html;
    if (m) html = `<h3><span class="material-symbols-outlined">${DEC[m.decision]?.icon || "verified"}</span> ${escHtml(DEC[m.decision]?.word || m.decision)}</h3>
      <dl class="ad-dl"><dt>ผู้พิจารณา</dt><dd>${escHtml(m.name || "-")}</dd><dt>วันที่</dt><dd>${escHtml(formatDateTimeTH(m.at))}</dd>${m.comment ? `<dt>ความเห็น</dt><dd>${escHtml(m.comment)}</dd>` : ""}</dl>`;
    else if (own) html = `<h3><span class="material-symbols-outlined">block</span> คำขอของคุณเอง</h3><p class="ad-muted">ต้องให้ Manager คนอื่นหรือ Admin เป็นผู้พิจารณา</p>`;
    else if (!scope) html = `<h3><span class="material-symbols-outlined">group_off</span> ไม่ใช่คำขอจากทีมของคุณ</h3><p class="ad-muted">เปิดดูได้ แต่พิจารณาได้เฉพาะ Manager ของผู้ขอ</p>`;
    else html = `<h3><span class="material-symbols-outlined">info</span> ไม่อยู่ในขั้น Manager แล้ว</h3><p class="ad-muted">${escHtml(st.label)}</p>`;
    $("adDone").innerHTML = html + nextBtn();
  }
  renderNav();
}

function nextBtn() {
  const nxt = _queue.find((q) => String(q.id) !== String(R?.id));
  return nxt ? `<a class="er-btn ad-save" href="${docUrl(nxt.id)}"><span class="material-symbols-outlined">arrow_forward</span>ไปคำขอรออนุมัติถัดไป</a>`
    : `<a class="er-btn is-ghost ad-save" href="${LIST_URL}">กลับรายการคำขอ</a>`;
}

function onChoice() {
  const v = document.querySelector("input[name='adDecision']:checked")?.value;
  $("adCommentLabel").innerHTML = v && v !== "approved" ? `ความเห็น / สิ่งที่ต้องแก้ <i>*</i>` : "ความเห็น";
  $("adSigReq").hidden = v === "request_more_info";
}

// =====================================================
// บันทึกผล
// =====================================================
function err(msg) { $("adErr").textContent = msg; $("adErr").hidden = !msg; }
const hasDraft = () => !!($("adComment")?.value.trim() || mgrSig?.get());
let _skipUnload = false;
window.addEventListener("beforeunload", (e) => { if (!_skipUnload && !_saving && hasDraft() && !$("adDecide").hidden) { e.preventDefault(); e.returnValue = ""; } });

async function save() {
  if (_saving || !R) return;
  err("");
  const decision = document.querySelector("input[name='adDecision']:checked")?.value;
  const d = DEC[decision];
  const comment = $("adComment").value.trim();
  const signature = mgrSig.get();
  if (!d) return err("กรุณาเลือกผลการพิจารณา");
  if (R.request_by === me.id) return err("ไม่สามารถพิจารณาคำขอของตัวเองได้");
  if (decision !== "approved" && comment.length < 5) { $("adComment").focus(); return err("กรุณาเขียนความเห็น (อย่างน้อย 5 ตัวอักษร) เพื่อให้ผู้ขอรู้ว่าต้องแก้อะไร"); }
  if (decision !== "request_more_info" && !signature) return err("กรุณาเซ็นชื่อก่อนบันทึกผล");
  const t = totalsOf(itemsOf(R));
  if (!confirm(`${R.shop_name} · ${t.count} รายการ · ส่วนต่าง ${fmtMoney(t.diff)} บาท (${fmtPct(t.pct)})\n\nยืนยัน "${d.word}" ?`)) return;

  _saving = true;
  $("adSave").disabled = true;
  try {
    const now = new Date().toISOString();
    const manager = { decision, comment, signature: signature || null, by: me.id, name: me.name, at: now };
    const update = {
      request_status: d.request_status,
      status: d.status,
      payload: { ...(R.payload || {}), manager },
      request_detail: `${R.request_detail || ""}\n\nความเห็น Manager (${me.name}): ${d.short}${comment ? " — " + comment : ""}`.trim(),
      updated_at: now,
    };
    const { data, error } = await supabaseClient.from("approval_requests").update(update)
      .eq("id", R.id).eq("request_status", "waiting_manager").select();
    if (error) throw error;
    if (!data || !data.length) throw new Error("คำขอนี้ถูกพิจารณาไปแล้ว หรือไม่มีสิทธิ์แก้ไข — กรุณารีเฟรช");
    Object.assign(R, data[0].payload ? data[0] : update);
    _queue = _queue.filter((q) => String(q.id) !== String(R.id));
    $("adComment").value = ""; mgrSig.clear();
    render();
    toast(decision === "approved" ? "อนุมัติแล้ว — ส่งต่อผู้บริหารเรียบร้อย" : `บันทึก "${d.short}" แล้ว`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    console.error("save:", e);
    err("บันทึกไม่สำเร็จ: " + (e.message || e));
  } finally {
    _saving = false;
    $("adSave").disabled = false;
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
