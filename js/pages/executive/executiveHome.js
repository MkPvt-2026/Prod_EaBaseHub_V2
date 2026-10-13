// ============================================================
// executiveHome.js v2.0 — สรุปการเข้าร้านค้า (ผู้บริหาร)
// ------------------------------------------------------------
// แยกจากหน้ารายงานของ Marketing/Manager (reportTracker) — เน้น "ติดตาม + สรุป"
//   ช่วงเวลา (สัปดาห์/เดือน/ไตรมาส/กำหนดเอง) เทียบช่วงก่อนหน้าความยาวเท่ากัน
//   ตัวเลขหลัก · แนวโน้ม · ต้องติดตาม · ตารางเซลล์ · จังหวัด · สินค้าที่นำเสนอ
//   กดชื่อเซลล์ → รายงานของคนนั้น (อ่านอย่างเดียว) + ส่งความคิดเห็นถึงเซลล์
//     ความคิดเห็นเก็บใน report_comments (ตารางเดียวกับ Manager) → เซลล์เห็นในหน้ารายงานของตัวเอง
// "การเข้าร้าน 1 ครั้ง" = เซลล์ + ร้าน + วัน (รายงาน 1 ใบมีหลายแถวตามสินค้า)
// ============================================================

const DAY = 86400000;
const WATCH_NO_REPORT_DAYS = 3;   // เซลล์ไม่ส่งรายงานเกินกี่วัน → ต้องติดตาม
const WATCH_SHOP_DAYS = 60;       // ร้านในความดูแลไม่ได้เยี่ยมเกินกี่วัน → ต้องติดตาม

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const fmtN = (n) => Number(n || 0).toLocaleString("th-TH");
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addD = (d, n) => new Date(d.getTime() + n * DAY);
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const thD = (d) => `${d.getDate()} ${TH_MON[d.getMonth()]}`;
const thDY = (d) => `${d.getDate()} ${TH_MON[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}`;
const fromYmd = (s) => new Date(s + "T00:00:00");

const S = {
  period: "week",
  range: null, prev: null,
  visits: [], prevVisits: [], recent: [],   // ช่วงนี้ / ช่วงก่อน / 60 วันล่าสุด (ทุกช่วง)
  shops: new Map(), products: new Map(), people: new Map(), sales: [],
  comments: new Map(),                      // report_id → จำนวน
  rows: [], sort: { key: "visits", dir: -1 },
  me: null,
};

// ============================================================
// ช่วงเวลา
// ============================================================
function computeRange(period, customFrom, customTo) {
  const today = sod(new Date());
  const monday = addD(today, -((today.getDay() + 6) % 7));
  let from, to, prevFrom, prevTo, label;
  if (period === "lastweek") {
    from = addD(monday, -7); to = addD(monday, -1);
    prevFrom = addD(from, -7); prevTo = addD(to, -7); label = "สัปดาห์ก่อน";
  } else if (period === "month") {
    from = new Date(today.getFullYear(), today.getMonth(), 1); to = today;
    prevFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    prevTo = new Date(prevFrom.getFullYear(), prevFrom.getMonth(), Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate()));
    label = "เดือนนี้";
  } else if (period === "lastmonth") {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 0);
    prevFrom = new Date(today.getFullYear(), today.getMonth() - 2, 1); prevTo = new Date(today.getFullYear(), today.getMonth() - 1, 0);
    label = "เดือนก่อน";
  } else if (period === "quarter") {
    const q = Math.floor(today.getMonth() / 3) * 3;
    from = new Date(today.getFullYear(), q, 1); to = today;
    prevFrom = new Date(today.getFullYear(), q - 3, 1);
    prevTo = addD(prevFrom, Math.round((to - from) / DAY));
    label = "ไตรมาสนี้";
  } else if (period === "custom" && customFrom && customTo) {
    from = sod(customFrom); to = sod(customTo);
    if (to < from) [from, to] = [to, from];
    const len = Math.round((to - from) / DAY) + 1;
    prevTo = addD(from, -1); prevFrom = addD(prevTo, -(len - 1)); label = "ช่วงที่เลือก";
  } else {
    from = monday; to = today; prevFrom = addD(monday, -7); prevTo = addD(today, -7); label = "สัปดาห์นี้";
  }
  return { from, to, prevFrom, prevTo, label, today };
}

// ============================================================
// เริ่มต้น
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  const hd = $("headerDateText");
  if (hd) hd.textContent = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  bindUi();
  markChip();
  for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
  if (typeof supabaseClient === "undefined") return;

  // ⚡ เริ่มโหลดข้อมูลทันที พร้อมกันทุกอย่าง (สิทธิ์เข้าหน้าตรวจโดยตัวตรวจสิทธิ์กลาง auth.js อยู่แล้ว
  //    ข้อมูลจริงกันด้วย RLS) — เดิมรอตรวจสิทธิ์ → โหลดผู้ใช้ → โหลดร้าน → โหลดรายงาน ทีละขั้น
  const master = loadMaster().catch((e) => console.error("master:", e));
  const reports = loadPeriodData(currentRange());
  loadMe();
  await master;
  await loadPeriod(reports);

  // ป้ายตัวเลขงานรออนุมัติบนเมนู (ไม่ต้องรอ)
  if (typeof loadExecApprovals === "function") loadExecApprovals().then((r) => setExecNavBadge(r.pending.length)).catch(() => {});
});

async function loadMe() {
  try {
    if (!window.currentUser?.id && typeof loadCurrentUser === "function") await loadCurrentUser();
  } catch (e) { /* ignore */ }
  S.me = window.currentUser || null;
  if ($("userName")) $("userName").textContent = S.me?.display_name || S.me?.username || S.me?.email || "ผู้บริหาร";
}

function bindUi() {
  document.querySelectorAll(".er-chip").forEach((b) => b.addEventListener("click", () => {
    if (S.period === b.dataset.period && S.period !== "custom") return;
    S.period = b.dataset.period;
    $("erCustom").hidden = S.period !== "custom";
    if (S.period === "custom") {
      if (!$("erFrom").value) { const r = computeRange("month"); $("erFrom").value = ymd(r.from); $("erTo").value = ymd(r.to); }
      markChip();
      return;
    }
    loadPeriod();
  }));
  $("erApply").addEventListener("click", () => { if ($("erFrom").value && $("erTo").value) loadPeriod(); });
  $("erSearch").addEventListener("input", renderTable);
  document.querySelectorAll(".er-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === "name" || k === "last" ? 1 : -1) };
    renderTable();
  }));
  $("erCsv").addEventListener("click", exportCsv);
  $("dClose").addEventListener("click", closeDrawer);
  $("drawerBg").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  $("salesBody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) openDrawer(tr.dataset.id); });
  $("watchList").addEventListener("click", (e) => { const a = e.target.closest("[data-sale]"); if (a) { e.preventDefault(); openDrawer(a.dataset.sale); } });
}
function markChip() { document.querySelectorAll(".er-chip").forEach((b) => b.classList.toggle("is-on", b.dataset.period === S.period)); }

// ============================================================
// โหลดข้อมูล
// ============================================================
// ⚡ ดึงข้อมูลเกิน 1000 แถวแบบ "ขนาน": หน้าแรกพร้อมนับจำนวนทั้งหมด แล้วยิงหน้าที่เหลือพร้อมกันครั้งละ 6
//    (เดิมดึงทีละหน้าต่อกัน → ข้อมูล 8 หน้า = รอ 8 รอบ)
async function fetchAll(build, size = 1000, max = 60000) {
  const first = await build(true).range(0, size - 1);
  if (first.error) throw first.error;
  const out = first.data || [];
  const total = Math.min(first.count ?? out.length, max);
  if (out.length < size || total <= size) return out;
  const starts = [];
  for (let f = size; f < total; f += size) starts.push(f);
  const pages = new Array(starts.length);
  let next = 0;
  async function worker() {
    while (next < starts.length) {
      const i = next++;
      const { data, error } = await build(false).range(starts[i], starts[i] + size - 1);
      if (error) throw error;
      pages[i] = data || [];
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, starts.length) }, worker));
  return out.concat(...pages);
}

// ข้อมูลหลัก: ร้าน / สินค้า / เซลล์ — เก็บไว้ในแท็บนี้ 15 นาที (เปิดหน้าอีกครั้งไม่ต้องโหลดใหม่)
const MASTER_KEY = "ea-exec-report-master-v1";
const MASTER_TTL = 15 * 60 * 1000;
function applyMaster(m) {
  S.shops = new Map(m.shops.map((x) => [String(x.id), x]));
  S.products = new Map(m.products.map((p) => [String(p.id), p.name]));
  S.people = new Map(m.people.map((p) => [String(p.id), p]));
  const active = (p) => !p.status || String(p.status).toLowerCase() === "active";
  S.sales = m.people.filter(active);
}
async function loadMaster() {
  try {
    const c = JSON.parse(sessionStorage.getItem(MASTER_KEY) || "null");
    if (c && Date.now() - c.t < MASTER_TTL) { applyMaster(c); return; }
  } catch (e) { /* ignore */ }
  const shopsQ = (cols) => (cnt) => supabaseClient.from("shops").select(cols, cnt ? { count: "exact" } : undefined).order("id");
  const [shops, prods, people] = await Promise.all([
    fetchAll(shopsQ("id, shop_name, province, sale_id, status")).catch(() => fetchAll(shopsQ("id, shop_name, province"))),
    supabaseClient.from("products").select("id, name"),
    supabaseClient.from("profiles").select("id, display_name, username, email, area, role, status").in("role", ["sales", "sale", "Sales"]),
  ]);
  const m = { t: Date.now(), shops, products: prods.data || [], people: people.data || [] };
  applyMaster(m);
  try { sessionStorage.setItem(MASTER_KEY, JSON.stringify(m)); } catch (e) { /* เกินพื้นที่ → ไม่เก็บ */ }
}

function dayKey(r) {
  if (r.report_date) return String(r.report_date).slice(0, 10);
  const t = r.submitted_at || r.created_at;
  return t ? ymd(new Date(t)) : null;
}
// เข้าพบสำเร็จ = มีผลการเยี่ยมที่ไม่ใช่ "รอ…" (ฟอร์มปัจจุบัน: เข้าพบลูกค้า / รอเข้าพบรอบต่อไป)
const isMet = (st) => !!st && !/^รอ/.test(String(st).trim());
const isWait = (st) => !!st && /^รอ/.test(st);

function toVisits(rows) {
  const m = new Map();
  rows.forEach((r) => {
    const d = dayKey(r);
    if (!d) return;
    const k = `${r.sale_id}|${r.shop_id}|${d}`;
    if (!m.has(k)) m.set(k, { key: k, sale_id: String(r.sale_id), shop_id: r.shop_id == null ? null : String(r.shop_id), day: d, rows: [] });
    m.get(k).rows.push(r);
  });
  return [...m.values()].map((v) => {
    const st = v.rows.map((r) => r.status_visit).filter(Boolean);
    v.met = st.some(isMet);
    v.wait = !v.met && st.some(isWait);
    v.status = st[0] || "";
    v.ids = v.rows.map((r) => r.id);
    v.products = [...new Set(v.rows.map((r) => r.product_id).filter(Boolean).map(String))];
    v.interest = [...new Set(v.rows.map((r) => r.product_interest).filter(Boolean))].join(" · ");
    v.note = [...new Set(v.rows.map((r) => r.note).filter(Boolean))].join(" · ");
    v.time = v.rows.map((r) => r.submitted_at || r.created_at).filter(Boolean).sort().pop() || null;
    return v;
  });
}

function currentRange() {
  return S.period === "custom" ? computeRange("custom", fromYmd($("erFrom").value), fromYmd($("erTo").value)) : computeRange(S.period);
}

// ⚡ ดึงเฉพาะคอลัมน์ที่ใช้สรุป + เฉพาะช่วงที่ต้องใช้ (ช่วงก่อน → ช่วงนี้)
//    รายละเอียด (สินค้าที่สนใจ / หมายเหตุ) ดึงตอนเปิดดูเซลล์คนนั้น · ผลลัพธ์เก็บไว้ สลับช่วงกลับมาไม่ต้องโหลดใหม่
const REPORT_COLS = "id, sale_id, shop_id, report_date, submitted_at, created_at, status_visit, product_id";
const _rowsCache = new Map();
function fetchReports(from, to, cols = REPORT_COLS) {
  const key = `${cols}|${ymd(from)}|${ymd(to)}`;
  if (_rowsCache.has(key)) return _rowsCache.get(key);
  const a = ymd(from), b = ymd(to);
  const ta = from.toISOString(), tb = addD(to, 1).toISOString();
  const p = fetchAll((cnt) => supabaseClient.from("reports")
    .select(cols, cnt ? { count: "exact" } : undefined)
    .or(`and(report_date.gte.${a},report_date.lte.${b}),and(report_date.is.null,submitted_at.gte.${ta},submitted_at.lt.${tb})`)
    .order("id", { ascending: true }));
  _rowsCache.set(key, p);
  p.catch(() => _rowsCache.delete(key));
  return p;
}
function loadPeriodData(R) {
  return fetchReports(R.prevFrom, R.to).then((rows) => ({ R, rows }));
}

let _loadSeq = 0;
async function loadPeriod(pending) {
  markChip();
  const seq = ++_loadSeq;
  const req = pending || loadPeriodData(currentRange());
  const R0 = currentRange();
  $("erRange").innerHTML = `${esc(R0.label)} <b>${thDY(R0.from)} – ${thDY(R0.to)}</b> <span>เทียบ ${thD(R0.prevFrom)} – ${thDY(R0.prevTo)}</span>`;
  document.querySelector(".er").classList.add("is-loading");
  try {
    const { R, rows } = await req;
    if (seq !== _loadSeq) return; // ผู้ใช้เปลี่ยนช่วงไปแล้ว
    S.range = R;
    const all = toVisits(rows);
    const inR = (v, a, b) => v.day >= ymd(a) && v.day <= ymd(b);
    S.visits = all.filter((v) => inR(v, R.from, R.to));
    S.prevVisits = all.filter((v) => inR(v, R.prevFrom, R.prevTo));
    S.comments = new Map();
    renderAll();
    // ไม่ต้องรอ: จำนวนความคิดเห็น + ข้อมูล 60 วันสำหรับ "ต้องติดตาม"
    loadCommentCounts(S.visits.flatMap((v) => v.ids)).then(() => { if (seq === _loadSeq) refreshRows(); });
    loadRecent().then(() => { if (seq === _loadSeq) { refreshRows(); renderWatch(); } });
  } catch (e) {
    console.error("reports:", e);
    $("salesBody").innerHTML = `<tr><td colspan="9" class="ed-state is-error">โหลดรายงานไม่สำเร็จ: ${esc(e.message || "")} <button type="button" class="er-btn is-ghost" onclick="loadPeriod()">ลองใหม่</button></td></tr>`;
    $("trendChart").innerHTML = `<div class="ed-state is-error">โหลดรายงานไม่สำเร็จ</div>`;
  } finally {
    if (seq === _loadSeq) document.querySelector(".er").classList.remove("is-loading");
  }
}

// ข้อมูล 60 วันล่าสุด (เฉพาะ เซลล์/ร้าน/วัน) — ใช้กับ "ต้องติดตาม" และ "ส่งล่าสุด" · โหลดครั้งเดียว
let _recentP = null;
function loadRecent() {
  if (_recentP) return _recentP;
  const today = sod(new Date());
  _recentP = fetchReports(addD(today, -WATCH_SHOP_DAYS), today, "id, sale_id, shop_id, report_date, submitted_at, created_at")
    .then((rows) => { S.recent = toVisits(rows); S.recentReady = true; })
    .catch((e) => { console.warn("recent:", e); _recentP = null; });
  return _recentP;
}

function refreshRows() {
  const days = new Map();
  S.visits.forEach((v) => { if (!days.has(v.sale_id)) days.set(v.sale_id, new Set()); days.get(v.sale_id).add(v.day); });
  buildRows(days);
  renderTable();
}

// จำนวนความคิดเห็น — ยิงพร้อมกันเป็นชุด ๆ (ชุดละ 150 รายงาน)
async function loadCommentCounts(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const res = await Promise.all(chunks.map((c) => supabaseClient.from("report_comments").select("report_id").in("report_id", c)));
  const m = new Map();
  for (const { data, error } of res) {
    if (error) { console.warn("comments:", error.message); return; }
    (data || []).forEach((c) => m.set(String(c.report_id), (m.get(String(c.report_id)) || 0) + 1));
  }
  S.comments = m;
}
const visitComments = (v) => v.ids.reduce((s, id) => s + (S.comments.get(String(id)) || 0), 0);

// ============================================================
// คำนวณ + แสดงผล
// ============================================================
function deltaHTML(cur, prev, unit = "") {
  if (!prev) return cur ? `<span class="ed-delta is-up">ใหม่</span> ช่วงก่อนไม่มีข้อมูล` : "ช่วงก่อนไม่มีข้อมูล";
  const pct = Math.round(((cur - prev) / prev) * 100);
  const cls = pct > 0 ? "is-up" : pct < 0 ? "is-down" : "";
  return `<span class="ed-delta ${cls}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} ${Math.abs(pct)}%</span> ช่วงก่อน ${fmtN(prev)}${unit}`;
}

function assignedShops(saleId) {
  const out = [];
  S.shops.forEach((s) => {
    if (s.sale_id == null || (s.status && String(s.status).toLowerCase() !== "active")) return;
    if (saleId ? String(s.sale_id) === saleId : S.sales.some((p) => String(p.id) === String(s.sale_id))) out.push(String(s.id));
  });
  return out;
}

function renderAll() {
  const V = S.visits, P = S.prevVisits;
  const shopsOf = (list) => new Set(list.map((v) => v.shop_id).filter(Boolean));
  const curShops = shopsOf(V), prevShops = shopsOf(P);

  $("kVisits").textContent = fmtN(V.length);
  $("kVisitsSub").innerHTML = deltaHTML(V.length, P.length);
  $("kShops").textContent = fmtN(curShops.size);
  $("kShopsSub").innerHTML = deltaHTML(curShops.size, prevShops.size, " ร้าน");

  const assigned = assignedShops(null);
  if (assigned.length) {
    const covered = assigned.filter((id) => curShops.has(id)).length;
    $("kCover").innerHTML = `${Math.round((covered / assigned.length) * 100)}<small>%</small>`;
    $("kCoverSub").textContent = `${fmtN(covered)} จาก ${fmtN(assigned.length)} ร้าน`;
  } else {
    $("kCover").textContent = "—";
    $("kCoverSub").textContent = "ยังไม่ได้กำหนดเซลล์ดูแลร้าน";
  }

  const met = V.filter((v) => v.met).length, wait = V.filter((v) => v.wait).length;
  $("kMet").innerHTML = V.length ? `${Math.round((met / V.length) * 100)}<small>%</small>` : "—";
  $("kMetSub").textContent = V.length ? `เข้าพบ ${fmtN(met)} · รอรอบต่อไป ${fmtN(wait)}` : "ไม่มีการเข้าร้าน";

  const daysBy = (list) => { const m = new Map(); list.forEach((v) => { if (!m.has(v.sale_id)) m.set(v.sale_id, new Set()); m.get(v.sale_id).add(v.day); }); return m; };
  const dc = daysBy(V), dp = daysBy(P);
  const n = Math.max(S.sales.length, dc.size) || 1;
  const avg = [...dc.values()].reduce((s, x) => s + x.size, 0) / n;
  const avgP = [...dp.values()].reduce((s, x) => s + x.size, 0) / (Math.max(S.sales.length, dp.size) || 1);
  $("kDays").textContent = avg.toLocaleString("th-TH", { maximumFractionDigits: 1 });
  $("kDaysSub").textContent = `จาก ${fmtN(n)} คน · ช่วงก่อน ${avgP.toLocaleString("th-TH", { maximumFractionDigits: 1 })} วัน`;

  renderTrend();
  buildRows(dc);
  renderTable();
  if (S.recentReady) renderWatch(); else $("watchList").innerHTML = `<li class="ed-state">กำลังตรวจ...</li>`;
  renderProvinces();
  renderProducts();
}

function renderTrend() {
  const R = S.range;
  const days = Math.round((R.to - R.from) / DAY) + 1;
  const byDay = new Map();
  S.visits.forEach((v) => byDay.set(v.day, (byDay.get(v.day) || 0) + 1));
  let bars = [];
  if (days <= 31) {
    for (let i = 0; i < days; i++) {
      const d = addD(R.from, i);
      bars.push({ n: byDay.get(ymd(d)) || 0, top: TH_DOW[d.getDay()], bot: d.getDate(), title: thD(d), today: ymd(d) === ymd(R.today), weekend: d.getDay() === 0 || d.getDay() === 6 });
    }
    $("trendHint").textContent = "รายวัน";
  } else {
    for (let s = new Date(R.from); s <= R.to; s = addD(s, 7)) {
      const e = new Date(Math.min(addD(s, 6).getTime(), R.to.getTime()));
      let n = 0;
      for (let d = new Date(s); d <= e; d = addD(d, 1)) n += byDay.get(ymd(d)) || 0;
      bars.push({ n, top: "สัปดาห์", bot: thD(s), title: `${thD(s)} – ${thD(e)}`, today: R.today >= s && R.today <= e });
    }
    $("trendHint").textContent = "รายสัปดาห์";
  }
  const max = Math.max(1, ...bars.map((b) => b.n));
  $("trendChart").innerHTML = `<div class="ed-bars" style="grid-template-columns:repeat(${bars.length},minmax(0,1fr))">${bars.map((b) => `
    <div class="ed-bar is-week ${b.today ? "is-today" : ""} ${b.weekend ? "is-weekend" : ""}" title="${esc(b.title)} · ${b.n} ครั้ง">
      <span class="ed-bar-val">${b.n || ""}</span>
      <span class="ed-bar-col"><i style="height:${b.n ? Math.max(Math.round((b.n / max) * 100), 4) : 0}%"></i></span>
      <span class="ed-bar-lbl">${esc(b.top)}<b>${esc(b.bot)}</b></span>
    </div>`).join("")}</div>`;
  const workdays = bars.length && days <= 31 ? bars.filter((b, i) => addD(R.from, i).getDay() !== 0 && addD(R.from, i) <= R.today).length || 1 : 0;
  $("trendFoot").innerHTML = `รวม <b>${fmtN(S.visits.length)}</b> ครั้ง${workdays ? ` · เฉลี่ย <b>${(S.visits.length / workdays).toLocaleString("th-TH", { maximumFractionDigits: 1 })}</b> ครั้ง/วันทำงาน` : ""} · ช่วงก่อน <b>${fmtN(S.prevVisits.length)}</b> ครั้ง`;
}

function buildRows(daysCur) {
  const R = S.range;
  const ids = new Set([...S.sales.map((p) => String(p.id)), ...S.visits.map((v) => v.sale_id)]);
  const lastAll = new Map();
  S.recent.concat(S.visits).forEach((v) => { if (!lastAll.has(v.sale_id) || v.day > lastAll.get(v.sale_id)) lastAll.set(v.sale_id, v.day); });
  S.rows = [...ids].filter((id) => id && id !== "null" && id !== "undefined").map((id) => {
    const p = S.people.get(id) || {};
    const mine = S.visits.filter((v) => v.sale_id === id);
    const prev = S.prevVisits.filter((v) => v.sale_id === id).length;
    const shops = new Set(mine.map((v) => v.shop_id).filter(Boolean));
    const asg = assignedShops(id);
    const met = mine.filter((v) => v.met).length;
    const last = lastAll.get(id) || null;
    return {
      id, name: p.display_name || p.username || p.email || "ไม่ทราบชื่อ", area: p.area || "",
      visits: mine.length, prev, delta: mine.length - prev, shops: shops.size,
      cover: asg.length ? Math.round((asg.filter((x) => shops.has(x)).length / asg.length) * 100) : null, assigned: asg.length,
      met: mine.length ? Math.round((met / mine.length) * 100) : null,
      days: daysCur.get(id)?.size || 0, last,
      idle: last ? Math.round((R.today - fromYmd(last)) / DAY) : null,
      comments: mine.reduce((s, v) => s + visitComments(v), 0),
    };
  });
}

function renderTable() {
  const q = $("erSearch").value.trim().toLowerCase();
  const { key, dir } = S.sort;
  const val = (r) => (key === "name" ? r.name : key === "last" ? r.last || "" : r[key] ?? -1);
  const rows = S.rows.filter((r) => !q || `${r.name} ${r.area}`.toLowerCase().includes(q))
    .sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "string" ? x.localeCompare(y, "th") : x - y) * dir || b.visits - a.visits; });
  document.querySelectorAll(".er-table th[data-sort]").forEach((th) => { th.classList.toggle("is-sorted", th.dataset.sort === key); th.dataset.dir = dir > 0 ? "asc" : "desc"; });
  if (!rows.length) { $("salesBody").innerHTML = `<tr><td colspan="9" class="ed-state">ไม่พบเซลล์</td></tr>`; return; }
  const max = Math.max(1, ...rows.map((r) => r.visits));
  $("salesBody").innerHTML = rows.map((r) => {
    const d = r.delta === 0 ? `<span class="er-dim">0</span>` : `<span class="ed-delta ${r.delta > 0 ? "is-up" : "is-down"}">${r.delta > 0 ? "▲" : "▼"} ${Math.abs(r.delta)}</span>`;
    const lastTxt = r.last ? `${thD(fromYmd(r.last))}${r.idle >= WATCH_NO_REPORT_DAYS ? ` <em class="er-late">${r.idle} วัน</em>` : ""}` : `<em class="er-late">ไม่มีใน ${WATCH_SHOP_DAYS} วัน</em>`;
    return `<tr data-id="${esc(r.id)}" class="${r.visits ? "" : "is-zero"}" tabindex="0">
      <td><span class="er-who"><span class="ed-av">${esc(r.name.trim().charAt(0))}</span><span><b>${esc(r.name)}</b><small>${esc(r.area || "—")}</small></span></span></td>
      <td class="num"><span class="er-vbar"><i style="width:${Math.round((r.visits / max) * 100)}%"></i></span><b>${fmtN(r.visits)}</b></td>
      <td class="num">${d}</td>
      <td class="num">${fmtN(r.shops)}</td>
      <td class="num">${r.cover == null ? `<span class="er-dim" title="ยังไม่ได้กำหนดร้านในความดูแล">—</span>` : `${r.cover}%<small class="er-dim"> /${r.assigned}</small>`}</td>
      <td class="num">${r.met == null ? `<span class="er-dim">—</span>` : `${r.met}%`}</td>
      <td class="num">${fmtN(r.days)}</td>
      <td>${lastTxt}</td>
      <td class="num">${r.comments ? `<span class="er-cmt"><span class="material-symbols-outlined">chat</span>${r.comments}</span>` : `<span class="er-dim">—</span>`}</td>
    </tr>`;
  }).join("");
}

function renderWatch() {
  const items = [];
  // 1) เซลล์ไม่ส่งรายงาน
  S.rows.filter((r) => r.idle == null || r.idle >= WATCH_NO_REPORT_DAYS).sort((a, b) => (b.idle ?? 999) - (a.idle ?? 999)).slice(0, 5).forEach((r) => {
    items.push(`<li><a href="#" data-sale="${esc(r.id)}" class="er-w is-bad"><span class="material-symbols-outlined">person_alert</span>
      <span><b>${esc(r.name)}</b><small>${r.idle == null ? `ไม่มีรายงานใน ${WATCH_SHOP_DAYS} วัน` : `ไม่ส่งรายงาน ${r.idle} วัน`}</small></span></a></li>`);
  });
  // 2) ยอดเข้าร้านลดลงมาก
  S.rows.filter((r) => r.prev >= 3 && r.visits <= r.prev * 0.6).slice(0, 3).forEach((r) => {
    items.push(`<li><a href="#" data-sale="${esc(r.id)}" class="er-w is-warn"><span class="material-symbols-outlined">trending_down</span>
      <span><b>${esc(r.name)}</b><small>เข้าร้านลดลง ${r.prev} → ${r.visits} ครั้ง</small></span></a></li>`);
  });
  // 3) ร้านในความดูแลที่ไม่ได้เยี่ยมนาน
  const lastShop = new Map();
  S.recent.forEach((v) => { if (v.shop_id && (!lastShop.has(v.shop_id) || v.day > lastShop.get(v.shop_id))) lastShop.set(v.shop_id, v.day); });
  const stale = assignedShops(null).filter((id) => !lastShop.has(id));
  if (stale.length) {
    const bySale = new Map();
    stale.forEach((id) => { const sid = String(S.shops.get(id)?.sale_id); bySale.set(sid, (bySale.get(sid) || 0) + 1); });
    const top = [...bySale.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([sid, c]) => `${esc((S.people.get(sid)?.display_name) || "—")} ${c}`).join(" · ");
    items.push(`<li><span class="er-w is-warn"><span class="material-symbols-outlined">store</span>
      <span><b>ร้านในความดูแล ${fmtN(stale.length)} ร้าน</b><small>ไม่ได้เยี่ยมเกิน ${WATCH_SHOP_DAYS} วัน · ${top}</small></span></span></li>`);
  }
  // 4) รอเข้าพบรอบต่อไป
  const wait = S.visits.filter((v) => v.wait).length;
  if (wait) items.push(`<li><span class="er-w"><span class="material-symbols-outlined">schedule</span>
      <span><b>รอเข้าพบรอบต่อไป ${fmtN(wait)} ร้าน</b><small>ในช่วงที่เลือก</small></span></span></li>`);

  $("watchList").innerHTML = items.length ? items.join("") : `<li class="ed-state is-ok"><span class="material-symbols-outlined">check_circle</span> ไม่มีเรื่องที่ต้องติดตาม</li>`;
}

function hbars(list, empty) {
  if (!list.length) return `<li class="ed-state">${empty}</li>`;
  const max = Math.max(1, ...list.map((x) => x.n));
  return list.map((x, i) => `<li><span class="er-rank">${i + 1}</span><span class="er-hb-name" title="${esc(x.name)}">${esc(x.name)}</span>
    <span class="er-hb-bar"><i style="width:${Math.round((x.n / max) * 100)}%"></i></span><b>${fmtN(x.n)}</b></li>`).join("");
}
function renderProvinces() {
  const m = new Map();
  S.visits.forEach((v) => { const p = S.shops.get(v.shop_id)?.province || v.rows[0]?.province || "ไม่ระบุ"; m.set(p, (m.get(p) || 0) + 1); });
  $("provList").innerHTML = hbars([...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 10), "ไม่มีข้อมูล");
}
function renderProducts() {
  const m = new Map();
  S.visits.forEach((v) => v.products.forEach((p) => m.set(p, (m.get(p) || 0) + 1)));
  $("prodList").innerHTML = hbars([...m.entries()].map(([id, n]) => ({ name: S.products.get(id) || `สินค้า #${id}`, n })).sort((a, b) => b.n - a.n).slice(0, 10), "ยังไม่มีการบันทึกสินค้า");
}

// ============================================================
// รายละเอียดเซลล์ + ความคิดเห็น
// ============================================================
let _drawerSale = null;
function openDrawer(saleId) {
  const r = S.rows.find((x) => x.id === saleId);
  if (!r) return;
  _drawerSale = saleId;
  $("dAv").textContent = r.name.trim().charAt(0);
  $("dName").textContent = r.name;
  $("dSub").textContent = `${r.area || "—"} · ${S.range.label} ${thD(S.range.from)} – ${thDY(S.range.to)}`;
  $("dStats").innerHTML = [
    ["เข้าร้าน", fmtN(r.visits)], ["ร้าน", fmtN(r.shops)], ["วันลงพื้นที่", fmtN(r.days)],
    ["เข้าพบสำเร็จ", r.met == null ? "—" : r.met + "%"], ["ครอบคลุม", r.cover == null ? "—" : r.cover + "%"],
  ].map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("");
  const mine = S.visits.filter((v) => v.sale_id === saleId).sort((a, b) => (b.day + (b.time || "")).localeCompare(a.day + (a.time || "")));
  $("dList").innerHTML = mine.length ? mine.map(visitCard).join("") : `<div class="ed-state">ไม่มีรายงานในช่วงนี้</div>`;
  loadDetails(mine).then((changed) => { if (changed && _drawerSale === saleId) $("dList").innerHTML = mine.map(visitCard).join(""); });
  $("drawerBg").hidden = false;
  $("drawer").hidden = false;
  document.body.style.overflow = "hidden";
}
// รายละเอียด (สินค้าที่ร้านสนใจ / หมายเหตุ) — ดึงเฉพาะรายงานของเซลล์ที่เปิดดู
async function loadDetails(visits) {
  const need = visits.filter((v) => !v.detailLoaded);
  if (!need.length) return false;
  const ids = need.flatMap((v) => v.ids);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  try {
    const res = await Promise.all(chunks.map((c) => supabaseClient.from("reports").select("id, product_interest, note").in("id", c)));
    const byId = new Map();
    for (const { data, error } of res) { if (error) throw error; (data || []).forEach((r) => byId.set(String(r.id), r)); }
    need.forEach((v) => {
      const d = v.ids.map((id) => byId.get(String(id))).filter(Boolean);
      v.interest = [...new Set(d.map((r) => r.product_interest).filter(Boolean))].join(" · ");
      v.note = [...new Set(d.map((r) => r.note).filter(Boolean))].join(" · ");
      v.detailLoaded = true;
    });
    return true;
  } catch (e) { console.warn("details:", e); return false; }
}

function closeDrawer() {
  if ($("drawer").hidden) return;
  $("drawer").hidden = true;
  $("drawerBg").hidden = true;
  document.body.style.overflow = "";
  _drawerSale = null;
}

function visitCard(v) {
  const shop = S.shops.get(v.shop_id) || {};
  const prods = v.products.map((p) => S.products.get(p) || `#${p}`);
  const n = visitComments(v);
  const st = v.met ? `<span class="er-pill is-ok">${esc(v.status || "เข้าพบ")}</span>` : v.wait ? `<span class="er-pill is-warn">${esc(v.status)}</span>` : v.status ? `<span class="er-pill">${esc(v.status)}</span>` : "";
  return `<article class="er-visit" data-key="${esc(v.key)}">
    <header><b>${esc(shop.shop_name || "ร้านไม่ระบุ")}</b>${st}</header>
    <small class="er-visit-meta"><span class="material-symbols-outlined">event</span>${thDY(fromYmd(v.day))}${shop.province ? ` · <span class="material-symbols-outlined">location_on</span>${esc(shop.province)}` : ""}</small>
    ${prods.length ? `<div class="er-tags">${prods.map((p) => `<span>${esc(p)}</span>`).join("")}</div>` : ""}
    ${v.interest ? `<p><em>ร้านสนใจ:</em> ${esc(v.interest)}</p>` : ""}
    ${v.note ? `<p><em>หมายเหตุ:</em> ${esc(v.note)}</p>` : ""}
    <button type="button" class="er-cmt-toggle" onclick="toggleComments(this)"><span class="material-symbols-outlined">chat</span>${n ? `ความคิดเห็น ${n}` : "แสดงความคิดเห็น"}</button>
    <div class="er-cmt-box" hidden></div>
  </article>`;
}

async function toggleComments(btn) {
  const card = btn.closest(".er-visit");
  const box = card.querySelector(".er-cmt-box");
  box.hidden = !box.hidden;
  if (box.hidden || box.dataset.loaded) return;
  const v = S.visits.find((x) => x.key === card.dataset.key);
  box.innerHTML = `<div class="ed-state">กำลังโหลด...</div>`;
  await renderComments(box, v);
  box.dataset.loaded = "1";
}

const ROLE_TXT = { executive: "ผู้บริหาร", manager: "Manager", admin: "Admin", sales: "เซลล์", sale: "เซลล์", user: "เซลล์", marketing: "การตลาด" };
async function renderComments(box, v) {
  let list = [];
  try {
    const { data, error } = await supabaseClient.from("report_comments")
      .select("id, report_id, comment, created_at, manager_id, profiles:manager_id(display_name, role)")
      .in("report_id", v.ids).order("created_at", { ascending: true });
    if (error) throw error;
    list = data || [];
  } catch (e) {
    box.innerHTML = `<div class="ed-state is-error">โหลดความคิดเห็นไม่สำเร็จ</div>`;
    return;
  }
  box.innerHTML = `
    <div class="er-cmts">${list.length ? list.map((c) => {
      const p = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
      const role = p?.role || "";
      const t = c.created_at ? new Date(c.created_at) : null;
      return `<div class="er-cmt-item r-${esc(String(role).toLowerCase())}">
        <div><b>${esc(p?.display_name || "ผู้ใช้")}</b><span class="er-role">${esc(ROLE_TXT[role] || role || "-")}</span><time>${t ? `${thD(t)} ${pad(t.getHours())}:${pad(t.getMinutes())}` : ""}</time></div>
        <p>${esc(c.comment)}</p></div>`;
    }).join("") : `<div class="er-dim er-cmt-empty">ยังไม่มีความคิดเห็น</div>`}</div>
    <div class="er-cmt-form">
      <textarea rows="2" maxlength="1000" placeholder="พิมพ์ความคิดเห็นถึง ${esc(S.people.get(v.sale_id)?.display_name || "เซลล์")}..."></textarea>
      <button type="button" class="er-btn" onclick="sendComment(this)"><span class="material-symbols-outlined">send</span>ส่ง</button>
    </div>`;
}

async function sendComment(btn) {
  const card = btn.closest(".er-visit");
  const box = card.querySelector(".er-cmt-box");
  const ta = box.querySelector("textarea");
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  const v = S.visits.find((x) => x.key === card.dataset.key);
  const me = S.me?.id || (await supabaseClient.auth.getSession()).data?.session?.user?.id;
  if (!me) { toast("กรุณาเข้าสู่ระบบใหม่", true); return; }
  btn.disabled = true;
  try {
    const { data, error } = await supabaseClient.from("report_comments")
      .insert({ report_id: v.ids[0], manager_id: me, comment: text, created_at: new Date().toISOString() })
      .select("id");
    if (error) throw error;
    if (!data || !data.length) throw new Error("ไม่มีสิทธิ์บันทึกความคิดเห็น");
    S.comments.set(String(v.ids[0]), (S.comments.get(String(v.ids[0])) || 0) + 1);
    await renderComments(box, v);
    const n = visitComments(v);
    card.querySelector(".er-cmt-toggle").innerHTML = `<span class="material-symbols-outlined">chat</span>ความคิดเห็น ${n}`;
    buildRows(new Map(S.rows.map((r) => [r.id, { size: r.days }])));
    renderTable();
    toast("ส่งความคิดเห็นถึงเซลล์แล้ว");
  } catch (e) {
    console.error("comment:", e);
    toast("ส่งไม่สำเร็จ: " + (e.message || ""), true);
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// ส่งออก / แจ้งเตือน
// ============================================================
function exportCsv() {
  const R = S.range;
  const head = ["เซลล์", "พื้นที่", "เข้าร้าน (ครั้ง)", "ช่วงก่อน", "เปลี่ยนแปลง", "ร้าน", "ร้านในความดูแล", "ครอบคลุม %", "เข้าพบสำเร็จ %", "วันลงพื้นที่", "ส่งล่าสุด", "ความคิดเห็น"];
  const lines = [[`สรุปการเข้าร้านค้า ${R.label} ${ymd(R.from)} ถึง ${ymd(R.to)}`], head].concat(
    [...S.rows].sort((a, b) => b.visits - a.visits).map((r) => [r.name, r.area, r.visits, r.prev, r.delta, r.shops, r.assigned, r.cover ?? "", r.met ?? "", r.days, r.last || "", r.comments]));
  const csv = "﻿" + lines.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `สรุปการเข้าร้านค้า_${ymd(R.from)}_${ymd(R.to)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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

async function logout() {
  try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
  location.href = "/pages/auth/login.html";
}
