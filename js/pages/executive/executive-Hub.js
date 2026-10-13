// =====================================================
// executive-Hub.js — หน้าหลักผู้บริหาร (ปุ่มเมนูแบบ Form Hub)
//
// ✏️ เพิ่ม / ลบ / แก้ปุ่มเมนู → แก้ที่ EXEC_MENU ด้านล่างที่เดียว
//    url   : หน้าที่จะเปิด (หน้าอนุมัติรับ ?type= และ ?status= เพื่อกรองให้เลย)
//    badge : "all" หรือประเภทงาน (special_price / temp_credit_limit / claim / ...) → แสดงจำนวนงานรออนุมัติบนปุ่ม
//    soon  : true = ยังไม่เปิดใช้ (ป้าย "เร็ว ๆ นี้" และกดไม่ได้)
//    color : blue | green | orange | purple | pink | teal | slate
// ปุ่มที่ role เปิดไม่ได้จะถูกซ่อนเองตามสิทธิ์กลาง (roleConfig.js)
// =====================================================

const APPROVAL_URL = "/pages/executive/executive-Approval.html";

const EXEC_MENU = [
  {
    group: "อนุมัติงาน (ขั้นสุดท้าย)",
    icon: "approval_delegation",
    items: [
      { title: "งานรออนุมัติทั้งหมด", desc: "ทุกประเภทที่ผ่านขั้นก่อนหน้าแล้ว", icon: "pending_actions", color: "purple", url: `${APPROVAL_URL}?status=pending`, badge: "all" },
      { title: "ราคาพิเศษ", desc: "Manager อนุมัติแล้ว รอผู้บริหาร", icon: "sell", color: "orange", url: `${APPROVAL_URL}?type=special_price&status=pending`, badge: "special_price" },
      { title: "วงเงินชั่วคราว", desc: "ผ่านบัญชีและ Manager แล้ว", icon: "account_balance_wallet", color: "blue", url: `${APPROVAL_URL}?type=temp_credit_limit&status=pending`, badge: "temp_credit_limit" },
      { title: "เคลมสินค้า", desc: "QC ตรวจแล้ว รอผู้บริหารตัดสิน", icon: "inventory_2", color: "pink", url: `${APPROVAL_URL}?type=claim&status=pending`, badge: "claim" },
      { title: "เปิดร้านค้าใหม่", desc: "Manager อนุมัติแล้ว รอผู้บริหาร", icon: "add_business", color: "teal", url: `${APPROVAL_URL}?type=new_area_shop&status=pending`, badge: "new_area_shop" },
    ],
  },
  {
    group: "ภาพรวม & รายงาน",
    icon: "monitoring",
    items: [
      { title: "ภาพรวมผู้บริหาร", desc: "งานค้าง การเข้าร้าน และทีมขาย", icon: "space_dashboard", color: "purple", url: "/pages/executive/executive-Dashboard.html" },
      { title: "รายงานเข้าร้านค้า", desc: "สรุปการลงพื้นที่ · ส่งความเห็นถึงเซลล์", icon: "assignment", color: "blue", url: "/pages/executive/executiveHome.html" },
      { title: "ประวัติการอนุมัติ", desc: "งานที่อนุมัติ / ไม่อนุมัติแล้ว", icon: "history", color: "slate", url: APPROVAL_URL },
    ],
  },
  {
    group: "งานอื่น ๆ / เร็ว ๆ นี้",
    icon: "schedule",
    items: [
      // ยังไม่มีฟอร์มส่งคำขอ → "เร็ว ๆ นี้" แต่ถ้ามีคำขอประเภทนี้รออยู่ ปุ่มจะเปิดใช้ให้เอง
      { title: "อนุมัติโปรโมชั่น", desc: "โปรโมชั่นจากฝ่ายการตลาด", icon: "campaign", color: "pink", url: `${APPROVAL_URL}?type=promotion&status=pending`, badge: "promotion", soon: true },
      { title: "ยอดขาย & เป้าหมาย", desc: "เทียบยอดขายกับเป้ารายเดือน", icon: "trending_up", color: "green", url: "/commingSoon.html", soon: true },
    ],
  },
];

const RECENT_KEY = "ea-exec-recent";
let _counts = null; // { all, special_price, ... }

const exEsc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "เร็ว ๆ นี้" ที่มีงานประเภทนั้นรออยู่จริง → เปิดใช้
function isSoon(item) {
  return !!item.soon && !(item.badge && _counts && _counts[item.badge]);
}

function canSee(item) {
  if (isSoon(item)) return true;
  if (typeof canAccessPage !== "function" || !window.EA_ROLE) return true;
  return canAccessPage(window.EA_ROLE, new URL(item.url, location.origin).pathname);
}

function badgeHTML(item) {
  if (!item.badge || !_counts) return "";
  const n = _counts[item.badge] || 0;
  return n ? `<span class="ex-badge" title="รออนุมัติ ${n} รายการ">${n > 99 ? "99+" : n}</span>` : "";
}

// การ์ดเมนูแบบเดียวกับหน้า Form Hub
function cardHTML(item) {
  const soon = isSoon(item);
  return `
    <a class="mk-card c-${exEsc(item.color || "purple")} ${soon ? "is-soon" : ""}"
       href="${soon ? "#" : exEsc(item.url)}" data-url="${exEsc(item.url)}" data-title="${exEsc(item.title)}"
       ${soon ? 'aria-disabled="true" tabindex="-1"' : ""}>
      ${badgeHTML(item)}
      <span class="mk-card-icon"><span class="material-symbols-outlined">${exEsc(item.icon)}</span></span>
      <h3>${exEsc(item.title)}</h3>
      <p>${exEsc(item.desc || "")}</p>
      ${soon ? `<span class="mk-card-soon">เร็ว ๆ นี้</span>` : ""}
    </a>`;
}

function renderMenu(keyword = "") {
  const q = keyword.trim().toLowerCase();
  let shown = 0;
  document.getElementById("mkGroups").innerHTML = EXEC_MENU.map((g) => {
    const items = g.items.filter(canSee).filter((i) => !q || `${i.title} ${i.desc} ${g.group}`.toLowerCase().includes(q));
    if (!items.length) return "";
    shown += items.length;
    return `
      <section class="mk-group" style="--n:${Math.min(items.length, 5)}">
        <h2 class="mk-group-title"><span class="material-symbols-outlined">${exEsc(g.icon)}</span> ${exEsc(g.group)}</h2>
        <div class="mk-cards">${items.map(cardHTML).join("")}</div>
      </section>`;
  }).join("");
  document.getElementById("mkEmpty").hidden = shown > 0;
  document.getElementById("mkRecentWrap").hidden = !!q || !getRecent().length;
}

// ---------- ใช้ล่าสุด (เก็บในเบราว์เซอร์นี้) ----------
function allItems() { return EXEC_MENU.flatMap((g) => g.items.filter((i) => !isSoon(i) && canSee(i))); }
function getRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const all = allItems();
    return list.map((u) => all.find((i) => i.url === u)).filter(Boolean).slice(0, 4);
  } catch (e) { return []; }
}
function pushRecent(url) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((u) => u !== url);
    list.unshift(url);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch (e) { /* ไม่มี localStorage ก็ไม่เป็นไร */ }
}
function renderRecent() {
  const items = getRecent();
  document.getElementById("mkRecentWrap").hidden = !items.length;
  document.getElementById("mkRecent").innerHTML = items.map((i) => `
    <a class="mk-tile c-${exEsc(i.color)} is-compact" href="${exEsc(i.url)}" data-url="${exEsc(i.url)}">
      <span class="mk-tile-icon material-symbols-outlined">${exEsc(i.icon)}</span>
      <span class="mk-tile-text"><b>${exEsc(i.title)}</b></span>
    </a>`).join("");
}

// ---------- งานรออนุมัติ → ตัวเลขบนปุ่ม / hero / sidebar ----------
async function loadCounts() {
  try {
    const { pending } = await loadExecApprovals();
    const c = { all: pending.length };
    pending.forEach((r) => { const t = execNormType(r.request_type); c[t] = (c[t] || 0) + 1; });
    _counts = c;
    setExecNavBadge(c.all);
    const pill = document.getElementById("exPendingPill");
    if (c.all) {
      const oldest = Math.floor((Date.now() - execArrivedAt(pending[0])) / 86400000);
      document.getElementById("exPendingText").textContent = `มีงานรออนุมัติ ${c.all} รายการ${oldest >= 3 ? ` · รอนานสุด ${oldest} วัน` : ""}`;
    }
    pill.hidden = !c.all;
    renderMenu(document.getElementById("mkSearch").value);
  } catch (e) {
    console.warn("pending counts:", e);
  }
}

// ---------- header ----------
function setHeader(u) {
  const el = document.getElementById("headerDateText");
  if (el) el.textContent = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  if (!u) return;
  const name = u.display_name || u.full_name || u.username || u.email || "ผู้บริหาร";
  document.getElementById("userName").textContent = name;
  const h = new Date().getHours();
  const hello = h < 12 ? "สวัสดีตอนเช้า" : h < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
  document.getElementById("mkGreeting").textContent = `${hello}, คุณ${name}`;
}

// ---------- init ----------
document.addEventListener("DOMContentLoaded", async () => {
  setHeader(null);
  for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
  loadCounts(); // ⚡ เริ่มนับงานรออนุมัติทันที ไม่ต้องรอโหลดผู้ใช้
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") { try { await loadCurrentUser(); } catch (e) { /* ignore */ } }
  if (!window.EA_ROLE && window.currentUser?.role) window.EA_ROLE = typeof normalizeRole === "function" ? normalizeRole(window.currentUser.role) : window.currentUser.role;
  setHeader(window.currentUser);

  renderMenu();
  renderRecent();

  // มีงานใหม่ / ตัดสินแล้ว → ปรับตัวเลข
  if (typeof supabaseClient?.channel === "function") {
    let t = null;
    try {
      supabaseClient.channel("exec-hub").on("postgres_changes", { event: "*", schema: "public", table: "approval_requests" }, () => { clearTimeout(t); t = setTimeout(loadCounts, 1500); }).subscribe();
    } catch (e) { /* ignore */ }
  }

  const search = document.getElementById("mkSearch");
  search.addEventListener("input", () => renderMenu(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = document.querySelector("#mkGroups .mk-card:not(.is-soon)"); if (first) first.click(); }
    if (e.key === "Escape") { search.value = ""; renderMenu(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== search) { e.preventDefault(); search.focus(); }
  });
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".mk-tile, .mk-card");
    if (!tile) return;
    if (tile.classList.contains("is-soon")) { e.preventDefault(); return; }
    pushRecent(tile.dataset.url);
  });
});

// ---------- sidebar / ออกจากระบบ ----------
// ย่อ/ขยาย sidebar → js/components/sidebar-manager.js (ตัวเดียวกับหน้า Marketing)
async function logout() {
  try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
  location.href = "/pages/auth/login.html";
}
