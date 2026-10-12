// =====================================================
// shopUser.js — ร้านของฉัน (แท็บเล็ตแนวนอนเป็นหลัก)
//
// ซ้าย  : รายชื่อร้าน + ค้นหา + เรียง (ชื่อ / ไม่ได้เยี่ยมนานสุด) + กรองจังหวัด
//         แต่ละร้านบอก "เยี่ยมล่าสุดเมื่อไร" (สีเขียว/เหลือง/แดง)
// ขวา   : รายละเอียดร้านที่เลือก — ติดต่อ ที่อยู่ การขนส่ง หมายเหตุ
//         + การเยี่ยมล่าสุด 5 ครั้ง + ปุ่มลัด เขียนรายงาน / แจ้งเคลม / แก้ไขข้อมูลร้าน
// จอแคบ : แสดงรายชื่ออย่างเดียว แตะร้าน → รายละเอียดเต็มจอ (มีปุ่มย้อนกลับ)
// =====================================================

const SU = {
  user: null,
  shops: [],
  visits: {}, // shop_id → [{ date, status, note }] เรียงใหม่→เก่า
  selectedId: null,
  sort: "name",
  province: "",
  keyword: "",
};

async function waitForAppReady(maxMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === "undefined") {
    if (Date.now() - start > maxMs) throw new Error("Supabase ยังไม่โหลด");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function getUser() {
  if (typeof getCurrentUser === "function") {
    const user = await getCurrentUser();
    if (user) return user;
  }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = "/pages/auth/login.html";
    return null;
  }
  return user;
}

async function loadUserName(userId) {
  const nameEl = document.getElementById("userName");
  const avatarEl = document.getElementById("userAvatar");
  const { data } = await supabaseClient.from("profiles").select("display_name").eq("id", userId).single();
  const name = data?.display_name || SU.user?.email || "ไม่ทราบชื่อ";
  if (nameEl) nameEl.textContent = name;
  if (avatarEl) avatarEl.textContent = name.trim().charAt(0).toUpperCase();
}

// ---------- helpers ----------
function suEsc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function parseDay(s) {
  if (!s) return null;
  const d = new Date(String(s).length <= 10 ? s + "T00:00:00" : s);
  return isNaN(d) ? null : d;
}
function daysSince(d) {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return Math.round((today - x) / 86400000);
}
function visitLevel(days) {
  if (days === null) return "bad";
  if (days <= 7) return "ok";
  if (days <= 30) return "warn";
  return "bad";
}
function visitText(days) {
  if (days === null) return "ยังไม่เคยเยี่ยม";
  if (days <= 0) return "เยี่ยมวันนี้";
  if (days === 1) return "เมื่อวาน";
  if (days < 30) return `${days} วันก่อน`;
  if (days < 365) return `${Math.floor(days / 30)} เดือนก่อน`;
  return "เกิน 1 ปี";
}
function thDate(d) {
  return d ? d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "—";
}
// ตัวอักษรย่อของร้าน: ตัดคำนำหน้า (ร้าน/หจก./บ./บริษัท) และข้ามสระหน้า (เ แ โ ใ ไ)
function initialOf(name) {
  const n = String(name || "?").replace(/^(ร้าน|หจก\.?|บจก\.?|บ\.|บริษัท)\s*/, "");
  const ch = [...n].find((c) => !/[เแโใไ\s]/.test(c));
  return (ch || n.charAt(0) || "?").toUpperCase();
}
function lastVisit(shopId) {
  return SU.visits[shopId]?.[0]?.date || null;
}

// ---------- data ----------
async function loadShops() {
  const { data, error } = await supabaseClient
    .from("shops")
    .select("*")
    .eq("sale_id", SU.user.id)
    .order("shop_name");
  if (error) throw error;
  SU.shops = data || [];
}

// การเยี่ยมทั้งหมดของเซลล์ (ใช้หา "เยี่ยมล่าสุด" ของแต่ละร้าน) — ถ้าโหลดไม่ได้ หน้ายังใช้งานได้
async function loadVisits() {
  try {
    const { data, error } = await supabaseClient
      .from("reports")
      .select("shop_id, report_date, status_visit, note, submitted_at")
      .eq("sale_id", SU.user.id)
      .eq("status", "submitted")
      .order("report_date", { ascending: false });
    if (error) throw error;
    const map = {};
    const seen = new Set();
    (data || []).forEach((r) => {
      if (!r.shop_id) return;
      // หลายแถวต่อการเยี่ยม (แยกตามสินค้า) → รวมเป็น 1 ครั้งต่อร้านต่อวัน
      const key = `${r.shop_id}|${r.report_date}`;
      if (seen.has(key)) return;
      seen.add(key);
      (map[r.shop_id] ||= []).push({ date: parseDay(r.report_date || r.submitted_at), status: r.status_visit, note: r.note });
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (b.date || 0) - (a.date || 0)));
    SU.visits = map;
  } catch (e) {
    console.warn("loadVisits:", e);
    SU.visits = {};
  }
}

// ---------- list ----------
function fillProvinceFilter() {
  const sel = document.getElementById("provinceFilter");
  if (!sel) return;
  const provinces = [...new Set(SU.shops.map((s) => s.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  sel.innerHTML = `<option value="">ทุกจังหวัด (${SU.shops.length})</option>` +
    provinces.map((p) => `<option value="${suEsc(p)}">${suEsc(p)} (${SU.shops.filter((s) => s.province === p).length})</option>`).join("");
}

function filteredShops() {
  const kw = SU.keyword.trim().toLowerCase();
  let list = SU.shops.filter((s) => {
    if (SU.province && s.province !== SU.province) return false;
    if (!kw) return true;
    return `${s.shop_name} ${s.shop_code || ""} ${s.province || ""}`.toLowerCase().includes(kw);
  });
  if (SU.sort === "visit") {
    // ไม่เคยเยี่ยมขึ้นก่อน แล้วตามด้วยที่เยี่ยมนานที่สุด
    list = list.slice().sort((a, b) => {
      const da = lastVisit(a.id), db = lastVisit(b.id);
      if (!da && !db) return a.shop_name.localeCompare(b.shop_name, "th");
      if (!da) return -1;
      if (!db) return 1;
      return da - db;
    });
  } else {
    list = list.slice().sort((a, b) => (a.shop_name || "").localeCompare(b.shop_name || "", "th"));
  }
  return list;
}

function renderList() {
  const box = document.getElementById("shopList");
  const counter = document.getElementById("shopCount");
  if (!box) return;
  const list = filteredShops();
  if (counter) {
    counter.textContent = list.length === SU.shops.length ? `${SU.shops.length} ร้าน` : `${list.length} จาก ${SU.shops.length} ร้าน`;
  }
  if (!SU.shops.length) {
    box.innerHTML = `<div class="su-empty"><span class="material-symbols-outlined">store</span>ยังไม่มีร้านที่ดูแล<br><small>ติดต่อผู้ดูแลระบบเพื่อกำหนดร้านให้</small></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="su-empty"><span class="material-symbols-outlined">search_off</span>ไม่พบร้านที่ตรงกับคำค้น</div>`;
    return;
  }
  box.innerHTML = list.map((s) => {
    const days = daysSince(lastVisit(s.id));
    const lv = visitLevel(days);
    const sel = String(s.id) === String(SU.selectedId);
    return `
      <button type="button" class="su-item${sel ? " is-selected" : ""}" role="option" aria-selected="${sel}" data-id="${suEsc(s.id)}">
        <span class="su-avatar">${suEsc(initialOf(s.shop_name))}</span>
        <span class="su-item-body">
          <span class="su-item-name">${suEsc(s.shop_name)}</span>
          <span class="su-item-sub">${s.shop_code ? `<span>${suEsc(s.shop_code)}</span>` : ""}<span>${suEsc(s.province || "—")}</span></span>
        </span>
        <span class="su-visit lv-${lv}">${visitText(days)}</span>
      </button>`;
  }).join("");
}

// ---------- detail ----------
async function selectShop(id, { push = true } = {}) {
  SU.selectedId = id;
  document.querySelectorAll(".su-item").forEach((el) => {
    const on = el.dataset.id === String(id);
    el.classList.toggle("is-selected", on);
    el.setAttribute("aria-selected", on);
  });
  const shop = SU.shops.find((s) => String(s.id) === String(id));
  if (!shop) return;

  if (push) {
    const url = new URL(location.href);
    url.searchParams.set("id", id);
    history.replaceState(null, "", url);
  }
  document.getElementById("shopApp")?.classList.add("show-detail");

  renderDetail(shop, null, true);
  let detail = null;
  try {
    detail = typeof loadShopDetail === "function" ? await loadShopDetail(shop.id) : null;
  } catch (e) {
    console.warn("loadShopDetail:", e);
  }
  if (String(SU.selectedId) === String(shop.id)) renderDetail(shop, detail, false);
}

function closeDetail() {
  document.getElementById("shopApp")?.classList.remove("show-detail");
}

function infoRow(icon, label, valueHtml) {
  return `<div class="su-info-row"><span class="material-symbols-outlined">${icon}</span><span class="su-info-label">${label}</span><span class="su-info-value">${valueHtml}</span></div>`;
}

function renderDetail(shop, detail, loading) {
  const ph = document.getElementById("detailPlaceholder");
  const body = document.getElementById("detailBody");
  if (!body) return;
  if (ph) ph.hidden = true;
  body.hidden = false;

  const visits = SU.visits[shop.id] || [];
  const days = daysSince(visits[0]?.date || null);
  const lv = visitLevel(days);
  const now = new Date();
  const thisMonth = visits.filter((v) => v.date && v.date.getMonth() === now.getMonth() && v.date.getFullYear() === now.getFullYear()).length;

  const d = detail || {};
  const empty = `<span class="su-muted">ยังไม่ได้กรอก</span>`;
  const phone = d.phone ? `<a href="tel:${suEsc(String(d.phone).replace(/[^0-9+]/g, ""))}">${suEsc(d.phone)}</a>` : empty;
  const maps = d.maps_url ? `<a href="${suEsc(d.maps_url)}" target="_blank" rel="noopener">เปิดแผนที่</a>` : "";
  const shipping = (d.shipping || []).length ? d.shipping.map((x) => `<span class="su-chip">${suEsc(x)}</span>`).join("") : empty;
  const filled = [d.phone, d.contact_name, d.address, d.line_id].filter(Boolean).length;

  const editUrl = `/pages/forms/shopDetail.html?id=${encodeURIComponent(shop.id)}`;
  const reportUrl = `/pages/reports/report.html?shop=${encodeURIComponent(shop.id)}`;
  const claimUrl = `/pages/forms/formClaim.html?shop=${encodeURIComponent(shop.shop_name || "")}`;

  body.innerHTML = `
    <div class="su-detail-head">
      <button type="button" class="su-back" onclick="closeDetail()" aria-label="กลับไปที่รายชื่อร้าน">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <div class="su-detail-title">
        <h2>${suEsc(shop.shop_name)}</h2>
        <div class="su-detail-sub">
          ${shop.shop_code ? `<span class="su-code">${suEsc(shop.shop_code)}</span>` : ""}
          <span><span class="material-symbols-outlined">location_on</span>${suEsc(shop.province || "ไม่ระบุจังหวัด")}</span>
        </div>
      </div>
      <a class="su-btn-ghost" href="${editUrl}"><span class="material-symbols-outlined">edit</span>แก้ไขข้อมูลร้าน</a>
    </div>

    <div class="su-actions">
      <a class="su-action is-primary" href="${reportUrl}">
        <span class="material-symbols-outlined">edit_document</span>
        <span><b>เขียนรายงานเยี่ยมร้าน</b><small>เลือกร้านนี้ไว้ให้แล้ว</small></span>
      </a>
      <a class="su-action" href="${claimUrl}">
        <span class="material-symbols-outlined">report</span>
        <span><b>แจ้งเคลมสินค้า</b><small>ของร้านนี้</small></span>
      </a>
    </div>

    <div class="su-stats">
      <div class="su-stat"><span class="su-stat-label">เยี่ยมล่าสุด</span><b class="lv-text-${lv}">${visitText(days)}</b><small>${visits[0] ? thDate(visits[0].date) : "—"}</small></div>
      <div class="su-stat"><span class="su-stat-label">เยี่ยมเดือนนี้</span><b>${thisMonth}</b><small>ครั้ง</small></div>
      <div class="su-stat"><span class="su-stat-label">เยี่ยมทั้งหมด</span><b>${visits.length}</b><small>ครั้ง</small></div>
    </div>

    <div class="su-grid">
      <section class="su-card">
        <h3><span class="material-symbols-outlined">contact_phone</span>ข้อมูลติดต่อ
          ${loading ? `<span class="su-loading">กำลังโหลด...</span>` : filled < 2 ? `<a class="su-fill" href="${editUrl}">กรอกข้อมูลเพิ่ม</a>` : ""}</h3>
        ${infoRow("call", "โทร", phone)}
        ${infoRow("person", "ผู้ติดต่อ", d.contact_name ? suEsc(d.contact_name) : empty)}
        ${infoRow("chat", "LINE", d.line_id ? suEsc(d.line_id) : empty)}
        ${infoRow("home_pin", "ที่อยู่", d.address ? `${suEsc(d.address)} ${maps}` : (maps || empty))}
        ${infoRow("local_shipping", "ขนส่ง", `<span class="su-chips">${shipping}</span>`)}
        ${d.note ? infoRow("sticky_note_2", "หมายเหตุ", suEsc(d.note)) : ""}
      </section>

      <section class="su-card">
        <h3><span class="material-symbols-outlined">history</span>การเยี่ยมล่าสุด</h3>
        ${visits.length
          ? `<ul class="su-visits">${visits.slice(0, 5).map((v) => `
              <li>
                <span class="su-visit-date">${thDate(v.date)}</span>
                <span class="su-visit-body">
                  <b>${suEsc(v.status || "เข้าพบลูกค้า")}</b>
                  ${v.note ? `<small>${suEsc(v.note)}</small>` : ""}
                </span>
              </li>`).join("")}</ul>`
          : `<div class="su-empty is-small">ยังไม่มีรายงานการเยี่ยมร้านนี้</div>`}
      </section>
    </div>
  `;
  body.scrollTop = 0;
}

// ---------- events ----------
function initEvents() {
  document.getElementById("searchInput")?.addEventListener("input", (e) => {
    SU.keyword = e.target.value;
    renderList();
  });
  document.getElementById("provinceFilter")?.addEventListener("change", (e) => {
    SU.province = e.target.value;
    renderList();
  });
  document.querySelectorAll("#sortSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      SU.sort = btn.dataset.sort;
      document.querySelectorAll("#sortSeg button").forEach((b) => b.classList.toggle("active", b === btn));
      renderList();
    });
  });
  document.getElementById("shopList")?.addEventListener("click", (e) => {
    const item = e.target.closest(".su-item");
    if (item) selectShop(item.dataset.id);
  });
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
    window.location.href = "/pages/auth/login.html";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
}

// ---------- init ----------
async function init() {
  try {
    await waitForAppReady();
    SU.user = await getUser();
    if (!SU.user) return;
    initEvents();
    await Promise.all([loadUserName(SU.user.id), loadShops(), loadVisits()]);
    fillProvinceFilter();
    renderList();

    // เปิดร้านจากลิงก์ ?id= หรือเลือกร้านแรกให้อัตโนมัติบนจอกว้าง
    const want = new URLSearchParams(location.search).get("id");
    const first = filteredShops()[0];
    if (want && SU.shops.some((s) => String(s.id) === want)) selectShop(want, { push: false });
    else if (first && window.matchMedia("(min-width: 900px)").matches) {
      selectShop(first.id, { push: false });
      document.getElementById("shopApp")?.classList.remove("show-detail");
    }
  } catch (err) {
    console.error(err);
    const box = document.getElementById("shopList");
    if (box) box.innerHTML = `<div class="su-empty is-error">โหลดรายชื่อร้านไม่สำเร็จ<br><button type="button" onclick="location.reload()">ลองใหม่</button></div>`;
  }
}

init();
