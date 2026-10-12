// =====================================================
// marketingHome.js — หน้าเมนูรวมงานการตลาด (ปุ่มเมนู)
//
// ✏️ เพิ่ม / ลบ / แก้ปุ่มเมนู → แก้ที่ MARKETING_MENU ด้านล่างที่เดียว
//    url    : หน้าที่จะเปิด
//    roles  : role ที่เห็นปุ่มนี้ (ไม่ใส่ = ทุก role ที่เข้าหน้านี้ได้)
//    soon   : true = ยังไม่เปิดใช้ (แสดงป้าย "เร็ว ๆ นี้" และกดไม่ได้)
//    color  : blue | green | orange | purple | pink | teal | slate
// =====================================================

const MARKETING_ALLOWED_ROLES = ["admin", "manager", "executive", "marketing"];

const MARKETING_MENU = [
  {
    group: "วิเคราะห์ลูกค้า & ยอดขาย",
    icon: "insights",
    items: [
      {
        title: "วิเคราะห์ลูกค้า (RFM)",
        desc: "แบ่งกลุ่มลูกค้าตามความถี่ ยอดซื้อ และความล่าสุด",
        icon: "bar_chart",
        color: "blue",
        url: "/pages/dashboard/RfmDashboard.html",
        roles: ["admin", "manager", "marketing"],
      },
      {
        title: "ภาพรวมยอดขาย",
        desc: "ยอดขาย ภูมิภาค และแนวโน้มรายวัน",
        icon: "monitoring",
        color: "green",
        url: "/pages/dashboard/salesDashboard.html",
      },
      {
        title: "รวมรหัสลูกค้า",
        desc: "รวมลูกค้าที่มีหลายรหัสให้เป็นรายเดียว",
        icon: "merge",
        color: "slate",
        url: "/pages/admin/merge-customers.html",
        roles: ["admin"],
      },
    ],
  },
  {
    group: "แคมเปญ & โปรโมชั่น",
    icon: "sell",
    items: [
      {
        title: "ขออนุมัติราคาพิเศษ",
        desc: "ส่งคำขอราคาพิเศษ และติดตามผลอนุมัติ",
        icon: "request_quote",
        color: "orange",
        url: "/pages/forms/special-price-sale.html",
        roles: ["admin", "marketing"], // Manager อนุมัติอย่างเดียว ไม่ได้เป็นผู้ขอ
      },
      {
        // ขั้นที่ 1 ของการอนุมัติราคาพิเศษ (อนุมัติแล้วส่งต่อผู้บริหาร)
        // เดิมลิงก์ไป special-price-tracking.html ซึ่งเป็นหน้าตัวอย่างข้อมูลตายตัว
        title: "อนุมัติราคาพิเศษ (Manager)",
        desc: "พิจารณาคำขอจากทีมขาย ก่อนส่งต่อผู้บริหาร",
        icon: "fact_check",
        color: "orange",
        url: "/pages/forms/special-price-manager.html",
        roles: ["admin", "manager"],
      },
      {
        title: "จัดการโปรโมชั่น",
        desc: "สร้างและอัปโหลดโปรโมชั่นให้ทีมขาย",
        icon: "loyalty",
        color: "pink",
        url: "/commingSoon.html",
        soon: true,
      },
      {
        title: "ปฏิทินแคมเปญ",
        desc: "วางแผนแคมเปญรายเดือน",
        icon: "event_note",
        color: "purple",
        url: "/commingSoon.html",
        soon: true,
      },
    ],
  },
  {
    group: "สื่อสาร & ประชาสัมพันธ์",
    icon: "campaign",
    items: [
      {
        title: "ประกาศ / ข่าวสาร",
        desc: "สร้างประกาศถึงทีมขายและพนักงาน",
        icon: "newspaper",
        color: "teal",
        url: "/pages/marketing/announcements.html",
      },
      {
        title: "คลังสื่อการตลาด",
        desc: "โบรชัวร์ รูปสินค้า ไฟล์นำเสนอ",
        icon: "perm_media",
        color: "purple",
        url: "/commingSoon.html",
        soon: true,
      },
    ],
  },
  {
    group: "ภาคสนาม & ร้านค้า",
    icon: "storefront",
    items: [
      {
        title: "รายงานเข้าร้านค้า",
        desc: "ดูการเข้าเยี่ยมร้านและความสนใจสินค้า",
        icon: "assignment",
        color: "blue",
        url: "/pages/reports/reportTracker.html",
      },
      {
        title: "ข้อมูลสินค้า",
        desc: "หมวดหมู่ รายการสินค้า และ Attribute",
        icon: "inventory_2",
        color: "green",
        url: "/pages/admin/AddProductSpec.html",
        roles: ["admin"],
      },
    ],
  },
  {
    group: "นำเข้าข้อมูล",
    icon: "upload_file",
    items: [
      {
        title: "นำเข้าข้อมูล RFM",
        desc: "อัปโหลดไฟล์ยอดขายสำหรับวิเคราะห์ลูกค้า",
        icon: "cloud_upload",
        color: "slate",
        url: "/pages/components/rfmImport.html",
        roles: ["admin", "manager", "marketing"],
      },
      {
        title: "นำเข้ายอดขายรายวัน",
        desc: "อัปโหลดรายงานยอดขายจากระบบบัญชี",
        icon: "upload",
        color: "slate",
        url: "/pages/components/importData.html",
        roles: ["admin", "manager", "marketing"],
      },
    ],
  },
];

// -----------------------------------------------------
let currentRole = null;
const RECENT_KEY = "ea-marketing-recent";

function mkEsc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function canSee(item) {
  if (!item.roles) return true;
  return item.roles.includes(currentRole);
}

function allVisibleItems() {
  return MARKETING_MENU.flatMap((g) => g.items.filter(canSee));
}

function tileHTML(item, compact = false) {
  const soon = item.soon
    ? `<span class="mk-soon">เร็ว ๆ นี้</span>`
    : `<span class="material-symbols-outlined mk-go">arrow_forward</span>`;
  return `
    <a class="mk-tile c-${item.color || "blue"} ${item.soon ? "is-soon" : ""} ${compact ? "is-compact" : ""}"
       href="${item.soon ? "#" : mkEsc(item.url)}"
       data-url="${mkEsc(item.url)}" data-title="${mkEsc(item.title)}"
       ${item.soon ? 'aria-disabled="true" tabindex="-1"' : ""}>
      <span class="mk-tile-icon material-symbols-outlined">${mkEsc(item.icon)}</span>
      <span class="mk-tile-text">
        <b>${mkEsc(item.title)}</b>
        ${compact ? "" : `<small>${mkEsc(item.desc || "")}</small>`}
      </span>
      ${compact ? "" : soon}
    </a>`;
}

// การ์ดเมนูแบบเดียวกับหน้า Form Hub (ไอคอนสีใหญ่ตรงกลาง กดง่าย)
function cardHTML(item) {
  return `
    <a class="mk-card c-${mkEsc(item.color || "blue")} ${item.soon ? "is-soon" : ""}"
       href="${item.soon ? "#" : mkEsc(item.url)}"
       data-url="${mkEsc(item.url)}" data-title="${mkEsc(item.title)}"
       ${item.soon ? 'aria-disabled="true" tabindex="-1"' : ""}>
      <span class="mk-card-icon"><span class="material-symbols-outlined">${mkEsc(item.icon)}</span></span>
      <h3>${mkEsc(item.title)}</h3>
      <p>${mkEsc(item.desc || "")}</p>
      ${item.soon ? `<span class="mk-card-soon">เร็ว ๆ นี้</span>` : ""}
    </a>`;
}

function renderMenu(keyword = "") {
  const wrap = document.getElementById("mkGroups");
  const empty = document.getElementById("mkEmpty");
  const q = keyword.trim().toLowerCase();
  let shown = 0;

  wrap.innerHTML = MARKETING_MENU.map((g) => {
    const items = g.items
      .filter(canSee)
      .filter((i) => !q || `${i.title} ${i.desc} ${g.group}`.toLowerCase().includes(q));
    if (!items.length) return "";
    shown += items.length;
    return `
      <section class="mk-group" style="--n:${items.length}">
        <h2 class="mk-group-title"><span class="material-symbols-outlined">${mkEsc(g.icon)}</span> ${mkEsc(g.group)}</h2>
        <div class="mk-cards">${items.map(cardHTML).join("")}</div>
      </section>`;
  }).join("");

  empty.hidden = shown > 0;
  document.getElementById("mkRecentWrap").hidden = !!q || !getRecent().length;
}

// ---------- ใช้ล่าสุด (เก็บในเบราว์เซอร์นี้) ----------
function getRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const visible = allVisibleItems();
    return list.map((u) => visible.find((i) => i.url === u && !i.soon)).filter(Boolean).slice(0, 4);
  } catch (e) {
    return [];
  }
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
  const wrap = document.getElementById("mkRecentWrap");
  wrap.hidden = !items.length;
  document.getElementById("mkRecent").innerHTML = items.map((i) => tileHTML(i, true)).join("");
}

// ---------- header ----------
function updateHeaderDate() {
  const el = document.getElementById("headerDateText");
  if (el) el.textContent = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
}

async function loadUser() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const { data: p } = await supabaseClient
    .from("profiles").select("display_name, username, role").eq("id", session.user.id).single();
  currentRole = typeof normalizeRole === "function" ? normalizeRole(p?.role) : p?.role;
  const name = p?.display_name || p?.username || session.user.email;
  document.getElementById("userName").textContent = name;
  const av = document.getElementById("userAvatar");
  if (av) av.textContent = (name || "?").trim().charAt(0).toUpperCase();
  const hour = new Date().getHours();
  const hello = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
  document.getElementById("mkGreeting").textContent = `${hello}, ${name}`;
}

// ---------- sidebar: ย่อ/ขยาย อยู่ใน js/components/sidebar-manager.js ----------

// ---------- init ----------
document.addEventListener("DOMContentLoaded", async () => {
  updateHeaderDate();
  if (typeof protectPage === "function") await protectPage(MARKETING_ALLOWED_ROLES);
  try {
    await loadUser();
  } catch (e) {
    console.error("loadUser:", e);
  }

  renderMenu();
  renderRecent();

  const search = document.getElementById("mkSearch");
  search.addEventListener("input", () => renderMenu(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = document.querySelector("#mkGroups .mk-card:not(.is-soon)");
      if (first) first.click();
    }
    if (e.key === "Escape") { search.value = ""; renderMenu(); }
  });
  // กด "/" เพื่อค้นหา
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
    }
  });

  // คลิกปุ่มเมนู → จำไว้ใน "ใช้ล่าสุด"; ปุ่มที่ยังไม่เปิดใช้กดไม่ได้
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".mk-tile, .mk-card");
    if (!tile) return;
    if (tile.classList.contains("is-soon")) {
      e.preventDefault();
      return;
    }
    pushRecent(tile.dataset.url);
  });
});
