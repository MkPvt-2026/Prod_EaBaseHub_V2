// =====================================================
// reportTracker.js v6 — Sales Table Modal + Comment Popup + View Toggle
// 1 รายการ = 1 ร้านค้า (รวมสินค้าทั้งหมด)
// 🆕 คลิก sales card → เปิด modal ตารางทั้งสัปดาห์ของเซลล์คนนั้น
// 🆕 ปุ่ม comment ในแต่ละแถว → popup เล็กซ้อน
// 🆕 Toggle: List view / Table by Sales view
// =====================================================

"use strict";

let localUser = null;

let allReports = []; // raw rows from DB
let groupedReports = []; // grouped by shop visit
let filteredGroups = []; // after filter
let profilesMap = {};
let shopsMap = {};
let productsMap = {};
let tripPlanMap = {};
let commentCountsMap = {};
let replyCountsMap = {};

const REPLY_READ_KEY = "ea_reply_reads";
let replyUnreadMap = {};

function getReplyReads() {
  try {
    return JSON.parse(localStorage.getItem(REPLY_READ_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function saveReplyReads(reads) {
  localStorage.setItem(REPLY_READ_KEY, JSON.stringify(reads));
}

function markRepliesAsRead(reportIds) {
  const reads = getReplyReads();
  const now = new Date().toISOString();

  (reportIds || []).forEach((id) => {
    reads[id] = now;
    replyUnreadMap[id] = 0;
  });

  saveReplyReads(reads);
}

let isSavingComment = false;
let isSavingPopupComment = false;

let dateStart = null;
let dateEnd = null;

let currentPage = 1;
const PAGE_SIZE = 20;

let activeSalesFilter = null;

// Modal: report detail (เดิม)
let currentReportId = null;
let currentGroupKey = null;
let currentGroupRows = [];

// 🆕 Modal: sales table
let currentSalesModalId = null;

// 🆕 Modal: comment popup
let currentPopupGroupKey = null;
let currentPopupReportId = null;

// 🆕 View mode
let currentView = "list"; // 'list' | 'table'

// =====================================================
// 🔧 HELPER: รอ Supabase Client พร้อม
// =====================================================
function waitForSupabase(maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      if (typeof supabaseClient !== "undefined" && supabaseClient?.auth) {
        resolve(supabaseClient);
      } else if (attempts < maxAttempts) {
        setTimeout(check, 100);
      } else {
        reject(new Error("supabaseClient ไม่พร้อมหลังจากรอนานเกินไป"));
      }
    };
    check();
  });
}

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Report Manager initializing...");

  try {
    await waitForSupabase();

    const session = await getSessionSafely();
    if (!session) {
      showLoginRequired();
      return;
    }

    if (typeof protectPage === "function") {
      try {
        await protectPage(["admin", "executive", "manager"]);
      } catch (e) {
        console.warn("⚠️ protectPage failed:", e.message);
      }
    }

    localUser = await loadCurrentUser(session);
    if (!localUser) {
      showLoginRequired();
      return;
    }

    updateHeaderUI();
    initDateRange();
    setupDateControls();

    await Promise.all([loadProfiles(), loadShops(), loadProducts()]);
    await loadReports();

    setupEventListeners();
    setupLogout();

    console.log("✅ Report Manager ready");
  } catch (e) {
    console.error("❌ Init error:", e);
    showErrorState(e.message);
  }
});

// =====================================================
// 🔐 GET SESSION SAFELY
// =====================================================
async function getSessionSafely() {
  try {
    const {
      data: { session },
      error,
    } = await supabaseClient.auth.getSession();
    if (error) {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabaseClient.auth.getUser();
        if (user && !userError) return { user };
      } catch (e) {
        /* ignore */
      }
      return null;
    }
    return session;
  } catch (e) {
    console.error("❌ getSessionSafely error:", e);
    return null;
  }
}

// =====================================================
// 👤 LOAD CURRENT USER
// =====================================================
async function loadCurrentUser(session) {
  try {
    if (window.currentUser && window.currentUser.id) {
      return {
        id: window.currentUser.id,
        role: window.currentUser.role,
        area: window.currentUser.area,
        name:
          window.currentUser.display_name ||
          window.currentUser.username ||
          window.currentUser.email ||
          "User",
      };
    }

    const userId = session?.user?.id;
    if (!userId) return null;

    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("id, display_name, role, area")
      .eq("id", userId)
      .single();

    if (error) {
      return {
        id: userId,
        role: "user",
        area: null,
        name: session.user.email || "User",
      };
    }

    return {
      id: profile.id,
      role: profile.role,
      area: profile.area,
      name: profile.display_name || session.user.email || "User",
    };
  } catch (e) {
    console.error("❌ loadCurrentUser error:", e);
    return null;
  }
}

// =====================================================
// 🎨 UPDATE HEADER UI
// =====================================================
function updateHeaderUI() {
  const nameEl = document.getElementById("userName");
  if (nameEl && localUser?.name) nameEl.textContent = localUser.name;

  const avatarEl = document.getElementById("userAvatar");
  if (avatarEl && localUser?.name)
    avatarEl.textContent = localUser.name.charAt(0).toUpperCase();
}

// =====================================================
// ⚠️ UI STATES
// =====================================================
function showLoginRequired() {
  const container = document.getElementById("reportsContainer");
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔐</div>
        <h3>กรุณาเข้าสู่ระบบ</h3>
        <p>คุณต้องเข้าสู่ระบบก่อนเพื่อดูรายงาน</p>
        <a href="/pages/auth/login.html" class="btn btn-primary" style="margin-top:1rem;">เข้าสู่ระบบ</a>
      </div>`;
  }
  const salesGrid = document.getElementById("salesGrid");
  if (salesGrid) salesGrid.innerHTML = "";
  ["totalReports", "unreadReports", "readReports", "activeSales"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "—";
    },
  );
}

function showErrorState(message) {
  const container = document.getElementById("reportsContainer");
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>เกิดข้อผิดพลาด</h3>
        <p>${message}</p>
        <button onclick="location.reload()" class="btn btn-primary" style="margin-top:1rem;">ลองใหม่อีกครั้ง</button>
      </div>`;
  }
}

// =====================================================
// 📅 DATE RANGE CONTROLS
// =====================================================
function initDateRange() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  dateStart = monday;
  dateEnd = sunday;

  const startInput = document.getElementById("dateStart");
  const endInput = document.getElementById("dateEnd");
  if (startInput) startInput.value = formatDateForInput(dateStart);
  if (endInput) endInput.value = formatDateForInput(dateEnd);

  updateDateRangeLabel();
}

function setupDateControls() {
  const startInput = document.getElementById("dateStart");
  const endInput = document.getElementById("dateEnd");

  if (startInput) {
    startInput.addEventListener("change", () => {
      dateStart = new Date(startInput.value);
      dateStart.setHours(0, 0, 0, 0);
      updateDateRangeLabel();
      clearQuickRangeActive();
      loadReports();
    });
  }

  if (endInput) {
    endInput.addEventListener("change", () => {
      dateEnd = new Date(endInput.value);
      dateEnd.setHours(23, 59, 59, 999);
      updateDateRangeLabel();
      clearQuickRangeActive();
      loadReports();
    });
  }

  document.querySelectorAll(".quick-range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setQuickRange(btn.dataset.range);
      document
        .querySelectorAll(".quick-range-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

function clearQuickRangeActive() {
  document
    .querySelectorAll(".quick-range-btn")
    .forEach((b) => b.classList.remove("active"));
}

function setQuickRange(range) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  let start = new Date();
  start.setHours(0, 0, 0, 0);
  let end = new Date(today);

  switch (range) {
    case "today":
      break;
    case "7days":
      start.setDate(start.getDate() - 6);
      break;
    case "30days":
      start.setDate(start.getDate() - 29);
      break;
    case "thisWeek": {
      const d = start.getDay();
      start.setDate(start.getDate() + (d === 0 ? -6 : 1 - d));
      break;
    }
    case "lastWeek": {
      const d = start.getDay();
      start.setDate(start.getDate() + (d === 0 ? -6 : 1 - d) - 7);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "thisMonth":
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case "lastMonth":
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      break;
    default: {
      const dd = start.getDay();
      start.setDate(start.getDate() + (dd === 0 ? -6 : 1 - dd));
    }
  }

  dateStart = start;
  dateEnd = end;

  const startInput = document.getElementById("dateStart");
  const endInput = document.getElementById("dateEnd");
  if (startInput) startInput.value = formatDateForInput(dateStart);
  if (endInput) endInput.value = formatDateForInput(dateEnd);

  updateDateRangeLabel();
  loadReports();
}

function updateDateRangeLabel() {
  const label = document.getElementById("dateRangeLabel");
  if (!label) return;
  const days = Math.ceil((dateEnd - dateStart) / (1000 * 60 * 60 * 24)) + 1;
  const fmt = (d) =>
    d.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  label.textContent = `${fmt(dateStart)} – ${fmt(dateEnd)} (${days} วัน)`;
}

function formatDateForInput(date) {
  return date.toISOString().split("T")[0];
}

// =====================================================
// 👥 LOAD PROFILES
// =====================================================
async function loadProfiles() {
  try {
    const { data: salesData } = await supabaseClient
      .from("profiles")
      .select("id, display_name, role, area")
      .in("role", ["sales", "user"]);

    const { data: mgrData } = await supabaseClient
      .from("profiles")
      .select("id, display_name, role, area")
      .in("role", ["manager"]);

    const { data: execData } = await supabaseClient
      .from("profiles")
      .select("id, display_name, role, area")
      .in("role", ["admin", "executive"]);

    const allProfiles = [
      ...(salesData || []),
      ...(mgrData || []),
      ...(execData || []),
    ];
    profilesMap = Object.fromEntries(allProfiles.map((p) => [p.id, p]));

    const selectSales = document.getElementById("filterSales");
    if (selectSales) {
      selectSales.innerHTML = '<option value="">— ทั้งหมด —</option>';
      (salesData || []).forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.display_name || p.id;
        selectSales.appendChild(opt);
      });
    }

    const selectMgr = document.getElementById("filterManager");
    if (selectMgr) {
      selectMgr.innerHTML = '<option value="">— ทั้งหมด —</option>';
      (mgrData || []).forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.display_name || p.id;
        selectMgr.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("❌ loadProfiles error:", e);
  }
}

// =====================================================
// 🏪 LOAD SHOPS
// =====================================================
async function loadShops() {
  try {
    const { data, error } = await supabaseClient
      .from("shops")
      .select("id, shop_name, province")
      .order("shop_name");
    if (error) throw error;
    shopsMap = Object.fromEntries(
      (data || []).map((s) => [
        s.id,
        {
          name: s.shop_name,
          province: s.province || "—",
        },
      ]),
    );
  } catch (e) {
    console.error("❌ loadShops error:", e);
  }
}

// =====================================================
// 📦 LOAD PRODUCTS
// =====================================================
async function loadProducts() {
  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("id, name");
    if (error) throw error;
    if (data)
      data.forEach((p) => {
        productsMap[p.id] = p.name;
      });
  } catch (e) {
    console.error("❌ loadProducts error:", e);
  }
}

// =====================================================
// 💬 LOAD COMMENT COUNTS
// =====================================================
async function loadCommentCounts(reportIds) {
  commentCountsMap = {};
  if (!reportIds || !reportIds.length) return;
  try {
    const { data, error } = await supabaseClient
      .from("report_comments")
      .select("report_id")
      .in("report_id", reportIds);
    if (error) throw error;
    (data || []).forEach((c) => {
      commentCountsMap[c.report_id] = (commentCountsMap[c.report_id] || 0) + 1;
    });
  } catch (e) {
    console.error("❌ loadCommentCounts error:", e);
  }
}

async function loadReplyCounts(reportIds) {
  replyCountsMap = {};
  replyUnreadMap = {};

  if (!reportIds || !reportIds.length) return;

  const reads = getReplyReads();

  try {
    const { data, error } = await supabaseClient
      .from("report_comments")
      .select("report_id, created_at, manager_id, profiles:manager_id(role)")
      .in("report_id", reportIds);

    if (error) throw error;

    (data || []).forEach((c) => {
      const profile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
      const role = profile?.role;

      if (role === "sales" || role === "user") {
        replyCountsMap[c.report_id] = (replyCountsMap[c.report_id] || 0) + 1;

        const lastRead = reads[c.report_id];
        if (!lastRead || new Date(c.created_at) > new Date(lastRead)) {
          replyUnreadMap[c.report_id] = (replyUnreadMap[c.report_id] || 0) + 1;
        }
      }
    });
  } catch (e) {
    console.error("❌ loadReplyCounts error:", e);
  }
}
// =====================================================
// 🔗 GROUP REPORTS
// =====================================================
function makeGroupKey(r) {
  const dateKey =
    r.report_date ||
    (r.submitted_at ? r.submitted_at.split("T")[0] : "no-date");
  return `${r.sale_id}__${r.shop_id}__${dateKey}`;
}

function groupReportRows(reports) {
  const map = new Map();

  for (const r of reports) {
    const key = makeGroupKey(r);

    if (!map.has(key)) {
      map.set(key, {
        key,
        sale_id: r.sale_id,
        shop_id: r.shop_id,
        report_date: r.report_date,
        submitted_at: r.submitted_at,
        created_at: r.created_at,
        status_visit: r.status_visit,
        note: r.note,
        product_interest: r.product_interest,
        source: r.source,
        manager_acknowledged: r.manager_acknowledged,
        products: [],
        reportIds: [],
      });
    }

    const group = map.get(key);
    group.reportIds.push(r.id);

    if (r.product_id) {
      group.products.push({
        product_id: r.product_id,
        attributes: r.attributes || {},
        quantity: r.quantity,
      });
    }

    if (!group.note && r.note) group.note = r.note;
    if (!group.product_interest && r.product_interest)
      group.product_interest = r.product_interest;
    if (!group.status_visit && r.status_visit)
      group.status_visit = r.status_visit;

    if (!r.manager_acknowledged) {
      group.manager_acknowledged = false;
    }
  }

  return [...map.values()].sort((a, b) => {
    const da = new Date(a.submitted_at || a.report_date || a.created_at || 0);
    const db = new Date(b.submitted_at || b.report_date || b.created_at || 0);
    return db - da;
  });
}

// =====================================================
// 💬 COUNT COMMENTS PER GROUP
// =====================================================
function getGroupCommentCount(group) {
  let total = 0;
  for (const rid of group.reportIds) {
    total += commentCountsMap[rid] || 0;
  }
  return total;
}

function getGroupReplyCount(group) {
  let total = 0;

  for (const rid of group.reportIds) {
    total += replyCountsMap[rid] || 0;
  }

  return total;
}

function getGroupUnreadReplyCount(group) {
  let total = 0;

  for (const rid of group.reportIds) {
    total += replyUnreadMap[rid] || 0;
  }

  return total;
}
// =====================================================
// 📊 LOAD REPORTS
// =====================================================
async function loadReports() {
  const container = document.getElementById("reportsContainer");
  if (container)
    container.innerHTML = '<div class="loading">กำลังโหลดรายงาน...</div>';

  try {
    let query = supabaseClient
      .from("reports")
      .select("*")
      .order("submitted_at", { ascending: false, nullsLast: true })
      .order("report_date", { ascending: false, nullsLast: true });

    const { data, error } = await query;
    if (error) throw error;

    const startTime = dateStart.getTime();
    const endTime = dateEnd.getTime();

    allReports = (data || []).filter((r) => {
      const date = r.submitted_at || r.report_date || r.created_at;
      if (!date) return false;
      const t = new Date(date).getTime();
      return t >= startTime && t <= endTime;
    });

    const reportIds = allReports.map((r) => r.id);

    await Promise.all([
      loadCommentCounts(reportIds),
      loadReplyCounts(reportIds),
    ]);

    groupedReports = groupReportRows(allReports);
    filteredGroups = [...groupedReports];
    activeSalesFilter = null;

    updateSummaryCards();
    updateManagerGrid();
    updateSalesGrid();
    updateSalesQuickPick(); // 🆕
    currentPage = 1;
    renderReports();

    console.log(
      `✅ Loaded ${allReports.length} rows → ${groupedReports.length} shop visits`,
    );
  } catch (e) {
    console.error("❌ loadReports error:", e);
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>เกิดข้อผิดพลาด</h3>
          <p>${e.message}</p>
          <button onclick="loadReports()" class="btn btn-primary" style="margin-top:1rem;">ลองใหม่</button>
        </div>`;
    }
  }
}

// =====================================================
// 📈 UPDATE SUMMARY CARDS
// =====================================================
function updateSummaryCards() {
  const total = groupedReports.length;
  const unread = groupedReports.filter((g) => !g.manager_acknowledged).length;
  const read = groupedReports.filter((g) => g.manager_acknowledged).length;
  const commented = groupedReports.filter(
    (g) => getGroupCommentCount(g) > 0,
  ).length;

  const el = (id) => document.getElementById(id);
  if (el("totalReports")) el("totalReports").textContent = total;
  if (el("unreadReports")) el("unreadReports").textContent = unread;
  if (el("readReports")) el("readReports").textContent = read;
  if (el("commentedReports")) el("commentedReports").textContent = commented;
}

// =====================================================
// 👔 UPDATE MANAGER GRID
// =====================================================
function updateManagerGrid() {
  const grid = document.getElementById("managerGrid");
  if (!grid) return;

  const managers = Object.entries(profilesMap).filter(
    ([, p]) => p.role === "manager",
  );

  if (!managers.length) {
    grid.innerHTML =
      '<div class="empty-state"><p>ไม่มีข้อมูลผู้จัดการ</p></div>';
    return;
  }

  grid.innerHTML = managers
    .map(([id, profile]) => {
      const displayName = profile.display_name || "—";
      return `
      <div class="sales-card" onclick="filterByManager('${id}')">
        <div class="sales-avatar">${displayName.charAt(0).toUpperCase()}</div>
        <div class="sales-name">${escapeHtml(displayName)}</div>
        <div class="sales-stats">
          <div class="stat-item">
            <span class="stat-label">ผู้จัดการ</span>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

// =====================================================
// 👥 UPDATE SALES GRID
// 🆕 คลิกการ์ด → เปิด Sales Table Modal
// =====================================================
function updateSalesGrid() {
  const grid = document.getElementById("salesGrid");
  if (!grid) return;

  const salesEntries = Object.entries(profilesMap).filter(
    ([, p]) => p.role === "sales" || p.role === "user",
  );

  if (!salesEntries.length) {
    grid.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลเซลล์</p></div>';
    return;
  }

  grid.innerHTML = salesEntries
    .map(([id, profile]) => {
      const groups = groupedReports.filter((g) => g.sale_id === id);
      const total = groups.length;
      const unread = groups.filter((g) => !g.manager_acknowledged).length;
      const isActive = activeSalesFilter === id;
      const displayName = profile.display_name || "—";

      return `
      <div class="sales-card ${isActive ? "active" : ""} ${unread > 0 ? "has-unread" : ""}"
           onclick="openSalesTableModal('${id}')"
           title="คลิกเพื่อดูรายงานทั้งหมดของ ${escapeHtml(displayName)}">
        <div class="sales-card-header">
          <div class="sales-avatar">${displayName.charAt(0).toUpperCase()}</div>
          <button class="sales-filter-btn"
                  onclick="event.stopPropagation(); filterBySale('${id}')"
                  title="กรองในรายการด้านล่าง">
            <span class="material-symbols-outlined icon-sm">filter_alt</span>
          </button>
        </div>
        <div class="sales-name">${escapeHtml(displayName)}</div>
        <div class="sales-stats">
          <div class="stat-item">
            <span class="stat-value">${total}</span>
            <span class="stat-label">ร้านค้า</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" style="color:${unread > 0 ? "var(--danger, #ef4444)" : "var(--info, #0093ad)"}">
              ${unread}
            </span>
            <span class="stat-label">ยังไม่อ่าน</span>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

// =====================================================
// 🆕 UPDATE SALES QUICK PICK (สำหรับ Table view)
// =====================================================
function updateSalesQuickPick() {
  const container = document.getElementById("salesQuickPick");
  if (!container) return;

  const salesEntries = Object.entries(profilesMap).filter(
    ([, p]) => p.role === "sales" || p.role === "user",
  );

  if (!salesEntries.length) {
    container.innerHTML =
      '<div class="empty-state"><p>ไม่มีข้อมูลเซลล์</p></div>';
    return;
  }

  // เรียงตามจำนวนรายงาน (มาก→น้อย)
  const enriched = salesEntries
    .map(([id, profile]) => {
      const groups = groupedReports.filter((g) => g.sale_id === id);
      const total = groups.length;
      const unread = groups.filter((g) => !g.manager_acknowledged).length;
      return { id, profile, total, unread };
    })
    .sort((a, b) => b.total - a.total);

  container.innerHTML = enriched
    .map(({ id, profile, total, unread }) => {
      const displayName = profile.display_name || "—";
      const disabled = total === 0 ? "disabled" : "";
      return `
      <button class="quick-pick-card ${disabled} ${unread > 0 ? "has-unread" : ""}"
              ${total === 0 ? "" : `onclick="openSalesTableModal('${id}')"`}
              title="${total === 0 ? "ไม่มีรายงานในช่วงเวลานี้" : "ดูตารางรายงาน"}">
        <div class="qp-avatar">${displayName.charAt(0).toUpperCase()}</div>
        <div class="qp-info">
          <div class="qp-name">${escapeHtml(displayName)}</div>
          <div class="qp-meta">
            <span>${total} ร้าน</span>
            ${unread > 0 ? `<span class="qp-unread">${unread} ยังไม่อ่าน</span>` : ""}
          </div>
        </div>
        <span class="material-symbols-outlined qp-arrow">arrow_forward</span>
      </button>`;
    })
    .join("");
}

// =====================================================
// 🆕 SWITCH VIEW
// =====================================================
function switchView(view) {
  currentView = view;

  document.querySelectorAll(".view-toggle-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });

  document
    .getElementById("listView")
    .classList.toggle("active", view === "list");
  document
    .getElementById("tableView")
    .classList.toggle("active", view === "table");
}

// =====================================================
// 🔍 FILTERS
// =====================================================
function filterBySale(saleId) {
  if (activeSalesFilter === saleId) {
    activeSalesFilter = null;
    document.getElementById("filterSales").value = "";
  } else {
    activeSalesFilter = saleId;
    document.getElementById("filterSales").value = saleId;
  }
  // ให้ filter ทำงานในมุมมอง list
  switchView("list");
  updateSalesGrid();
  applyFilter();

  // scroll ไปยัง list
  const listEl = document.getElementById("listView");
  if (listEl) listEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function filterByManager(mgrId) {
  const select = document.getElementById("filterManager");
  if (select) select.value = mgrId;
  applyFilter();
}

function applyFilter() {
  const salesId = document.getElementById("filterSales")?.value || "";
  const mgrId = document.getElementById("filterManager")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";
  const search = (
    document.getElementById("searchInput")?.value || ""
  ).toLowerCase();

  filteredGroups = groupedReports.filter((g) => {
    if (salesId && g.sale_id !== salesId) return false;

    if (status === "unread" && g.manager_acknowledged) return false;
    if (status === "read" && !g.manager_acknowledged) return false;
    if (status === "commented" && getGroupCommentCount(g) === 0) return false;

    if (search) {
      const shopData = shopsMap[g.shop_id];
      const shopName = shopData?.name || "";
      const province = shopData?.province || "";
      const salesName = profilesMap[g.sale_id]?.display_name || "";
      const note = g.note || "";
      const productNames = g.products
        .map((p) => productsMap[p.product_id] || "")
        .join(" ");
      const productInterest = g.product_interest || "";

      const searchText = [
        shopName,
        province,
        salesName,
        note,
        productNames,
        productInterest,
      ]
        .join(" ")
        .toLowerCase();
      if (!searchText.includes(search)) return false;
    }

    return true;
  });

  currentPage = 1;
  renderReports();
}

function resetFilter() {
  ["filterSales", "filterManager", "filterStatus"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";

  activeSalesFilter = null;
  filteredGroups = [...groupedReports];
  currentPage = 1;

  updateSalesGrid();
  renderReports();
}

// =====================================================
// 🎨 RENDER REPORTS — list view (เดิม)
// =====================================================
function renderReports() {
  const container = document.getElementById("reportsContainer");
  if (!container) return;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageGroups = filteredGroups.slice(start, start + PAGE_SIZE);

  const countEl = document.getElementById("reportCount");
  if (countEl) {
    countEl.textContent =
      filteredGroups.length !== groupedReports.length
        ? `(${filteredGroups.length} / ${groupedReports.length} ร้านค้า)`
        : `(${groupedReports.length} ร้านค้า)`;
  }

  if (!pageGroups.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon-mat">inbox</span>
        <h3>ไม่พบรายงาน</h3>
        <p>ไม่มีรายงานในช่วงเวลาที่เลือก</p>
      </div>`;
    renderPagination();
    return;
  }

  container.innerHTML = pageGroups
    .map((g) => {
      const profile = profilesMap[g.sale_id];
      const salesName = profile?.display_name || "—";
      const shopData = shopsMap[g.shop_id];
      const shopName = shopData?.name || "—";
      const province = shopData?.province || "";
      const isUnread = !g.manager_acknowledged;

      const productCount = g.products.length;
      let productSummary = "—";
      if (productCount === 1) {
        productSummary = productsMap[g.products[0].product_id] || "—";
      } else if (productCount > 1) {
        const firstName = productsMap[g.products[0].product_id] || "—";
        productSummary = `${firstName} +${productCount - 1} รายการ`;
      } else if (productCount === 0) {
        productSummary = "ไม่มีสินค้า";
      }

      const commentCount = getGroupCommentCount(g);
      const replyCount = getGroupReplyCount(g);
      const unreadReplyCount = getGroupUnreadReplyCount(g);
      const commentBadge = `
  <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">

    ${
      commentCount > 0
        ? `
      <span class="badge-comment" title="${commentCount} ความคิดเห็น">
        <span class="material-symbols-outlined icon-sm icon-blue">
          chat_bubble
        </span>
        ${commentCount}
      </span>
    `
        : ""
    }

    ${
      replyCount > 0
        ? `
  <span class="badge-comment badge-reply ${unreadReplyCount > 0 ? "has-new-reply" : ""}"
        title="${replyCount} การตอบกลับ${unreadReplyCount > 0 ? ` • ใหม่ ${unreadReplyCount}` : ""}">
    ${unreadReplyCount > 0 ? `<span class="reply-pulse-dot"></span>` : ""}
    <span class="material-symbols-outlined icon-sm">
      reply
    </span>
    ${replyCount}
  </span>
`
        : ""
    }

  </div>
`;

      const provinceHtml = province
        ? `
        <span class="report-province">
          <span class="material-symbols-outlined icon-sm icon-red">location_on</span>
          ${escapeHtml(province)}
        </span>
      `
        : "";

      return `
      <div class="report-item ${isUnread ? "unread" : ""}"
           onclick="openGroupModal('${g.key}')">

        <div class="report-icon">${salesName.charAt(0).toUpperCase()}</div>

        <div class="report-info">

          <div class="report-header">
            <span class="report-sales">${escapeHtml(salesName)}</span>
            <span class="report-date">
              <span class="material-symbols-outlined icon-sm icon-blue-dark">calendar_month</span>
              ${formatDate(g.report_date || g.submitted_at)}
            </span>
          </div>

          <div class="report-details">
            <div class="report-detail-item">
              <span class="material-symbols-outlined icon-sm icon-blue">storefront</span>
              ${escapeHtml(shopName)}
            </div>
            ${provinceHtml}
            <div class="report-detail-item">
              <span class="material-symbols-outlined icon-sm icon-brown">inventory_2</span>
              ${escapeHtml(productSummary)}
            </div>
          </div>

        </div>

        <div class="report-status">
  ${commentBadge}
  <span class="badge ${isUnread ? "badge-unread" : "badge-read"}">
    <span class="emoji-status">
      ${isUnread ? "⏰" : "✅"}
    </span>
    ${isUnread ? "ยังไม่อ่าน" : "อ่านแล้ว"}
  </span>
</div>

      </div>`;
    })
    .join("");

  renderPagination();
}

// =====================================================
// 📄 PAGINATION
// =====================================================
function renderPagination() {
  const el = document.getElementById("pagination");
  if (!el) return;

  const totalPages = Math.ceil(filteredGroups.length / PAGE_SIZE);
  if (totalPages <= 1) {
    el.innerHTML = "";
    return;
  }

  let html = "";
  if (currentPage > 1)
    html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})">‹</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - 2 && i <= currentPage + 2)
    ) {
      html += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="goToPage(${i})">${i}</button>`;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<span class="page-dots">...</span>';
    }
  }

  if (currentPage < totalPages)
    html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})">›</button>`;
  el.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderReports();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getDateKey(dateValue) {
  if (!dateValue) return "";
  return String(dateValue).split("T")[0];
}

// =====================================================
// 🆕 LOAD TRIP PLANS FOR A SALE
// - ดึงข้อมูลจากตาราง trips โดยกรองด้วย user_id หรือ user_name (กรณีที่ profile ไม่มีชื่อ)
// - สร้างแผนที่ tripPlanMap: { "2024-06-01": ["ร้าน A", "ร้าน B"], "2024-06-02": ["ร้าน C"] }
// - ใช้ใน modal ตารางรายงานของเซลล์ เพื่อแสดงว่ามีแผนจะไปเยี่ยมร้านไหนบ้างในแต่ละวัน 


async function loadTripPlansForSale(saleId) {
  tripPlanMap = {};

  const profile = profilesMap[saleId];
  const saleName = String(profile?.display_name || "").trim();

  console.log("🧑 saleId =", saleId);
  console.log("🧑 saleName =", saleName);

  const start = formatDateForInput(dateStart);
  const end = formatDateForInput(dateEnd);

  const { data, error } = await supabaseClient
    .from("trips")
    .select("id, user_id, user_name, trips, start_date, end_date, status, is_latest, created_at")
    .lte("start_date", end)
    .gte("end_date", start)
    .order("created_at", { ascending: false });

  console.log("🚌 trips raw =", data);
  console.log("❌ trips error =", error);

  if (error) return;

  const matchedPlans = (data || []).filter((plan) => {
    const dbName = String(plan.user_name || "").trim();

    return (
      plan.user_id === saleId ||
      dbName === saleName ||
      dbName.includes(saleName) ||
      saleName.includes(dbName)
    );
  });

  console.log("✅ matchedPlans =", matchedPlans);

  matchedPlans.forEach((plan) => {
    let rows = [];

    if (Array.isArray(plan.trips)) {
      rows = plan.trips;
    } else if (plan.trips && typeof plan.trips === "object") {
      rows = Array.isArray(plan.trips.rows) ? plan.trips.rows : [];
    }

    rows.forEach((t) => {
      const dateKey = getDateKey(t.date);
      if (!dateKey) return;

      const shops = [t.shop1, t.shop2, t.shop3]
        .map((v) => String(v || "").trim())
        .filter((v) => v && v !== "-" && v !== "ชื่อร้าน");

      if (!tripPlanMap[dateKey]) tripPlanMap[dateKey] = [];

      shops.forEach((shop) => {
        if (!tripPlanMap[dateKey].includes(shop)) {
          tripPlanMap[dateKey].push(shop);
        }
      });
    });
  });

  console.log("✅ tripPlanMap =", tripPlanMap);
}

// =====================================================
// 🆕 OPEN SALES TABLE MODAL — ตารางทั้งสัปดาห์ของเซลล์
// =====================================================
async function openSalesTableModal(saleId) {
  const profile = profilesMap[saleId];
  if (!profile) {
    showToast("❌ ไม่พบข้อมูลเซลล์");
    return;
  }

  currentSalesModalId = saleId;
  const displayName = profile.display_name || "—";

  // Header
  const titleEl = document.getElementById("salesModalTitle");
  if (titleEl) titleEl.textContent = `รายงานของ ${displayName}`;

  const avatarEl = document.getElementById("salesModalAvatar");
  if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();

  const subtitleEl = document.getElementById("salesModalSubtitle");
  if (subtitleEl) {
    const fmt = (d) =>
      d.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      });
    subtitleEl.textContent = `ช่วงเวลา ${fmt(dateStart)} – ${fmt(dateEnd)}`;
  }

  console.log("🧑 saleId ที่ส่งมา =", saleId);
console.log("🧑 profile =", profile);

  // โหลดแผนการเดินทางของเซลล์ก่อน แล้วค่อย render ตาราง
  await loadTripPlansForSale(saleId);
  renderSalesTable(saleId);

  // Show modal
  const modal = document.getElementById("salesTableModal");
  if (modal) {
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
  }
}


function renderPlanShopsByDate(reportDate) {
  const dateKey = getDateKey(reportDate);
  const shops = tripPlanMap[dateKey] || [];

  if (!shops.length) {
    return `<span class="muted-text">—</span>`;
  }

  return `
    <div class="plan-shop-list">
      ${shops.map((shop) => `<div>${escapeHtml(shop)}</div>`).join("")}
    </div>
  `;
}


function getDateKey(dateValue) {
  if (!dateValue) return "";
  return String(dateValue).split("T")[0];
}

// =====================================================
// 🆕 RENDER SALES TABLE
// =====================================================
function renderSalesTable(saleId) {
  const tbody = document.getElementById("salesTableBody");
  if (!tbody) return;

  // ดึงเฉพาะของเซลล์คนนี้ + เรียงตามวันที่ (เก่า→ใหม่ เพื่ออ่านลำดับเวลา)
  const groups = groupedReports
    .filter((g) => g.sale_id === saleId)
    .sort((a, b) => {
      const da = new Date(a.report_date || a.submitted_at || a.created_at || 0);
      const db = new Date(b.report_date || b.submitted_at || b.created_at || 0);
      return da - db;
    });

  // อัปเดต mini summary
  const totalShops = groups.length;
  const provinces = new Set(
    groups.map((g) => shopsMap[g.shop_id]?.province).filter(Boolean),
  ).size;
  const unread = groups.filter((g) => !g.manager_acknowledged).length;
  const commented = groups.filter((g) => getGroupCommentCount(g) > 0).length;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText("stShops", totalShops);
  setText("stProvinces", provinces);
  setText("stUnread", unread);
  setText("stCommented", commented);
  setText("salesModalCount", `${totalShops} ร้าน`);

  if (!groups.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state" style="padding:32px 20px;">
            <span class="material-symbols-outlined empty-icon-mat">inbox</span>
            <h3>ไม่มีรายงาน</h3>
            <p>เซลล์คนนี้ไม่มีรายงานในช่วงเวลาที่เลือก</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = groups
    .map((g) => {
      const shopData = shopsMap[g.shop_id];
      const shopName = shopData?.name || "—";
      const province = shopData?.province || "—";
      const isUnread = !g.manager_acknowledged;
      const planShopHtml = renderPlanShopsByDate(
        g.report_date || g.submitted_at,
      );

      // สินค้าที่จำหน่าย (chips) — ห่อใน wrapper เพื่อไม่ให้ td flex กระทบ row height
      let productHtml = '<span class="muted-text">—</span>';
      if (g.products.length > 0) {
        const chipsInner = g.products
          .slice(0, 3)
          .map(
            (p) =>
              `<span class="product-chip">${escapeHtml(productsMap[p.product_id] || "—")}</span>`,
          )
          .join("");
        const moreChip =
          g.products.length > 3
            ? `<span class="product-chip more-chip">+${g.products.length - 3}</span>`
            : "";
        productHtml = `<div class="product-chips">${chipsInner}${moreChip}</div>`;
      }

      // รายละเอียดการเข้าเยี่ยม — ขยายได้เมื่อยาว
      let noteHtml;
      if (!g.note) {
        noteHtml = `<div class="note-cell"><span class="muted-text">—</span></div>`;
      } else {
        const noteText = String(g.note);
        // ถ้ายาวพอควร (>140 ตัวอักษร) หรือมีหลายบรรทัด → ใส่ปุ่มขยาย
        const isLong =
          noteText.length > 140 || (noteText.match(/\n/g) || []).length >= 2;
        if (isLong) {
          noteHtml = `
            <div class="note-cell collapsed" data-note-cell>${escapeHtml(noteText)}</div>
            <button type="button" class="note-toggle-btn" onclick="toggleNote(this)">
              <span>ดูเพิ่ม</span>
              <span class="material-symbols-outlined">expand_more</span>
            </button>`;
        } else {
          noteHtml = `<div class="note-cell">${escapeHtml(noteText)}</div>`;
        }
      }

      const commentCount = getGroupCommentCount(g);
      const commentBtnContent =
        commentCount > 0
          ? `<span class="material-symbols-outlined icon-sm">chat_bubble</span>
             <span class="cmt-count">${commentCount}</span>`
          : `<span class="material-symbols-outlined icon-sm">add_comment</span>`;

      return `
      <tr class="${isUnread ? "row-unread" : ""}" data-key="${g.key}">
        <td class="td-date">
          <div class="td-date-main">${formatDateShort(g.report_date || g.submitted_at)}</div>
          <div class="td-date-sub">${formatWeekday(g.report_date || g.submitted_at)}</div>
        </td>
        <td class="td-shop">
          <div class="shop-name">${escapeHtml(shopName)}</div>
        </td>
        <td class="td-province">
          <span class="material-symbols-outlined icon-sm icon-red">location_on</span>
          ${escapeHtml(province)}
        </td>
        <td class="td-products">${productHtml}</td>
        <td class="td-interest">
          ${g.product_interest ? escapeHtml(g.product_interest) : '<span class="muted-text">—</span>'}
        </td>
        <td class="td-note">
          ${noteHtml}
          <td class="td-plan-shop">
  ${planShopHtml}
</td>
        </td>
        <td class="col-status">
          <span class="badge ${isUnread ? "badge-unread" : "badge-read"}">
            <span class="emoji-status">${isUnread ? "⏰" : "✅"}</span>
          </span>
        </td>
        <td class="col-action">
          <button class="row-comment-btn ${commentCount > 0 ? "has-comments" : ""}"
                  onclick="openCommentPopup('${g.key}')"
                  title="${commentCount > 0 ? `${commentCount} ความคิดเห็น` : "เพิ่ม Comment"}">
            ${commentBtnContent}
          </button>
        </td>
      </tr>`;
    })
    .join("");
}

// 🆕 Toggle expand/collapse note cell
function toggleNote(btn) {
  if (!btn) return;
  const tr = btn.closest("tr");
  if (!tr) return;
  const cell = tr.querySelector("[data-note-cell]");
  if (!cell) return;

  const isCollapsed = cell.classList.contains("collapsed");
  if (isCollapsed) {
    cell.classList.remove("collapsed");
    btn.classList.add("expanded");
    const labelEl = btn.querySelector("span:not(.material-symbols-outlined)");
    if (labelEl) labelEl.textContent = "ย่อ";
  } else {
    cell.classList.add("collapsed");
    btn.classList.remove("expanded");
    const labelEl = btn.querySelector("span:not(.material-symbols-outlined)");
    if (labelEl) labelEl.textContent = "ดูเพิ่ม";
  }
}

function closeSalesTableModal() {
  const modal = document.getElementById("salesTableModal");
  if (modal) {
    modal.classList.remove("show");
    // ถ้า popup ก็ไม่เปิด → ปลดล็อก scroll
    const popup = document.getElementById("commentPopupModal");
    if (!popup || !popup.classList.contains("show")) {
      document.body.style.overflow = "";
    }
  }
  currentSalesModalId = null;
}

// =====================================================
// 🆕 OPEN COMMENT POPUP (เล็ก ซ้อนบน sales table modal)
// =====================================================
async function openCommentPopup(groupKey) {
  const group = groupedReports.find((g) => g.key === groupKey);
  if (!group) {
    showToast("❌ ไม่พบรายงาน");
    return;
  }

  currentPopupGroupKey = groupKey;
  currentPopupReportId = group.reportIds[0];

  const shopData = shopsMap[group.shop_id];

  // Fill info
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || "—";
  };
  setText("pShopName", shopData?.name || "—");
  setText("pProvince", shopData?.province || "—");
  setText("pReportDate", formatDate(group.report_date || group.submitted_at));

  // Status badge
  const statusBadge = document.getElementById("popupStatus");
  if (statusBadge) {
    statusBadge.className = `badge ${group.manager_acknowledged ? "badge-read" : "badge-unread"}`;
    statusBadge.textContent = group.manager_acknowledged
      ? "✅ อ่านแล้ว"
      : "🕐 ยังไม่อ่าน";
  }

  // Load comments into popup
  await loadCommentsIntoElement(
    group.reportIds,
    document.getElementById("popupCommentsHistory"),
  );

  const input = document.getElementById("popupCommentInput");
  if (input) input.value = "";

  const popup = document.getElementById("commentPopupModal");
  if (popup) {
    popup.classList.add("show");
    document.body.style.overflow = "hidden";
  }
}

function closeCommentPopup() {
  const popup = document.getElementById("commentPopupModal");
  if (popup) popup.classList.remove("show");

  // ถ้า sales modal ยังเปิด → คง scroll lock
  const salesModal = document.getElementById("salesTableModal");
  if (!salesModal || !salesModal.classList.contains("show")) {
    document.body.style.overflow = "";
  }

  currentPopupGroupKey = null;
  currentPopupReportId = null;
}

// =====================================================
// 🆕 SAVE COMMENT (popup version)
// =====================================================
async function savePopupComment() {
  if (isSavingPopupComment) return;
  if (!currentPopupReportId) return;

  const input = document.getElementById("popupCommentInput");
  const text = input?.value?.trim();

  if (!text) {
    showToast("⚠️ กรุณาพิมพ์ความคิดเห็น");
    return;
  }

  isSavingPopupComment = true;

  try {
    const session = await getSessionSafely();
    if (!session?.user?.id) {
      showToast("❌ กรุณาเข้าสู่ระบบใหม่");
      return;
    }

    const { error } = await supabaseClient.from("report_comments").insert([
      {
        report_id: currentPopupReportId,
        manager_id: session.user.id,
        comment: text,
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;

    showToast("💬 บันทึกความคิดเห็นแล้ว");
    input.value = "";

    commentCountsMap[currentPopupReportId] =
      (commentCountsMap[currentPopupReportId] || 0) + 1;

    const group = groupedReports.find((g) => g.key === currentPopupGroupKey);
    if (group) {
      await loadCommentsIntoElement(
        group.reportIds,
        document.getElementById("popupCommentsHistory"),
      );
    }

    if (currentSalesModalId) renderSalesTable(currentSalesModalId);

    await loadReplyCounts(allReports.map((r) => r.id));

    updateSummaryCards();
    renderReports();
  } catch (e) {
    console.error("❌ savePopupComment error:", e);
    showToast("❌ เกิดข้อผิดพลาด: " + e.message);
  } finally {
    isSavingPopupComment = false;
  }
}

// =====================================================
// 🆕 MARK AS READ (popup version)
// =====================================================
async function markPopupAsRead() {
  if (!currentPopupGroupKey) return;

  const group = groupedReports.find((g) => g.key === currentPopupGroupKey);
  if (!group) return;

  try {
    const session = await getSessionSafely();
    if (!session?.user?.id) {
      showToast("❌ กรุณาเข้าสู่ระบบใหม่");
      return;
    }

    const commentInput = document.getElementById("popupCommentInput");
    const text = commentInput?.value?.trim();
    if (text) await savePopupComment();

    const { error } = await supabaseClient
      .from("reports")
      .update({
        manager_acknowledged: true,
        acknowledged_by: session.user.id,
        acknowledged_at: new Date().toISOString(),
      })
      .in("id", group.reportIds);

    if (error) throw error;

    group.manager_acknowledged = true;
    for (const rid of group.reportIds) {
      const r = allReports.find((x) => x.id === rid);
      if (r) r.manager_acknowledged = true;
    }

    const fg = filteredGroups.find((g) => g.key === currentPopupGroupKey);
    if (fg) fg.manager_acknowledged = true;

    showToast("✅ ทำเครื่องหมายว่าอ่านแล้ว");

    updateSummaryCards();
    updateSalesGrid();
    updateSalesQuickPick();
    renderReports();

    // refresh sales table
    if (currentSalesModalId) renderSalesTable(currentSalesModalId);

    closeCommentPopup();
  } catch (e) {
    console.error("❌ markPopupAsRead error:", e);
    showToast("❌ เกิดข้อผิดพลาด: " + e.message);
  }
}

// =====================================================
// 📋 OPEN GROUP MODAL (เดิม - ใช้กับ list view)
// =====================================================
async function openGroupModal(groupKey) {
  const group = groupedReports.find((g) => g.key === groupKey);
  if (!group) {
    showToast("❌ ไม่พบรายงาน");
    return;
  }

  // mark ว่าอ่านแล้ว
  markRepliesAsRead(group.reportIds);

  // refresh badge
  renderReports();

  currentGroupKey = groupKey;
  currentGroupRows = allReports.filter((r) => group.reportIds.includes(r.id));
  currentReportId = group.reportIds[0];

  const profile = profilesMap[group.sale_id];
  const salesName = profile?.display_name || "—";
  const shopData = shopsMap[group.shop_id];

  const modalTitle = document.getElementById("modalTitle");
  if (modalTitle) modalTitle.textContent = `รายงานของ ${salesName}`;

  const statusBadge = document.getElementById("modalStatus");
  if (statusBadge) {
    statusBadge.className = `badge ${group.manager_acknowledged ? "badge-read" : "badge-unread"}`;
    statusBadge.textContent = group.manager_acknowledged
      ? "✅ อ่านแล้ว"
      : "🕐 ยังไม่อ่าน";
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || "—";
  };

  set("mReportDate", formatDate(group.report_date || group.submitted_at));
  set("mSalesName", salesName);
  set("mShopName", shopData?.name || "—");
  set("mProvince", shopData?.province || "—");
  set("mSource", group.source || "—");
  set("mProductInterest", group.product_interest || "—");
  set("mNote", group.note || "ไม่มีหมายเหตุ");

  const productEl = document.getElementById("mProduct");
  if (productEl) {
    if (group.products.length === 0) {
      productEl.innerHTML = '<span style="color:#999;">ไม่มีสินค้า</span>';
    } else {
      productEl.innerHTML = group.products
        .map((p) => {
          const name = productsMap[p.product_id] || "—";
          const attrParts = [];
          if (p.attributes && Object.keys(p.attributes).length) {
            Object.values(p.attributes).forEach((v) => {
              if (v) attrParts.push(v);
            });
          }
          const attrText = attrParts.length
            ? ` <span style="color:#888;font-size:12px;">(${escapeHtml(attrParts.join(", "))})</span>`
            : "";
          return `<div style="padding:2px 0;">• ${escapeHtml(name)}${attrText}</div>`;
        })
        .join("");
    }
  }

  const qtyEl = document.getElementById("mQty");
  if (qtyEl) {
    const totalQty = group.products.reduce(
      (sum, p) => sum + (p.quantity || 0),
      0,
    );
    if (totalQty > 0) {
      qtyEl.textContent = totalQty.toLocaleString("th-TH") + " ชิ้น";
      const row = qtyEl.closest(".info-item");
      if (row) row.style.display = "";
    } else {
      const row = qtyEl.closest(".info-item");
      if (row) row.style.display = "none";
    }
  }

  await loadCommentsForGroup(group.reportIds);

  const commentInput = document.getElementById("commentInput");
  if (commentInput) commentInput.value = "";

  const modal = document.getElementById("reportModal");
  if (modal) {
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
  }
}

function renderCommentText(rawText) {
  const text = String(rawText || "");

  if (!text.startsWith("↳ ตอบกลับ ")) {
    return `
      <div style="
        font-size:13px;
        color:#334155;
        line-height:1.5;
        white-space:pre-wrap;
        word-break:break-word;
        margin-top:4px;
      ">
        ${escapeHtml(text)}
      </div>
    `;
  }

  const lines = text.split("\n");

  const replyLine = lines[0] || "";
  const mainText = lines.slice(1).join("\n");

  return `
    <div style="
      display:flex;
      flex-direction:column;
      gap:8px;
      margin-top:6px;
    ">

      <div style="
        display:inline-flex;
        align-items:center;
        width:fit-content;
        max-width:100%;
        padding:6px 10px;
        border-left:3px solid #94a3b8;
        background:#f8fafc;
        border-radius:8px;
        font-size:12px;
        color:#64748b;
        line-height:1.4;
        word-break:break-word;
      ">
       ${escapeHtml(replyLine)
         .replace("Admin", "<strong style='color:#dc2626;'>Admin</strong>")
         .replace(
           "Executive",
           "<strong style='color:#f59e0b;'>Executive</strong>",
         )
         .replace("Manager", "<strong style='color:#0891b2;'>Manager</strong>")
         .replace("Sale", "<strong style='color:#16a34a;'>Sale</strong>")}
      </div>

      <div style="
        font-size:13px;
        color:#1e293b;
        line-height:1.35;
        white-space:pre-wrap;
        word-break:break-word;
        margin-top:1px;
      ">
        ${escapeHtml(mainText)}
      </div>

    </div>
  `;
}
// =====================================================
// 💬 LOAD COMMENTS — generic (เพิ่ม element target)
// =====================================================
async function loadCommentsIntoElement(reportIds, container) {
  if (!container) return;

  try {
    const { data, error } = await supabaseClient
      .from("report_comments")
      .select(`
  id,
  comment,
  created_at,
  report_id,
  manager_id,
  profiles(display_name, role)
`)
      .in("report_id", reportIds)
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML =
        '<div class="no-comments">ยังไม่มีความคิดเห็น</div>';
      return;
    }

    const seen = new Set();
    const unique = data.filter((c) => {
      const key = `${c.created_at}__${c.comment}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    container.innerHTML = unique
      .map((c) => {
        const role = c.profiles?.role || "manager";
        const displayName = c.profiles?.display_name || "ผู้ใช้";

        let roleBadge, roleClass;
        if (typeof getRoleMeta === "function") {
          const meta = getRoleMeta(role);
          roleBadge = meta.label;
          roleClass = meta.cssClass;
        } else {
          if (role === "admin") {
            roleBadge = "Admin";
            roleClass = "comment-admin";
          } else if (role === "executive") {
            roleBadge = "Executive";
            roleClass = "comment-executive";
          } else if (role === "manager") {
            roleBadge = "Manager";
            roleClass = "comment-manager";
          } else {
            roleBadge = "👤 " + role;
            roleClass = "comment-user";
          }
        }

        const canManage =
  localUser &&
  (
    localUser.id === c.manager_id ||
    ["admin", "executive"].includes(localUser.role)
  );

        return `
<div class="comment-item ${roleClass}">

  <div class="comment-meta">
    <span class="comment-author">${escapeHtml(displayName)}</span>
    <span class="comment-role-badge ${roleClass}">
      ${roleBadge}
    </span>
    <span class="comment-date">
      ${formatDateTime(c.created_at)}
    </span>
  </div>

  <div class="comment-text">
    ${renderCommentText(c.comment)}
  </div>

  ${
    canManage
      ? `
      <div class="comment-actions">
        <button
          class="comment-btn-edit"
          onclick="editComment('${c.id}')">
          แก้ไข
        </button>

        <button
          class="comment-btn-delete"
          onclick="deleteComment('${c.id}')">
          ลบ
        </button>
      </div>
    `
      : ""
  }

</div>`;

      })
      .join("");
  } catch (e) {
    console.error("❌ loadCommentsIntoElement error:", e);
    container.innerHTML =
      '<div class="error-text">เกิดข้อผิดพลาดในการโหลดความคิดเห็น</div>';
  }
}

// เก็บเดิมไว้สำหรับ list view modal
async function loadCommentsForGroup(reportIds) {
  await loadCommentsIntoElement(
    reportIds,
    document.getElementById("commentsHistory"),
  );
}

// =====================================================
// 💬 SAVE COMMENT (เดิม - list view modal)
// =====================================================
async function saveComment() {
  if (isSavingComment) return;
  if (!currentReportId) return;

  const input = document.getElementById("commentInput");
  const text = input?.value?.trim();

  if (!text) {
    showToast("⚠️ กรุณาพิมพ์ความคิดเห็น");
    return;
  }

  isSavingComment = true;

  try {
    const session = await getSessionSafely();
    if (!session?.user?.id) {
      showToast("❌ กรุณาเข้าสู่ระบบใหม่");
      return;
    }

    const { error } = await supabaseClient.from("report_comments").insert([
      {
        report_id: currentReportId,
        manager_id: session.user.id,
        comment: text,
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;

    commentCountsMap[currentReportId] =
      (commentCountsMap[currentReportId] || 0) + 1;

    showToast("💬 บันทึกความคิดเห็นแล้ว");
    input.value = "";

    const group = groupedReports.find((g) => g.key === currentGroupKey);
    if (group) {
      await loadCommentsForGroup(group.reportIds);
    }

    await loadReplyCounts(allReports.map((r) => r.id));

    updateSummaryCards();
    renderReports();
  } catch (e) {
    console.error("❌ saveComment error:", e);
    showToast("❌ เกิดข้อผิดพลาด: " + e.message);
  } finally {
    isSavingComment = false;
  }
}
// =====================================================
// ✅ MARK AS READ (เดิม)
// =====================================================
async function markAsRead() {
  if (!currentGroupKey) return;

  const group = groupedReports.find((g) => g.key === currentGroupKey);
  if (!group) return;

  try {
    const session = await getSessionSafely();
    if (!session?.user?.id) {
      showToast("❌ กรุณาเข้าสู่ระบบใหม่");
      return;
    }

    const commentInput = document.getElementById("commentInput");
    const text = commentInput?.value?.trim();
    if (text) await saveComment();

    const { error } = await supabaseClient
      .from("reports")
      .update({
        manager_acknowledged: true,
        acknowledged_by: session.user.id,
        acknowledged_at: new Date().toISOString(),
      })
      .in("id", group.reportIds);

    if (error) throw error;

    group.manager_acknowledged = true;
    for (const rid of group.reportIds) {
      const r = allReports.find((x) => x.id === rid);
      if (r) r.manager_acknowledged = true;
    }

    const fg = filteredGroups.find((g) => g.key === currentGroupKey);
    if (fg) fg.manager_acknowledged = true;

    showToast("✅ ทำเครื่องหมายว่าอ่านแล้ว");

    updateSummaryCards();
    updateSalesGrid();
    updateSalesQuickPick();
    renderReports();
    closeModal();
  } catch (e) {
    console.error("❌ markAsRead error:", e);
    showToast("❌ เกิดข้อผิดพลาด: " + e.message);
  }
}

// =====================================================
// ✕ CLOSE MODAL (เดิม)
// =====================================================
function closeModal() {
  const modal = document.getElementById("reportModal");
  if (modal) {
    modal.classList.remove("show");
    document.body.style.overflow = "";
  }
  currentGroupKey = null;
  currentGroupRows = [];
  currentReportId = null;
}

// =====================================================
// 📥 EXPORT CSV
// =====================================================
function exportCSV() {
  if (!filteredGroups.length) {
    showToast("⚠️ ไม่มีข้อมูลสำหรับ export");
    return;
  }

  const headers = [
    "วันที่",
    "เซลล์",
    "ร้านค้า",
    "จังหวัด",
    "สินค้า",
    "จำนวนสินค้า",
    "หมายเหตุ",
    "สินค้าที่ร้านแนะนำ",
    "สถานะ",
  ];

  const rows = filteredGroups.map((g) => {
    const shopData = shopsMap[g.shop_id];
    const productNames =
      g.products.map((p) => productsMap[p.product_id] || "—").join(", ") ||
      "ไม่มีสินค้า";

    return [
      formatDate(g.report_date || g.submitted_at),
      profilesMap[g.sale_id]?.display_name || "—",
      shopData?.name || "—",
      shopData?.province || "—",
      productNames,
      g.products.length,
      (g.note || "—").replace(/[\r\n]+/g, " ").replace(/"/g, '""'),
      (g.product_interest || "—").replace(/[\r\n]+/g, " ").replace(/"/g, '""'),
      g.manager_acknowledged ? "อ่านแล้ว" : "ยังไม่อ่าน",
    ];
  });

  const csv =
    "\uFEFF" +
    [
      headers.join(","),
      ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
    ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reports_${formatDateForInput(dateStart)}_${formatDateForInput(dateEnd)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast("📥 Export สำเร็จ");
}

// =====================================================
// 🔧 SETUP EVENT LISTENERS
// =====================================================
function setupEventListeners() {
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyFilter();
    });
  }

  const modal = document.getElementById("reportModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // 🆕 sales table modal — click outside to close
  const salesModal = document.getElementById("salesTableModal");
  if (salesModal) {
    salesModal.addEventListener("click", (e) => {
      if (e.target === salesModal) closeSalesTableModal();
    });
  }

  // 🆕 comment popup — click outside to close
  const popup = document.getElementById("commentPopupModal");
  if (popup) {
    popup.addEventListener("click", (e) => {
      if (e.target === popup) closeCommentPopup();
    });
  }

  // ESC key — close topmost modal first
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const popupOpen = document
      .getElementById("commentPopupModal")
      ?.classList.contains("show");
    const salesOpen = document
      .getElementById("salesTableModal")
      ?.classList.contains("show");
    const detailOpen = document
      .getElementById("reportModal")
      ?.classList.contains("show");

    if (popupOpen) closeCommentPopup();
    else if (salesOpen) closeSalesTableModal();
    else if (detailOpen) closeModal();
  });
}

// =====================================================
// 🚪 SETUP LOGOUT
// =====================================================
function setupLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      window.location.href = "/pages/auth/login.html";
    });
  }
}

// =====================================================
// 🔧 HELPERS
// =====================================================
function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("th-TH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (e) {
    return "—";
  }
}

function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
    });
  } catch (e) {
    return "—";
  }
}

function formatWeekday(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("th-TH", { weekday: "short" });
  } catch (e) {
    return "";
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "—";
  }
}

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

async function logout() {
  try {
    await supabaseClient.auth.signOut();
    window.location.href = "/pages/auth/login.html";
  } catch (e) {
    window.location.href = "/pages/auth/login.html";
  }
}





async function editComment(commentId) {
  const { data, error } = await supabaseClient
    .from("report_comments")
    .select("comment")
    .eq("id", commentId)
    .single();

  if (error || !data) {
    showToast("❌ ไม่พบความคิดเห็น");
    return;
  }

  const newText = prompt(
    "แก้ไขความคิดเห็น",
    data.comment || ""
  );

  if (newText === null) return;

  const { error: updateError } = await supabaseClient
    .from("report_comments")
    .update({
      comment: newText.trim()
    })
    .eq("id", commentId);

  if (updateError) {
    showToast("❌ แก้ไขไม่สำเร็จ");
    return;
  }

  showToast("✅ แก้ไขแล้ว");

  refreshComments();
}





async function deleteComment(commentId) {
  if (!confirm("ต้องการลบความคิดเห็นนี้ใช่หรือไม่")) return;

  const { data, error } = await supabaseClient
    .from("report_comments")
    .delete()
    .eq("id", commentId)
    .select("id");

  if (error) {
    console.error("deleteComment error:", error);
    showToast("❌ ลบไม่สำเร็จ: " + error.message);
    return;
  }

  if (!data || data.length === 0) {
    showToast("⚠️ ไม่มีสิทธิ์ลบ หรือไม่พบความคิดเห็นนี้");
    return;
  }

  showToast("✅ ลบความคิดเห็นแล้ว");

  await refreshComments();
}





async function refreshComments() {

  if (currentPopupGroupKey) {
    const group = groupedReports.find(
      g => g.key === currentPopupGroupKey
    );

    if (group) {
      await loadCommentsIntoElement(
        group.reportIds,
        document.getElementById("popupCommentsHistory")
      );
    }
  }

  if (currentGroupKey) {
    const group = groupedReports.find(
      g => g.key === currentGroupKey
    );

    if (group) {
      await loadCommentsForGroup(group.reportIds);
    }
  }

  await loadCommentCounts(
    allReports.map(r => r.id)
  );

  renderReports();
  updateSummaryCards();
updateSalesGrid();
updateSalesQuickPick();

  if (currentSalesModalId) {
    renderSalesTable(currentSalesModalId);
  }
}


// =====================================================
// 🌐 GLOBAL FUNCTIONS
// =====================================================
window.filterBySale = filterBySale;
window.filterByManager = filterByManager;
window.applyFilter = applyFilter;
window.resetFilter = resetFilter;
window.goToPage = goToPage;
window.openGroupModal = openGroupModal;
window.saveComment = saveComment;
window.markAsRead = markAsRead;
window.closeModal = closeModal;
window.exportCSV = exportCSV;
window.loadReports = loadReports;
window.logout = logout;

// 🆕
window.openSalesTableModal = openSalesTableModal;
window.closeSalesTableModal = closeSalesTableModal;
window.openCommentPopup = openCommentPopup;
window.closeCommentPopup = closeCommentPopup;
window.savePopupComment = savePopupComment;
window.markPopupAsRead = markPopupAsRead;
window.switchView = switchView;
window.toggleNote = toggleNote;
ซไๆ