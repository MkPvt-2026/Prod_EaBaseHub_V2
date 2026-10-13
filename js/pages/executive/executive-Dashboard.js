// ============================================================
// executive-Dashboard.js v2.0 — ภาพรวมผู้บริหาร
// ------------------------------------------------------------
// 1) ตัวเลขหลัก: รอคุณอนุมัติ · เข้าร้านค้าสัปดาห์นี้ (เทียบช่วงเดียวกันสัปดาห์ก่อน)
//    · เซลล์ที่ส่งรายงาน · ตัดสินแล้วเดือนนี้
// 2) งานรอคุณอนุมัติ — เฉพาะงานที่ถึงขั้นผู้บริหารแล้ว (กฎเดียวกับหน้า executive-Approval)
// 3) กราฟการเข้าร้านค้า 14 วัน · 4) ทีมขายสัปดาห์นี้ (ใครยังไม่ส่ง)
// 5) ประชาสัมพันธ์ (Announcements.js)
// "การเข้าร้าน 1 ครั้ง" = เซลล์ + ร้าน + วัน (รายงาน 1 ใบมีหลายแถวตามสินค้า)
// ============================================================

// กฎงานอนุมัติ/ประเภทงาน อยู่ใน executive-rules.js (ใช้ร่วมกับหน้าหลักผู้บริหาร)
const DAY_MS = 86400000;

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const fmtN = (n) => Number(n || 0).toLocaleString("th-TH");
const fmtMoney = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const thShort = (d) => `${d.getDate()} ${TH_MON[d.getMonth()]}`;

// ---------- ช่วงเวลา ----------
function ranges() {
  const now = new Date();
  const today = startOfDay(now);
  const dow = today.getDay();
  const weekStart = new Date(today.getTime() - ((dow + 6) % 7) * DAY_MS); // จันทร์
  const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);
  const chartStart = new Date(today.getTime() - 13 * DAY_MS);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const fetchFrom = new Date(Math.min(lastWeekStart.getTime(), chartStart.getTime()));
  return { now, today, weekStart, lastWeekStart, chartStart, monthStart, fetchFrom };
}

// ============================================================
// เริ่มต้น
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  setHeaderDate();
  for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
  if (typeof supabaseClient === "undefined") { showError("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }

  // ⚡ เริ่มโหลดข้อมูลทันที พร้อมกับโหลดผู้ใช้ (สิทธิ์เข้าหน้าตรวจโดย auth.js · โปรไฟล์ดึงครั้งเดียวต่อหน้า)
  const data = loadAll();
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") { try { await loadCurrentUser(); } catch (e) { /* ignore */ } }
  setUser(window.currentUser);
  if (typeof AnnouncementsModule !== "undefined") {
    AnnouncementsModule.init(window.currentUser).catch((e) => console.warn("announcements:", e));
  }
  await data;
  subscribeRealtime();
});

function setHeaderDate() {
  const el = $("headerDateText");
  if (el) el.textContent = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
}

function setUser(u) {
  const name = u?.display_name || u?.full_name || u?.username || u?.email || "ผู้บริหาร";
  if ($("userName")) $("userName").textContent = name;
  const h = new Date().getHours();
  const part = h < 12 ? "สวัสดีตอนเช้า" : h < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
  if ($("greetText")) $("greetText").textContent = `${part} คุณ${name} · สรุปงานรออนุมัติและความเคลื่อนไหวของทีมขาย`;
}

function showError(msg) {
  ["pendList", "teamList"].forEach((id) => { if ($(id)) $(id).innerHTML = `<li class="ed-state is-error">${esc(msg)}</li>`; });
  if ($("visitChart")) $("visitChart").innerHTML = `<div class="ed-state is-error">${esc(msg)}</div>`;
}

// ดึงทีละ 1000 แถว (Supabase จำกัดต่อครั้ง)
async function fetchPaged(build, size = 1000, max = 30000) {
  let out = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < size) break;
  }
  return out;
}

let _loading = false;
async function loadAll() {
  if (_loading) return;
  _loading = true;
  const R = ranges();
  try {
    const [appr, rep] = await Promise.allSettled([loadApprovals(R), loadReports(R)]);
    if (appr.status === "rejected") {
      console.error("approvals:", appr.reason);
      $("pendList").innerHTML = `<li class="ed-state is-error">โหลดงานอนุมัติไม่สำเร็จ: ${esc(appr.reason?.message || "")}</li>`;
    }
    if (rep.status === "rejected") {
      console.error("reports:", rep.reason);
      $("visitChart").innerHTML = `<div class="ed-state is-error">โหลดรายงานไม่สำเร็จ: ${esc(rep.reason?.message || "")}</div>`;
      $("teamList").innerHTML = `<li class="ed-state is-error">โหลดข้อมูลทีมขายไม่สำเร็จ</li>`;
    }
  } finally {
    _loading = false;
  }
}

// ============================================================
// งานอนุมัติ (กฎเดียวกับหน้า executive-Approval)
// ============================================================
function itemsTotal(row) {
  const items = row?.payload?.items;
  if (!Array.isArray(items) || !items.length) return 0;
  return items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.request_price || 0), 0);
}
function amountOf(row) {
  const v = Number(row?.request_amount || row?.amount || row?.total_amount || row?.credit_amount || row?.price_amount || 0);
  return v || itemsTotal(row);
}
async function loadApprovals(R) {
  const { pending, decided } = await loadExecApprovals(R.monthStart);
  renderPending(pending, R);
  renderDecided(decided);
}

function renderPending(list, R) {
  const n = list.length;
  $("kpiPendingNum").textContent = fmtN(n);
  $("kpiPending").classList.toggle("is-alert", n > 0);
  const oldest = n ? Math.floor((R.now - execArrivedAt(list[0])) / DAY_MS) : 0;
  $("kpiPendingSub").textContent = n ? (oldest >= 1 ? `รอนานสุด ${oldest} วัน` : "เข้ามาวันนี้") : "ไม่มีงานค้าง";
  $("pendCount").hidden = !n;
  $("pendCount").textContent = n;
  setExecNavBadge(n);

  if (!n) {
    $("pendList").innerHTML = `<li class="ed-state is-ok"><span class="material-symbols-outlined">check_circle</span> ไม่มีงานรออนุมัติ</li>`;
    return;
  }
  const show = list.slice(0, 6);
  $("pendList").innerHTML = show.map((r) => {
    const t = EXEC_TYPE[execNormType(r.request_type)] || { label: "งานอื่น ๆ", icon: "approval", cls: "t-other" };
    const days = Math.floor((R.now - execArrivedAt(r)) / DAY_MS);
    const amt = amountOf(r);
    const who = r.sale_name || r.requester_name || r.request_by_name || r.created_by_name || "";
    // ไม่มีหัวข้อ → ใช้ชื่อร้านเป็นหัวข้อ (ประเภทงานแสดงในบรรทัดล่างอยู่แล้ว)
    const title = r.request_title || r.shop_name || t.label;
    const sub = [r.request_title && r.shop_name, who && `ผู้ขอ ${who}`].filter(Boolean).join(" · ");
    const wait = days >= 3 ? `<span class="ed-wait is-late">รอ ${days} วัน</span>` : `<span class="ed-wait">${days >= 1 ? `รอ ${days} วัน` : "วันนี้"}</span>`;
    return `<li><a class="ed-pend-item" href="/pages/executive/executive-ApprovalDoc.html?id=${encodeURIComponent(r.id)}${r._legacy ? "&src=claim" : ""}">
      <span class="ed-type ${t.cls}" title="${esc(t.label)}"><span class="material-symbols-outlined">${t.icon}</span></span>
      <span class="ed-pend-txt"><b>${esc(title)}</b><small><em>${esc(t.label)}</em>${sub ? " · " + esc(sub) : ""}</small></span>
      ${amt ? `<span class="ed-amt">฿${fmtMoney(amt)}</span>` : ""}
      ${wait}
    </a></li>`;
  }).join("") + (n > show.length ? `<li class="ed-more"><a href="/pages/executive/executive-Approval.html">ดูอีก ${n - show.length} รายการ</a></li>` : "");
}

function renderDecided(list) {
  const ok = list.filter((r) => r.request_status === "approved").length;
  const no = list.length - ok;
  $("kpiDoneNum").textContent = fmtN(list.length);
  $("kpiDoneSub").textContent = list.length ? `อนุมัติ ${ok} · ไม่อนุมัติ ${no}` : "ยังไม่มีในเดือนนี้";
}

// ============================================================
// รายงานเข้าร้านค้า
// ============================================================
function dayKeyOf(r) {
  if (r.report_date) return String(r.report_date).slice(0, 10);
  const t = r.submitted_at || r.created_at;
  return t ? ymd(new Date(t)) : null;
}

async function loadReports(R) {
  const fromIso = R.fetchFrom.toISOString();
  const fromYmd = ymd(R.fetchFrom);
  const [rows, salesRes] = await Promise.all([
    fetchPaged(() => supabaseClient
      .from("reports")
      .select("id, sale_id, shop_id, report_date, submitted_at, created_at")
      .or(`submitted_at.gte.${fromIso},report_date.gte.${fromYmd}`)
      .order("id", { ascending: true })),
    supabaseClient.from("profiles").select("id, display_name, username, email, area, role, status").in("role", ["sales", "sale", "Sales"]),
  ]);
  if (salesRes.error) throw salesRes.error;

  // การเข้าร้าน = เซลล์ + ร้าน + วัน
  const visits = new Map();
  rows.forEach((r) => {
    const d = dayKeyOf(r);
    if (!d || d < fromYmd) return;
    const k = `${r.sale_id}|${r.shop_id}|${d}`;
    if (!visits.has(k)) visits.set(k, { sale_id: r.sale_id, shop_id: r.shop_id, day: d });
  });
  const V = [...visits.values()];

  const isActive = (p) => !p.status || String(p.status).toLowerCase() === "active";
  const sales = (salesRes.data || []).filter(isActive);
  const people = new Map((salesRes.data || []).map((p) => [String(p.id), p]));

  // ชื่อคนที่ส่งรายงานแต่ไม่ใช่ role sales (เช่น Manager ลงพื้นที่เอง)
  const missing = [...new Set(V.map((v) => String(v.sale_id)))].filter((id) => id && id !== "null" && !people.has(id));
  if (missing.length) {
    const { data } = await supabaseClient.from("profiles").select("id, display_name, username, email, area, role, status").in("id", missing);
    (data || []).forEach((p) => people.set(String(p.id), p));
  }

  renderVisits(V, R);
  renderTeam(V, sales, people, R);
}

function renderVisits(V, R) {
  const todayY = ymd(R.today);
  const weekY = ymd(R.weekStart);
  // สัปดาห์ก่อน "ช่วงเวลาเดียวกัน" (จันทร์ → วันเดียวกันของสัปดาห์) เพื่อเทียบอย่างยุติธรรม
  const lastFrom = ymd(R.lastWeekStart);
  const lastTo = ymd(new Date(R.today.getTime() - 7 * DAY_MS));
  const thisWeek = V.filter((v) => v.day >= weekY && v.day <= todayY).length;
  const lastSame = V.filter((v) => v.day >= lastFrom && v.day <= lastTo).length;

  $("kpiVisitNum").textContent = fmtN(thisWeek);
  if (lastSame) {
    const pct = Math.round(((thisWeek - lastSame) / lastSame) * 100);
    const cls = pct > 0 ? "is-up" : pct < 0 ? "is-down" : "";
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
    $("kpiVisitSub").innerHTML = `<span class="ed-delta ${cls}">${arrow} ${Math.abs(pct)}%</span> เทียบช่วงเดียวกันสัปดาห์ก่อน (${fmtN(lastSame)})`;
  } else {
    $("kpiVisitSub").textContent = "สัปดาห์ก่อนช่วงเดียวกันไม่มีรายงาน";
  }

  // กราฟ 14 วัน
  const byDay = new Map();
  V.forEach((v) => byDay.set(v.day, (byDay.get(v.day) || 0) + 1));
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(R.chartStart.getTime() + i * DAY_MS);
    days.push({ d, key: ymd(d), n: byDay.get(ymd(d)) || 0 });
  }
  const max = Math.max(1, ...days.map((x) => x.n));
  $("visitChart").innerHTML = `<div class="ed-bars">${days.map((x) => {
    const h = Math.round((x.n / max) * 100);
    const cls = [x.key === todayY && "is-today", (x.d.getDay() === 0 || x.d.getDay() === 6) && "is-weekend", x.key >= weekY && "is-week"].filter(Boolean).join(" ");
    return `<div class="ed-bar ${cls}" title="${thShort(x.d)} · ${x.n} ครั้ง">
      <span class="ed-bar-val">${x.n || ""}</span>
      <span class="ed-bar-col"><i style="height:${x.n ? Math.max(h, 4) : 0}%"></i></span>
      <span class="ed-bar-lbl">${TH_DOW[x.d.getDay()]}<b>${x.d.getDate()}</b></span>
    </div>`;
  }).join("")}</div>`;
  const total = days.reduce((s, x) => s + x.n, 0);
  const workdays = days.filter((x) => x.d.getDay() !== 0 && x.d <= R.today).length || 1;
  $("visitFoot").innerHTML = `รวม 14 วัน <b>${fmtN(total)}</b> ครั้ง · เฉลี่ย <b>${(total / workdays).toLocaleString("th-TH", { maximumFractionDigits: 1 })}</b> ครั้ง/วันทำงาน <span class="ed-legend"><i class="is-week"></i>สัปดาห์นี้</span>`;
}

function renderTeam(V, sales, people, R) {
  const todayY = ymd(R.today);
  const weekY = ymd(R.weekStart);
  const week = V.filter((v) => v.day >= weekY && v.day <= todayY);
  const count = new Map();
  const shopsBy = new Map();
  week.forEach((v) => {
    const id = String(v.sale_id);
    count.set(id, (count.get(id) || 0) + 1);
    if (!shopsBy.has(id)) shopsBy.set(id, new Set());
    shopsBy.get(id).add(v.shop_id);
  });
  const lastDay = new Map();
  V.forEach((v) => { const id = String(v.sale_id); if (!lastDay.has(id) || v.day > lastDay.get(id)) lastDay.set(id, v.day); });

  const ids = new Set([...sales.map((s) => String(s.id)), ...count.keys()]);
  const list = [...ids].filter((id) => id && id !== "null").map((id) => {
    const p = people.get(id) || {};
    return { id, name: p.display_name || p.username || p.email || "ไม่ทราบชื่อ", area: p.area || "", n: count.get(id) || 0, shops: shopsBy.get(id)?.size || 0, last: lastDay.get(id) || null };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "th"));

  const sent = list.filter((x) => x.n > 0).length;
  const notSent = list.length - sent;
  $("kpiSalesNum").innerHTML = `${fmtN(sent)}<small> / ${fmtN(list.length)} คน</small>`;
  $("kpiSalesSub").innerHTML = notSent ? `<span class="ed-warn-txt">ยังไม่ส่ง ${fmtN(notSent)} คน</span>` : "ส่งครบทุกคน";
  $("teamRange").textContent = `${thShort(R.weekStart)} – ${thShort(R.today)}`;

  if (!list.length) { $("teamList").innerHTML = `<li class="ed-state">ยังไม่มีข้อมูลเซลล์</li>`; return; }
  const max = Math.max(1, ...list.map((x) => x.n));
  $("teamList").innerHTML = list.map((x) => {
    const lastTxt = x.last ? `ล่าสุด ${thShort(new Date(x.last + "T00:00:00"))}` : "ไม่มีรายงานใน 14 วัน";
    if (!x.n) {
      return `<li class="is-zero"><span class="ed-av">${esc(x.name.trim().charAt(0))}</span>
        <span class="ed-team-txt"><b>${esc(x.name)}</b><small>${esc(x.area || "—")} · ${lastTxt}</small></span>
        <span class="ed-team-none">ยังไม่ส่ง</span></li>`;
    }
    return `<li><span class="ed-av">${esc(x.name.trim().charAt(0))}</span>
      <span class="ed-team-txt"><b>${esc(x.name)}</b><small>${esc(x.area || "—")} · ${fmtN(x.shops)} ร้าน</small></span>
      <span class="ed-team-bar"><i style="width:${Math.round((x.n / max) * 100)}%"></i></span>
      <span class="ed-team-n">${fmtN(x.n)}</span></li>`;
  }).join("");
}

// ============================================================
// Realtime — มีงานอนุมัติ / รายงานใหม่ → โหลดใหม่ (หน่วง 1.5 วิ กันโหลดถี่)
// ============================================================
let _rt = null;
function subscribeRealtime() {
  if (typeof supabaseClient?.channel !== "function") return;
  const reload = () => { clearTimeout(_rt); _rt = setTimeout(loadAll, 1500); };
  try {
    supabaseClient
      .channel("exec-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests" }, reload)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reports" }, reload)
      .subscribe();
  } catch (e) { console.warn("realtime:", e); }
}

// ============================================================
// Sidebar / ออกจากระบบ
// ============================================================
// ย่อ/ขยาย sidebar → js/components/sidebar-manager.js (ตัวเดียวกับหน้า Marketing)

async function logout() {
  try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
  location.href = "/pages/auth/login.html";
}
