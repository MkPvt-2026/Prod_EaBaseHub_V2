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
        await protectPage(["admin", "executive", "manager", "marketing"]);
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
    await loadAllTripRounds();

    setupEventListeners();
    setupLogout();
    applyUrlFilters();

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
      clearTripRound();
      updateDateRangeLabel();
      clearQuickRangeActive();
      loadReports();
    });
  }

  if (endInput) {
    endInput.addEventListener("change", () => {
      dateEnd = new Date(endInput.value);
      dateEnd.setHours(23, 59, 59, 999);
      clearTripRound();
      updateDateRangeLabel();
      clearQuickRangeActive();
      loadReports();
    });
  }

  document.querySelectorAll(".quick-range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearTripRound();
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
  // ใช้วันที่ตามเวลาท้องถิ่น (toISOString เป็น UTC → ไทย +7 จะเลื่อนไป 1 วัน)
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
      selectSales.innerHTML = '<option value="">เซลล์: ทั้งหมด</option>';
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
      // เลือกรอบทริปอยู่ → กรองตามช่วงของเซลล์แต่ละคน
      if (activeTripRound) return isReportInActiveRange(r);
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
    updateSalesQuickPick();
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

  // รายชื่อเซลล์แบบแถวกะทัดรัด (คอลัมน์ซ้าย) — คลิกแถว = กรองรายการ, ปุ่มตาราง = เปิดตารางทั้งหมดของเซลล์
  const rows = salesEntries
    .map(([id, profile]) => {
      const groups = groupedReports.filter((g) => g.sale_id === id);
      return {
        id,
        name: profile.display_name || "—",
        area: profile.area || "",
        total: groups.length,
        unread: groups.filter((g) => !g.manager_acknowledged).length,
      };
    })
    .sort((a, b) => b.unread - a.unread || b.total - a.total || a.name.localeCompare(b.name, "th"));

  const totalAll = groupedReports.length;
  const unreadAll = groupedReports.filter((g) => !g.manager_acknowledged).length;

  grid.innerHTML =
    `<div class="sales-card rt-team-row ${!activeSalesFilter ? "active" : ""}"
          onclick="filterBySale(null)" title="แสดงทุกคน">
       <div class="sales-avatar rt-avatar-all"><span class="material-symbols-outlined">groups</span></div>
       <div class="rt-team-name">ทุกคน</div>
       <span class="rt-count">${totalAll}</span>
       <span class="rt-unread ${unreadAll ? "" : "zero"}" title="ยังไม่อ่าน">${unreadAll}</span>
       <span class="rt-row-gap"></span>
     </div>` +
    rows
      .map((r) => `
      <div class="sales-card rt-team-row ${activeSalesFilter === r.id ? "active" : ""} ${r.total === 0 ? "is-empty" : ""}"
           onclick="filterBySale('${r.id}')"
           title="กรองรายการของ ${escapeHtml(r.name)}${r.area ? " · " + escapeHtml(r.area) : ""}">
        <div class="sales-avatar">${escapeHtml(r.name.charAt(0).toUpperCase())}</div>
        <div class="rt-team-name">${escapeHtml(r.name)}${r.area ? `<small>${escapeHtml(r.area)}</small>` : ""}</div>
        <span class="rt-count" title="จำนวนร้านที่เข้า">${r.total}</span>
        <span class="rt-unread ${r.unread ? "" : "zero"}" title="ยังไม่อ่าน">${r.unread}</span>
        <button class="sales-filter-btn rt-open-table"
                onclick="event.stopPropagation(); openSalesTableModal('${r.id}')"
                title="เปิดตารางรายงานทั้งหมดของ ${escapeHtml(r.name)}">
          <span class="material-symbols-outlined icon-sm">open_in_full</span>
        </button>
      </div>`)
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
  if (!saleId || activeSalesFilter === saleId) {
    activeSalesFilter = null;
    document.getElementById("filterSales").value = "";
  } else {
    activeSalesFilter = saleId;
    document.getElementById("filterSales").value = saleId;
  }
  switchView("list");
  updateSalesGrid();
  applyFilter();

  // เลื่อนไปที่รายการเฉพาะเมื่อรายการอยู่นอกจอ (เช่น จอแคบที่คอลัมน์ซ้อนกัน)
  const listEl = document.getElementById("listView");
  if (listEl) {
    const top = listEl.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.8 || top < 0) {
      listEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
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

  // sync สถานะ UI (เซลล์ที่เลือก + การ์ด KPI)
  if ((activeSalesFilter || "") !== salesId) {
    activeSalesFilter = salesId || null;
    updateSalesGrid();
  }
  document.querySelectorAll(".rt-kpi").forEach((k) => {
    k.classList.toggle("active", (k.dataset.status || "") === status && (status !== "" || !salesId && !search));
  });
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
  document.querySelectorAll(".rt-kpi").forEach((k) => k.classList.toggle("active", !k.dataset.status));
}

// =====================================================
// 🎨 RENDER REPORTS — list view
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
        <span class="material-symbols-outlined icon-sm icon-blue">chat_bubble</span>
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
        <span class="material-symbols-outlined icon-sm">reply</span>
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
            <span class="emoji-status">${isUnread ? "⏰" : "✅"}</span>
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
// =====================================================
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
// 🆕 OPEN SALES TABLE MODAL
// =====================================================
async function openSalesTableModal(saleId) {
  const profile = profilesMap[saleId];
  if (!profile) {
    showToast("❌ ไม่พบข้อมูลเซลล์");
    return;
  }

  currentSalesModalId = saleId;
  const displayName = profile.display_name || "—";

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

  await loadTripPlansForSale(saleId);
  populateSalesTripRounds(saleId);
  switchSalesModalTab("visits");
  renderSalesTable(saleId);

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

// =====================================================
// 🆕 RENDER SALES TABLE
// =====================================================
function renderSalesTable(saleId) {
  const tbody = document.getElementById("salesTableBody");
  if (!tbody) return;

  const groups = groupedReports
    .filter((g) => g.sale_id === saleId)
    .sort((a, b) => {
      const da = new Date(a.report_date || a.submitted_at || a.created_at || 0);
      const db = new Date(b.report_date || b.submitted_at || b.created_at || 0);
      return da - db;
    });

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

      let noteHtml;
      if (!g.note) {
        noteHtml = `<div class="note-cell"><span class="muted-text">—</span></div>`;
      } else {
        const noteText = String(g.note);
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
        </td>
        <td class="td-plan-shop">
          ${planShopHtml}
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
    const popup = document.getElementById("commentPopupModal");
    if (!popup || !popup.classList.contains("show")) {
      document.body.style.overflow = "";
    }
  }
  currentSalesModalId = null;
}

// =====================================================
// 🆕 OPEN COMMENT POPUP
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

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || "—";
  };
  setText("pShopName", shopData?.name || "—");
  setText("pProvince", shopData?.province || "—");
  setText("pReportDate", formatDate(group.report_date || group.submitted_at));

  const statusBadge = document.getElementById("popupStatus");
  if (statusBadge) {
    statusBadge.className = `badge ${group.manager_acknowledged ? "badge-read" : "badge-unread"}`;
    statusBadge.textContent = group.manager_acknowledged
      ? "✅ อ่านแล้ว"
      : "🕐 ยังไม่อ่าน";
  }

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

    if (currentSalesModalId) renderSalesTable(currentSalesModalId);

    closeCommentPopup();
  } catch (e) {
    console.error("❌ markPopupAsRead error:", e);
    showToast("❌ เกิดข้อผิดพลาด: " + e.message);
  }
}

// =====================================================
// 📋 OPEN GROUP MODAL (list view)
// =====================================================
async function openGroupModal(groupKey) {
  const group = groupedReports.find((g) => g.key === groupKey);
  if (!group) {
    showToast("❌ ไม่พบรายงาน");
    return;
  }

  markRepliesAsRead(group.reportIds);
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
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
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
          .replace("Executive", "<strong style='color:#f59e0b;'>Executive</strong>")
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
// 💬 LOAD COMMENTS — generic
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
    <span class="comment-role-badge ${roleClass}">${roleBadge}</span>
    <span class="comment-date">${formatDateTime(c.created_at)}</span>
  </div>
  <div class="comment-text">
    ${renderCommentText(c.comment)}
  </div>
  ${
    canManage
      ? `
    <div class="comment-actions">
      <button class="comment-btn-edit" onclick="editComment('${c.id}')">แก้ไข</button>
      <button class="comment-btn-delete" onclick="deleteComment('${c.id}')">ลบ</button>
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

async function loadCommentsForGroup(reportIds) {
  await loadCommentsIntoElement(
    reportIds,
    document.getElementById("commentsHistory"),
  );
}

// =====================================================
// 💬 SAVE COMMENT (list view modal)
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
// ✅ MARK AS READ (list view modal)
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
// ✕ CLOSE MODAL (list view)
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
// 📊 EXPORT HELPERS
// =====================================================
function getSalesExportGroups() {
  if (!currentSalesModalId) {
    showToast("⚠️ กรุณาเลือกเซลล์ก่อน Export");
    return [];
  }

  return groupedReports
    .filter((g) => g.sale_id === currentSalesModalId)
    .sort((a, b) => {
      const da = new Date(a.report_date || a.submitted_at || a.created_at || 0);
      const db = new Date(b.report_date || b.submitted_at || b.created_at || 0);
      return da - db;
    });
}

function getPlanShopText(reportDate) {
  const dateKey = getDateKey(reportDate);
  const shops = tripPlanMap[dateKey] || [];
  return shops.length ? shops.join(" / ") : "—";
}

function getExportSummary(groups) {
  const provinces = new Set(
    groups.map((g) => shopsMap[g.shop_id]?.province).filter(Boolean),
  );
  const hasNote = groups.filter((g) => g.note && String(g.note).trim()).length;
  const planCount = groups.filter((g) => {
    const dateKey = getDateKey(g.report_date || g.submitted_at);
    return (tripPlanMap[dateKey] || []).length > 0;
  }).length;

  return {
    total: groups.length,
    provinces: provinces.size,
    note: hasNote,
    plan: planCount,
  };
}

function getReportRangeText() {
  return `${formatDate(dateStart)} - ${formatDate(dateEnd)}`;
}

function getPrintDateText() {
  return formatDate(new Date());
}

// =====================================================
// 🖨️ GENERATE HTML REPORT (shared by PDF & Print)
// =====================================================
function generateSalesVisitReportHTML(options = {}) {
  const groups = getSalesExportGroups();
  const profile = profilesMap[currentSalesModalId];
  const salesName = profile?.display_name || "—";
  const summary = getExportSummary(groups);
  const autoPrint = options.autoPrint === true;

  const rowsHtml = groups
    .map((g) => {
      const shop = shopsMap[g.shop_id];
      return `
        <tr>
          <td>${formatDateShort(g.report_date || g.submitted_at)}</td>
          <td>${escapeHtml(shop?.name || "—")}</td>
          <td>${escapeHtml(shop?.province || "—")}</td>
          <td>${escapeHtml(g.note || "—")}</td>
          <td>${escapeHtml(getPlanShopText(g.report_date || g.submitted_at))}</td>
        </tr>
      `;
    })
    .join("");

  return `
<!doctype html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>รายงานเข้าร้านค้า</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 7mm 9mm; }
  * { box-sizing: border-box; }

  /* ── Screen: grey canvas + paper card ── */
  body {
    font-family: "Kanit", sans-serif;
    margin: 0;
    color: #111827;
    background: #cbd5e1;
    min-height: 100vh;
  }

  /* Sticky toolbar above the paper */
  .no-print-toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 20px;
    background: #1e293b;
    box-shadow: 0 2px 6px rgba(0,0,0,.35);
  }
  .toolbar-btn {
    border: none;
    background: #2563eb;
    color: #fff;
    border-radius: 8px;
    padding: 7px 18px;
    font-family: "Kanit", sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }
  .toolbar-btn:hover { background: #1d4ed8; }
  .toolbar-btn.close-btn { background: #475569; }
  .toolbar-btn.close-btn:hover { background: #334155; }

  /* Paper wrapper — centres the A4 sheet on screen */
  .paper-wrap {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 32px 24px 48px;
  }

  /* A4 landscape sheet: 297 × 210 mm */
  .page {
    width: 297mm;
    min-height: 210mm;
    background: #ffffff;
    box-shadow: 0 4px 24px rgba(0,0,0,.28);
    border-radius: 3px;
    padding: 9mm 10mm 9mm;
  }

  h1 { text-align: center; font-size: 22px; line-height: 1; margin: 0 0 10px; font-weight: 700; color: #111827; }
  .top { display: grid; grid-template-columns: 1fr 1.2fr 1fr; font-size: 11px; margin-bottom: 8px; color: #111827; }
  .right { text-align: right; }
  .blue-line { border-top: 2px solid #1e3a8a; margin: 6px 0 10px; }
  .summary { display: grid; grid-template-columns: 1.1fr 1fr 1fr 1fr 1.2fr; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; }
  .summary-title { font-size: 15px; font-weight: 700; color: #1e3a8a; }
  .summary-item { text-align: center; border-right: 1px solid #94a3b8; white-space: nowrap; }
  .summary-item:last-child { border-right: none; }
  .num { font-size: 19px; font-weight: 700; color: #1e3a8a; padding: 0 4px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5px; }
  th { background: #0b3b91; color: #ffffff; border: 1px solid #d1d5db; padding: 4px 5px; font-weight: 600; text-align: center; }
  td { border: 1px solid #d1d5db; padding: 3px 5px; vertical-align: top; line-height: 1.22; height: 18px; overflow-wrap: anywhere; }
  th:nth-child(1), td:nth-child(1) { width: 11%; text-align: center; }
  th:nth-child(2), td:nth-child(2) { width: 21%; }
  th:nth-child(3), td:nth-child(3) { width: 11%; text-align: center; }
  th:nth-child(4), td:nth-child(4) { width: 28%; }
  th:nth-child(5), td:nth-child(5) { width: 29%; }
  .note { margin-top: 8px; font-size: 9.5px; color: #1e3a8a; font-weight: 500; }

  /* ── Print: remove chrome, output bare A4 ── */
  @media print {
    body { background: #ffffff; min-height: unset; }
    .no-print-toolbar { display: none !important; }
    .paper-wrap { display: block; padding: 0; }
    .page {
      width: 100%;
      min-height: unset;
      box-shadow: none;
      border-radius: 0;
      padding: 0;
    }
    tr { page-break-inside: avoid; }
    table { page-break-inside: auto; }
    thead { display: table-header-group; }
  }
</style>
</head>
<body>
  <div class="no-print-toolbar">
    <button class="toolbar-btn" onclick="window.print()">🖨️ พิมพ์</button>
    <button class="toolbar-btn close-btn" onclick="window.close()">✕ ปิด</button>
  </div>
  <div class="paper-wrap">
  <div class="page">
    <h1>รายงานเข้าร้านค้า (สรุป)</h1>
    <div class="top">
      <div>ชื่อเซลล์ : ${escapeHtml(salesName)}</div>
      <div>ช่วงรายงาน : ${getReportRangeText()}</div>
      <div class="right">วันที่พิมพ์ : ${getPrintDateText()}</div>
    </div>
    <div class="blue-line"></div>
    <div class="summary">
      <div class="summary-title">สรุปภาพรวม</div>
      <div class="summary-item">เข้าร้านทั้งหมด <span class="num">${summary.total}</span> ร้าน</div>
      <div class="summary-item">จังหวัด <span class="num">${summary.provinces}</span> จังหวัด</div>
      <div class="summary-item">มีหมายเหตุ <span class="num">${summary.note}</span> ร้าน</div>
      <div class="summary-item">ร้านตามแผน (Trip) <span class="num">${summary.plan}</span> ร้าน</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>วันที่เข้า</th>
          <th>ร้านค้า</th>
          <th>จังหวัด</th>
          <th>หมายเหตุ</th>
          <th>ร้านตามแผน (Trip)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="note">
      หมายเหตุ: รายงานนี้เป็นข้อมูลสรุปการเข้าร้านค้า เฉพาะร้านที่มีการเข้าร้านในช่วงเวลาที่เลือก
    </div>
  </div>
  </div>
  ${autoPrint ? `<script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>` : ""}
</body>
</html>
`;
}

// =====================================================
// 📄 EXPORT PDF (เปิดหน้าใหม่ + ปุ่มพิมพ์/ปิด)
// =====================================================
function exportSalesVisitPDF() {
  const groups = getSalesExportGroups();

  if (!groups.length) {
    showToast("⚠️ ไม่มีข้อมูลสำหรับ Export");
    return;
  }

  const win = window.open("", "_blank");

  if (!win) {
    showToast("⚠️ Browser บล็อก popup กรุณาอนุญาต popup ก่อน");
    return;
  }

  win.document.open();
  win.document.write(generateSalesVisitReportHTML({ autoPrint: false }));
  win.document.close();

  showToast("✅ เปิดหน้า Export PDF แล้ว");
}

// =====================================================
// 🖨️ PRINT (เปิดหน้าใหม่ + print อัตโนมัติ)
// =====================================================
function printSalesVisitReport() {
  const groups = getSalesExportGroups();

  if (!groups.length) {
    showToast("⚠️ ไม่มีข้อมูลสำหรับพิมพ์");
    return;
  }

  const win = window.open("", "_blank");

  if (!win) {
    showToast("⚠️ Browser บล็อก popup กรุณาอนุญาต popup ก่อน");
    return;
  }

  win.document.open();
  win.document.write(generateSalesVisitReportHTML({ autoPrint: true }));
  win.document.close();

  showToast("🖨️ เปิดหน้าพิมพ์แล้ว");
}

// =====================================================
// 📊 EXPORT EXCEL
// =====================================================
function exportSalesVisitExcel() {
  const groups = getSalesExportGroups();

  if (!groups.length) {
    showToast("⚠️ ไม่มีข้อมูลสำหรับ Export Excel");
    return;
  }

  const profile = profilesMap[currentSalesModalId];
  const salesName = profile?.display_name || "—";

  const tableRows = groups
    .map((g) => {
      const shop = shopsMap[g.shop_id];
      return `
        <tr>
          <td>${formatDateShort(g.report_date || g.submitted_at)}</td>
          <td>${escapeHtml(shop?.name || "—")}</td>
          <td>${escapeHtml(shop?.province || "—")}</td>
          <td>${escapeHtml(g.note || "—")}</td>
          <td>${escapeHtml(getPlanShopText(g.report_date || g.submitted_at))}</td>
        </tr>
      `;
    })
    .join("");

  const excelHtml = `
    <html>
    <head><meta charset="UTF-8"></head>
    <body>
      <table border="1">
        <tr><th colspan="5">รายงานเข้าร้านค้า (สรุป)</th></tr>
        <tr><td colspan="5">ชื่อเซลล์ : ${escapeHtml(salesName)}</td></tr>
        <tr><td colspan="5">ช่วงรายงาน : ${getReportRangeText()}</td></tr>
        <tr>
          <th>วันที่เข้า</th>
          <th>ร้านค้า</th>
          <th>จังหวัด</th>
          <th>หมายเหตุ</th>
          <th>ร้านตามแผน (Trip)</th>
        </tr>
        ${tableRows}
      </table>
    </body>
    </html>
  `;

  const blob = new Blob(["\uFEFF" + excelHtml], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `รายงานเข้าร้านค้า_${salesName}_${formatDateForInput(dateStart)}_${formatDateForInput(dateEnd)}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("✅ Export Excel สำเร็จ");
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
    // กรองทันทีขณะพิมพ์ (หน่วง 250ms)
    let t = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(applyFilter, 250);
    });
  }

  // เปลี่ยนตัวเลือกแล้วกรองทันที
  ["filterSales", "filterStatus"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", applyFilter);
  });

  // คลิกการ์ด KPI = กรองตามสถานะ
  document.querySelectorAll(".rt-kpi").forEach((k) => {
    k.addEventListener("click", () => {
      const st = document.getElementById("filterStatus");
      if (st) st.value = k.dataset.status || "";
      applyFilter();
    });
  });

  // ปิดเมนู "เอกสาร / ส่งออก" เมื่อคลิกนอกเมนู
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.rt-menu[open]").forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });

  const modal = document.getElementById("reportModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  const salesModal = document.getElementById("salesTableModal");
  if (salesModal) {
    salesModal.addEventListener("click", (e) => {
      if (e.target === salesModal) closeSalesTableModal();
    });
  }

  const popup = document.getElementById("commentPopupModal");
  if (popup) {
    popup.addEventListener("click", (e) => {
      if (e.target === popup) closeCommentPopup();
    });
  }

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

// =====================================================
// ✏️ EDIT / DELETE COMMENT
// =====================================================
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

  const newText = prompt("แก้ไขความคิดเห็น", data.comment || "");
  if (newText === null) return;

  const { error: updateError } = await supabaseClient
    .from("report_comments")
    .update({ comment: newText.trim() })
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
    const group = groupedReports.find((g) => g.key === currentPopupGroupKey);
    if (group) {
      await loadCommentsIntoElement(
        group.reportIds,
        document.getElementById("popupCommentsHistory"),
      );
    }
  }

  if (currentGroupKey) {
    const group = groupedReports.find((g) => g.key === currentGroupKey);
    if (group) {
      await loadCommentsForGroup(group.reportIds);
    }
  }

  await loadCommentCounts(allReports.map((r) => r.id));

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

window.openSalesTableModal = openSalesTableModal;
window.closeSalesTableModal = closeSalesTableModal;
window.openCommentPopup = openCommentPopup;
window.closeCommentPopup = closeCommentPopup;
window.savePopupComment = savePopupComment;
window.markPopupAsRead = markPopupAsRead;
window.switchView = switchView;
window.toggleNote = toggleNote;

window.exportSalesVisitPDF = exportSalesVisitPDF;
window.printSalesVisitReport = printSalesVisitReport;
window.exportSalesVisitExcel = exportSalesVisitExcel;

// =====================================================
// 🗺️ FORM PLAN & FORM ACTUAL INTEGRATION
// =====================================================

function switchSalesModalTab(tabName) {
  const visitBtn = document.getElementById("tabVisitBtn");
  const planBtn = document.getElementById("tabPlanBtn");
  const actualBtn = document.getElementById("tabActualBtn");

  const visitTab = document.getElementById("salesTabVisits");
  const planTab = document.getElementById("salesTabPlan");
  const actualTab = document.getElementById("salesTabActual");

  [visitBtn, planBtn, actualBtn].forEach((btn) => btn?.classList.remove("active"));
  [visitTab, planTab, actualTab].forEach((p) => p?.classList.remove("active"));

  if (tabName === "visits") {
    visitBtn?.classList.add("active");
    visitTab?.classList.add("active");
  } else if (tabName === "plan") {
    planBtn?.classList.add("active");
    planTab?.classList.add("active");
    if (currentSalesModalId) {
      loadSalesFormPlans(currentSalesModalId);
    }
  } else if (tabName === "actual") {
    actualBtn?.classList.add("active");
    actualTab?.classList.add("active");
    if (currentSalesModalId) {
      loadSalesFormActuals(currentSalesModalId);
    }
  }
}

let currentFormDetailRef = null;
let allTripRoundsList = [];

async function loadSalesFormPlans(salesId, rStart, rEnd) {
  const tbody = document.getElementById("salesPlanTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="loading">กำลังโหลดแผนการเดินทาง...</td></tr>`;

  try {
    let query = supabaseClient.from("trips").select("*").eq("user_id", salesId);
    if (rStart && rEnd) {
      query = query.gte("start_date", rStart).lte("end_date", rEnd);
    } else {
      if (dateStart) query = query.gte("start_date", formatDateForInput(dateStart));
      if (dateEnd) query = query.lte("end_date", formatDateForInput(dateEnd));
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">ไม่พบข้อมูลแผนการเดินทางในช่วงเวลานี้</td></tr>`;
      return;
    }

    const fmtD = (d) =>
      d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";

    tbody.innerHTML = data
      .map((item) => {
        let rows = [];
        let expense = null;
        if (Array.isArray(item.trips)) {
          rows = item.trips;
        } else if (item.trips && typeof item.trips === "object") {
          rows = item.trips.rows || [];
          expense = item.trips.expense || null;
        }

        const routesText =
          rows
            .map((r) => {
              const shops = [r.shop1, r.shop2, r.shop3].filter(
                (s) => s && s.trim() && s !== "ชื่อร้าน" && s !== "-",
              );
              const prov = [r.from, r.to].filter(
                (p) => p && p.trim() && p !== "จังหวัด" && p !== "-",
              );
              return `📍 ${fmtD(r.date)}: ${prov.join(" → ")} ${shops.length > 0 ? `(${shops.join(", ")})` : ""}`;
            })
            .join("<br>") || "ไม่ระบุเส้นทาง";

        let estTotal = 0;
        if (expense) {
          estTotal =
            (expense.allowance_rate || 0) * (expense.allowance_days || 0) +
            (expense.hotel_rate || 0) * (expense.hotel_nights || 0) +
            (expense.other_cost || 0);
        }

        const statusClass = item.status === "completed" ? "badge-status-completed" : "badge-status-draft";
        const statusText = item.status === "completed" ? "สมบูรณ์" : "ร่าง/รออนุมัติ";

        return `
          <tr>
            <td>${fmtD(item.created_at)}</td>
            <td>${fmtD(item.start_date)} - ${fmtD(item.end_date)}</td>
            <td>${routesText}</td>
            <td class="amount-text">${estTotal > 0 ? estTotal.toLocaleString("th-TH") + " บาท" : "-"}</td>
            <td><span class="badge-status ${statusClass}">${statusText}</span></td>
            <td style="display:flex;gap:4px;align-items:center;">
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="viewFormDetail('plan', '${item.id}')">
                <span class="material-symbols-outlined icon-sm">visibility</span> ดู
              </button>
              <button class="btn btn-primary" style="padding:4px 8px;font-size:12px;" onclick="printFormPlanById('${item.id}')">
                <span class="material-symbols-outlined icon-white icon-sm">print</span> พิมพ์ A4
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("loadSalesFormPlans error:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="color:red;text-align:center;">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

async function loadSalesFormActuals(salesId, rStart, rEnd) {
  const tbody = document.getElementById("salesActualTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="loading">กำลังโหลดข้อมูลการเบิกจ่าย...</td></tr>`;

  try {
    let query = supabaseClient.from("actuals").select("*").eq("user_id", salesId);
    if (rStart && rEnd) {
      query = query.gte("start_date", rStart).lte("end_date", rEnd);
    } else {
      if (dateStart) query = query.gte("start_date", formatDateForInput(dateStart));
      if (dateEnd) query = query.lte("end_date", formatDateForInput(dateEnd));
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">ไม่พบข้อมูลเคลียร์ค่าใช้จ่ายในช่วงเวลานี้</td></tr>`;
      return;
    }

    const fmtD = (d) =>
      d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";

    tbody.innerHTML = data
      .map((item) => {
        const rows = Array.isArray(item.rows) ? item.rows : [];
        const routesText =
          rows.map((r) => `🚘 ${fmtD(r.date)}: ${r.route || "-"} ${r.note ? `(${r.note})` : ""}`).join("<br>") ||
          "ไม่ระบุรายการ";

        const totalAmt = item.grand_total ? Number(item.grand_total).toLocaleString("th-TH") + " บาท" : "-";
        const statusClass = item.status === "completed" ? "badge-status-completed" : "badge-status-draft";
        const statusText = item.status === "completed" ? "อนุมัติ/เคลียร์แล้ว" : "รอดำเนินการ";

        return `
          <tr>
            <td>${fmtD(item.created_at)}</td>
            <td>${fmtD(item.start_date)} - ${fmtD(item.end_date)}</td>
            <td>${routesText}</td>
            <td class="amount-text">${totalAmt}</td>
            <td><span class="badge-status ${statusClass}">${statusText}</span></td>
            <td style="display:flex;gap:4px;align-items:center;">
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="viewFormDetail('actual', '${item.id}')">
                <span class="material-symbols-outlined icon-sm">visibility</span> ดู
              </button>
              <button class="btn btn-primary" style="padding:4px 8px;font-size:12px;" onclick="printFormActualById('${item.id}')">
                <span class="material-symbols-outlined icon-white icon-sm">print</span> พิมพ์ A4
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("loadSalesFormActuals error:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="color:red;text-align:center;">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

async function openFormPlanOverviewModal() {
  const modal = document.getElementById("formPlanOverviewModal");
  const tbody = document.getElementById("formPlanOverviewBody");
  if (modal) modal.classList.add("show");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="loading">กำลังโหลดข้อมูลแผนเดินทาง...</td></tr>`;

  try {
    let query = supabaseClient.from("trips").select("*");
    if (activeTripRound) {
      query = query.gte("start_date", activeTripRound.minStart).lte("end_date", activeTripRound.maxEnd);
    } else {
      if (dateStart) query = query.gte("start_date", formatDateForInput(dateStart));
      if (dateEnd) query = query.lte("end_date", formatDateForInput(dateEnd));
    }

    let { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    // เลือกรอบทริปอยู่ → เอาเฉพาะเอกสารที่อยู่ในรอบนั้น
    if (activeTripRound && data) {
      data = data.filter((x) => getTripRoundKey(x.start_date, x.end_date) === activeTripRound.key);
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8;">ไม่พบข้อมูลแผนการเดินทาง</td></tr>`;
      return;
    }

    const fmtD = (d) =>
      d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";

    tbody.innerHTML = data
      .map((item) => {
        const profile = profilesMap[item.user_id];
        const salesName = item.user_name || profile?.display_name || "ไม่ทราบชื่อ";
        let rows = [];
        let expense = null;
        if (Array.isArray(item.trips)) {
          rows = item.trips;
        } else if (item.trips && typeof item.trips === "object") {
          rows = item.trips.rows || [];
          expense = item.trips.expense || null;
        }

        const routesText =
          rows
            .slice(0, 3)
            .map((r) => {
              const shops = [r.shop1, r.shop2, r.shop3].filter(
                (s) => s && s.trim() && s !== "ชื่อร้าน" && s !== "-",
              );
              return `📍 ${fmtD(r.date)}: ${[r.from, r.to].filter(Boolean).join("→")} ${shops.length > 0 ? `(${shops.join(",")})` : ""}`;
            })
            .join("<br>") + (rows.length > 3 ? `<br><small style="color:#64748b">+ อีก ${rows.length - 3} รายการ</small>` : "");

        let estTotal = 0;
        if (expense) {
          estTotal =
            (expense.allowance_rate || 0) * (expense.allowance_days || 0) +
            (expense.hotel_rate || 0) * (expense.hotel_nights || 0) +
            (expense.other_cost || 0);
        }

        const statusClass = item.status === "completed" ? "badge-status-completed" : "badge-status-draft";
        const statusText = item.status === "completed" ? "สมบูรณ์" : "ร่าง/รออนุมัติ";

        return `
          <tr>
            <td><strong>${escapeHtml(salesName)}</strong></td>
            <td>${fmtD(item.created_at)}</td>
            <td>${fmtD(item.start_date)} - ${fmtD(item.end_date)}</td>
            <td>${routesText}</td>
            <td class="amount-text">${estTotal > 0 ? estTotal.toLocaleString("th-TH") + " บาท" : "-"}</td>
            <td><span class="badge-status ${statusClass}">${statusText}</span></td>
            <td style="display:flex;gap:4px;align-items:center;">
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="viewFormDetail('plan', '${item.id}')">
                <span class="material-symbols-outlined icon-sm">visibility</span> ดู
              </button>
              <button class="btn btn-primary" style="padding:4px 8px;font-size:12px;" onclick="printFormPlanById('${item.id}')">
                <span class="material-symbols-outlined icon-white icon-sm">print</span> พิมพ์ A4
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("openFormPlanOverviewModal error:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="color:red;text-align:center;">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

function closeFormPlanOverviewModal() {
  const modal = document.getElementById("formPlanOverviewModal");
  if (modal) modal.classList.remove("show");
}

async function openFormActualOverviewModal() {
  const modal = document.getElementById("formActualOverviewModal");
  const tbody = document.getElementById("formActualOverviewBody");
  if (modal) modal.classList.add("show");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="loading">กำลังโหลดข้อมูลการเบิกจ่าย...</td></tr>`;

  try {
    let query = supabaseClient.from("actuals").select("*");
    if (activeTripRound) {
      query = query.gte("start_date", activeTripRound.minStart).lte("end_date", activeTripRound.maxEnd);
    } else {
      if (dateStart) query = query.gte("start_date", formatDateForInput(dateStart));
      if (dateEnd) query = query.lte("end_date", formatDateForInput(dateEnd));
    }

    let { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    // เลือกรอบทริปอยู่ → เอาเฉพาะเอกสารที่อยู่ในรอบนั้น
    if (activeTripRound && data) {
      data = data.filter((x) => getTripRoundKey(x.start_date, x.end_date) === activeTripRound.key);
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8;">ไม่พบข้อมูลเคลียร์ค่าใช้จ่าย</td></tr>`;
      return;
    }

    const fmtD = (d) =>
      d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";

    tbody.innerHTML = data
      .map((item) => {
        const profile = profilesMap[item.user_id];
        const salesName = item.user_name || profile?.display_name || "ไม่ทราบชื่อ";
        const rows = Array.isArray(item.rows) ? item.rows : [];
        const routesText =
          rows.slice(0, 3).map((r) => `🚘 ${fmtD(r.date)}: ${r.route || "-"}`).join("<br>") +
          (rows.length > 3 ? `<br><small style="color:#64748b">+ อีก ${rows.length - 3} รายการ</small>` : "");

        const totalAmt = item.grand_total ? Number(item.grand_total).toLocaleString("th-TH") + " บาท" : "-";
        const statusClass = item.status === "completed" ? "badge-status-completed" : "badge-status-draft";
        const statusText = item.status === "completed" ? "อนุมัติ/เคลียร์แล้ว" : "รอดำเนินการ";

        return `
          <tr>
            <td><strong>${escapeHtml(salesName)}</strong></td>
            <td>${fmtD(item.created_at)}</td>
            <td>${fmtD(item.start_date)} - ${fmtD(item.end_date)}</td>
            <td>${routesText}</td>
            <td class="amount-text">${totalAmt}</td>
            <td><span class="badge-status ${statusClass}">${statusText}</span></td>
            <td style="display:flex;gap:4px;align-items:center;">
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="viewFormDetail('actual', '${item.id}')">
                <span class="material-symbols-outlined icon-sm">visibility</span> ดู
              </button>
              <button class="btn btn-primary" style="padding:4px 8px;font-size:12px;" onclick="printFormActualById('${item.id}')">
                <span class="material-symbols-outlined icon-white icon-sm">print</span> พิมพ์ A4
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("openFormActualOverviewModal error:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="color:red;text-align:center;">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

function closeFormActualOverviewModal() {
  const modal = document.getElementById("formActualOverviewModal");
  if (modal) modal.classList.remove("show");
}

async function viewFormDetail(type, id) {
  currentFormDetailRef = { type, id };
  const modal = document.getElementById("formDetailModal");
  const titleEl = document.getElementById("formDetailTitle");
  const badgeEl = document.getElementById("formDetailBadge");
  const contentEl = document.getElementById("formDetailContent");

  if (modal) modal.classList.add("show");
  contentEl.innerHTML = `<div class="loading">กำลังโหลดข้อมูลเอกสาร...</div>`;

  const fmtD = (d) =>
    d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" }) : "-";

  if (type === "plan") {
    titleEl.textContent = "แผนการเดินทาง (formPlan - ฟอร์ม ๑)";
    try {
      const { data, error } = await supabaseClient.from("trips").select("*").eq("id", id).single();
      if (error || !data) throw new Error("ไม่พบเอกสารนี้");

      badgeEl.textContent = data.status === "completed" ? "สมบูรณ์" : "ร่าง";
      let rows = [];
      let exp = {};
      if (Array.isArray(data.trips)) rows = data.trips;
      else if (data.trips && typeof data.trips === "object") {
        rows = data.trips.rows || [];
        exp = data.trips.expense || {};
      }

      const rowsHtml = rows
        .map(
          (r, i) => `
        <div class="detail-card-box">
          <div class="detail-card-header">
            <span>#${i + 1} วันที่: ${fmtD(r.date)}</span>
            <span>${escapeHtml(r.from || "-")} → ${escapeHtml(r.to || "-")}</span>
          </div>
          <div><strong>ร้านค้า:</strong> ${escapeHtml([r.shop1, r.shop2, r.shop3].filter(Boolean).join(", ") || "-")}</div>
          ${r.note ? `<div style="color:#64748b;font-size:12px;margin-top:4px;">หมายเหตุ: ${escapeHtml(r.note)}</div>` : ""}
        </div>
      `,
        )
        .join("");

      contentEl.innerHTML = `
        <div style="margin-bottom:16px;">
          <div><strong>ผู้ยื่น:</strong> ${escapeHtml(data.user_name || "-")}</div>
          <div><strong>ช่วงเวลา:</strong> ${fmtD(data.start_date)} - ${fmtD(data.end_date)}</div>
        </div>
        <h4 style="margin-bottom:10px;">รายการเส้นทางและร้านค้า (${rows.length} รายการ)</h4>
        ${rowsHtml}
        <div class="detail-card-box" style="background:#f0f9ff;border-color:#bae6fd;">
          <strong>ประมาณการค่าใช้จ่าย:</strong>
          <ul style="margin:6px 0 0 18px;font-size:13px;">
            <li>เบี้ยเลี้ยง: ${exp.allowance_days || 0} วัน @ ${exp.allowance_rate || 0} บาท</li>
            <li>ค่าที่พัก: ${exp.hotel_nights || 0} คืน @ ${exp.hotel_rate || 0} บาท</li>
            <li>ค่าใช้จ่ายอื่นๆ: ${exp.other_cost || 0} บาท</li>
          </ul>
        </div>
      `;
    } catch (e) {
      contentEl.innerHTML = `<div style="color:red;">❌ ${e.message}</div>`;
    }
  } else if (type === "actual") {
    titleEl.textContent = "เคลียร์ค่าใช้จ่าย (formActual - ฟอร์ม ๒)";
    try {
      const { data, error } = await supabaseClient.from("actuals").select("*").eq("id", id).single();
      if (error || !data) throw new Error("ไม่พบเอกสารนี้");

      badgeEl.textContent = data.status === "completed" ? "อนุมัติแล้ว" : "รอดำเนินการ";
      const rows = Array.isArray(data.rows) ? data.rows : [];

      const rowsHtml = rows
        .map(
          (r, i) => `
        <div class="detail-card-box">
          <div class="detail-card-header">
            <span>#${i + 1} วันที่: ${fmtD(r.date)}</span>
          </div>
          <div><strong>เส้นทาง/ร้านค้า:</strong> ${escapeHtml(r.route || "-")}</div>
          ${r.note ? `<div style="color:#64748b;font-size:12px;margin-top:4px;">หมายเหตุ: ${escapeHtml(r.note)}</div>` : ""}
        </div>
      `,
        )
        .join("");

      contentEl.innerHTML = `
        <div style="margin-bottom:16px;">
          <div><strong>ผู้ขอเบิก:</strong> ${escapeHtml(data.user_name || "-")}</div>
          <div><strong>เขต/พื้นที่:</strong> ${escapeHtml(data.zone || "-")}</div>
          <div><strong>ช่วงเวลา:</strong> ${fmtD(data.start_date)} - ${fmtD(data.end_date)}</div>
        </div>
        <h4 style="margin-bottom:10px;">รายการปฏิบัติงานจริง (${rows.length} รายการ)</h4>
        ${rowsHtml}
        <div class="detail-card-box" style="background:#f0fdf4;border-color:#bbf7d0;">
          <div style="font-size:16px;font-weight:700;color:#15803d;">
            ยอดรวมขอเบิกสุทธิ: ${(data.grand_total || 0).toLocaleString("th-TH")} บาท
          </div>
          <ul style="margin:6px 0 0 18px;font-size:13px;color:#334155;">
            <li>เบี้ยเลี้ยง: ${data.allowance_days || 0} วัน @ ${data.allowance_rate || 0} บาท</li>
            <li>ค่าที่พัก: ${data.hotel_nights || 0} คืน @ ${data.hotel_rate || 0} บาท</li>
            <li>ค่าอื่นๆ: ${data.other_cost || 0} บาท</li>
          </ul>
        </div>
      `;
    } catch (e) {
      contentEl.innerHTML = `<div style="color:red;">❌ ${e.message}</div>`;
    }
  }
}

function closeFormDetailModal() {
  const modal = document.getElementById("formDetailModal");
  if (modal) modal.classList.remove("show");
}

// =====================================================
// 📅 TRIP ROUND SELECTION & Dynamic Populating
// =====================================================
// ─────────────────────────────────────────────────────
// แนวคิด "รอบทริป"
//   • แต่ละเซลล์มีช่วงวันที่ของตัวเอง (start_date–end_date ไม่เท่ากัน)
//   • แต่ทุกคนอยู่ "รอบเดียวกัน" → จัดกลุ่มตาม "เดือนของรอบ"
//   • เดือนของรอบ = เดือนที่ "วันกึ่งกลาง" ของช่วงตกอยู่
//     (เช่น 28 ก.ย.–10 ต.ค. → รอบ ต.ค.)  เปลี่ยนกติกาได้ที่ TRIP_ROUND_RULE
//   • เลือกรอบแล้ว: รายงานของเซลล์แต่ละคนจะถูกกรองตาม "ช่วงของคนนั้นเอง"
//     เซลล์ที่ไม่มีแผนในรอบนั้น → ใช้ทั้งเดือนของรอบแทน
// ─────────────────────────────────────────────────────
const TRIP_ROUND_RULE = "midpoint"; // "midpoint" | "start" (ใช้เดือนของวันเริ่ม)

let activeTripRound = null; // round object ที่เลือกอยู่ (null = ใช้ช่วงวันที่ปกติ)

function parseLocalDate(d, endOfDay = false) {
  if (!d) return null;
  const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
  return endOfDay ? new Date(y, m - 1, dd, 23, 59, 59, 999) : new Date(y, m - 1, dd, 0, 0, 0, 0);
}

function getTripRoundKey(startDate, endDate) {
  const s = parseLocalDate(startDate);
  const e = parseLocalDate(endDate) || s;
  if (!s) return null;
  const ref = TRIP_ROUND_RULE === "start" ? s : new Date((s.getTime() + e.getTime()) / 2);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

function tripRoundLabel(key, monthStyle = "long") {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: monthStyle, year: "numeric" });
}

async function loadAllTripRounds() {
  try {
    const [{ data: plans }, { data: actuals }] = await Promise.all([
      supabaseClient
        .from("trips")
        .select("id, doc_no, version, start_date, end_date, user_id, user_name, area, created_at, is_latest")
        .order("start_date", { ascending: false }),
      supabaseClient
        .from("actuals")
        .select("id, ref_plan_id, start_date, end_date, user_id, user_name, zone, created_at")
        .order("start_date", { ascending: false }),
    ]);

    const roundsMap = new Map();

    const addEntry = (row, kind) => {
      if (!row.start_date || !row.end_date) return;
      if (kind === "plan" && row.is_latest === false) return; // ข้ามเวอร์ชันเก่าของแผน
      const key = getTripRoundKey(row.start_date, row.end_date);
      if (!key) return;

      if (!roundsMap.has(key)) {
        const [y, m] = key.split("-").map(Number);
        roundsMap.set(key, {
          key,
          monthStart: new Date(y, m - 1, 1, 0, 0, 0, 0),
          monthEnd: new Date(y, m, 0, 23, 59, 59, 999),
          minStart: row.start_date,
          maxEnd: row.end_date,
          userIds: new Set(),
          userNames: new Set(),
          ranges: {}, // user_id → [{ start, end, planId, actualId, docNo }]
        });
      }
      const r = roundsMap.get(key);
      if (row.start_date < r.minStart) r.minStart = row.start_date;
      if (row.end_date > r.maxEnd) r.maxEnd = row.end_date;
      if (row.user_name) r.userNames.add(row.user_name);
      if (!row.user_id) return;
      r.userIds.add(row.user_id);

      const list = (r.ranges[row.user_id] ||= []);
      let rng = list.find((x) => x.start === row.start_date && x.end === row.end_date);
      if (!rng) {
        rng = { start: row.start_date, end: row.end_date, planId: null, actualId: null, docNo: null };
        list.push(rng);
      }
      if (kind === "plan") {
        rng.planId ||= row.id;
        rng.docNo ||= row.doc_no ? `${row.doc_no}${row.version ? " v" + row.version : ""}` : null;
      } else {
        rng.actualId ||= row.id;
      }
    };

    (plans || []).forEach((p) => addEntry(p, "plan"));
    (actuals || []).forEach((a) => addEntry(a, "actual"));

    allTripRoundsList = Array.from(roundsMap.values()).sort((a, b) => (a.key < b.key ? 1 : -1));

    const filterSelect = document.getElementById("filterTripRound");
    if (filterSelect) {
      const prev = activeTripRound?.key || "";
      filterSelect.innerHTML =
        `<option value="">รอบทริป: ไม่เลือก (ใช้ช่วงวันที่)</option>` +
        allTripRoundsList
          .map((r) => {
            const range = `${formatDateShort(r.minStart)} – ${formatDateShort(r.maxEnd)}`;
            const label = `รอบ ${tripRoundLabel(r.key)} · ${r.userIds.size} คน (${range})`;
            return `<option value="${r.key}">${escapeHtml(label)}</option>`;
          })
          .join("");
      if (prev && allTripRoundsList.some((r) => r.key === prev)) filterSelect.value = prev;

      filterSelect.onchange = () => selectTripRound(filterSelect.value);
    }
  } catch (err) {
    console.error("loadAllTripRounds error:", err);
  }
}

// เลือกรอบทริป → ตั้งช่วงโหลดข้อมูลให้ครอบคลุมทุกคนในรอบ แล้วกรองรายคน
function selectTripRound(key) {
  const round = allTripRoundsList.find((r) => r.key === key) || null;
  activeTripRound = round;

  if (round) {
    // ช่วงรวม = เดือนของรอบ ∪ ช่วงของทุกคน (บางคนอาจเริ่มก่อน/จบหลังเดือน)
    const unionStart = parseLocalDate(round.minStart);
    const unionEnd = parseLocalDate(round.maxEnd, true);
    dateStart = unionStart < round.monthStart ? unionStart : new Date(round.monthStart);
    dateEnd = unionEnd > round.monthEnd ? unionEnd : new Date(round.monthEnd);

    const sInput = document.getElementById("dateStart");
    const eInput = document.getElementById("dateEnd");
    if (sInput) sInput.value = formatDateForInput(dateStart);
    if (eInput) eInput.value = formatDateForInput(dateEnd);
    clearQuickRangeActive();
  }

  updateDateRangeLabel();
  renderTripRoundInfo();
  loadReports();
}

// ช่วงวันที่ที่ใช้กรองรายงานของเซลล์คนหนึ่ง ในรอบที่เลือก
function getTripRangesForSale(saleId) {
  if (!activeTripRound) return null;
  const list = activeTripRound.ranges[saleId];
  if (list && list.length) {
    return list.map((x) => ({ start: parseLocalDate(x.start), end: parseLocalDate(x.end, true) }));
  }
  return [{ start: activeTripRound.monthStart, end: activeTripRound.monthEnd }];
}

function isReportInActiveRange(r) {
  const date = r.report_date || r.submitted_at || r.created_at;
  if (!date) return false;
  // report_date เป็นวันที่ล้วน → ตีความเป็นเวลาท้องถิ่น
  const t = (/^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? parseLocalDate(date) : new Date(date)).getTime();

  const ranges = getTripRangesForSale(r.sale_id);
  if (ranges) return ranges.some((x) => t >= x.start.getTime() && t <= x.end.getTime());
  return t >= dateStart.getTime() && t <= dateEnd.getTime();
}

// แสดงสรุปช่วงของแต่ละคนใต้ dropdown
function renderTripRoundInfo() {
  const select = document.getElementById("filterTripRound");
  if (!select) return;
  let box = document.getElementById("tripRoundInfo");
  if (!box) {
    box = document.createElement("div");
    box.id = "tripRoundInfo";
    box.style.cssText = "margin-top:6px;font-size:12px;color:#475569;line-height:1.6;";
    select.insertAdjacentElement("afterend", box);
  }
  if (!activeTripRound) {
    box.innerHTML = "";
    return;
  }
  const items = Object.entries(activeTripRound.ranges)
    .map(([uid, list]) => {
      const name = profilesMap[uid]?.display_name || "เซลล์";
      const rng = list.map((x) => `${formatDateShort(x.start)}–${formatDateShort(x.end)}`).join(", ");
      return { name, rng };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
  box.innerHTML =
    `<details><summary style="cursor:pointer">ช่วงของแต่ละคนในรอบ ${escapeHtml(tripRoundLabel(activeTripRound.key))} (${items.length} คน)</summary>` +
    items.map((i) => `<div>• ${escapeHtml(i.name)} : ${escapeHtml(i.rng)}</div>`).join("") +
    `<div style="color:#94a3b8">เซลล์ที่ไม่มีแผนในรอบนี้ ใช้ทั้งเดือน ${escapeHtml(tripRoundLabel(activeTripRound.key, "short"))}</div></details>`;
}

// ยกเลิกรอบทริป (เมื่อผู้ใช้เปลี่ยนวันที่เอง / กดช่วงด่วน)
function clearTripRound() {
  if (!activeTripRound) return;
  activeTripRound = null;
  const select = document.getElementById("filterTripRound");
  if (select) select.value = "";
  renderTripRoundInfo();
}

function populateSalesTripRounds(salesId) {
  const select = document.getElementById("salesTripRoundFilter");
  if (!select) return;

  const salesRounds = allTripRoundsList.filter((r) => r.userIds.has(salesId));

  select.innerHTML =
    `<option value="">— ทั้งหมดทุกรอบทริป —</option>` +
    salesRounds
      .flatMap((r) =>
        (r.ranges[salesId] || []).map((x) => {
          const dateRange = `${formatDateShort(x.start)} - ${formatDateShort(x.end)}`;
          const doc = x.docNo ? ` (${x.docNo})` : "";
          return `<option value="${x.start}|${x.end}">${escapeHtml(`รอบ ${tripRoundLabel(r.key)} : ${dateRange}${doc}`)}</option>`;
        }),
      )
      .join("");

  // ถ้าหน้าหลักเลือกรอบไว้ → เลือกรอบเดียวกันของเซลล์คนนี้ให้อัตโนมัติ
  const own = activeTripRound?.ranges[salesId]?.[0];
  if (own) select.value = `${own.start}|${own.end}`;

  select.onchange = function () {
    const val = select.value;
    let rStart = null,
      rEnd = null;
    if (val) {
      [rStart, rEnd] = val.split("|");
    }
    loadSalesFormPlans(salesId, rStart, rEnd);
    loadSalesFormActuals(salesId, rStart, rEnd);
  };
  if (own) select.onchange();
}

// =====================================================
// 🖨️ PRINTING OFFICIAL A4 EXPORT DOCUMENTS
// =====================================================
function buildFullPageHTML(body) {
  return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ใบเอกสารการเดินทาง</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0 }
  html, body {
    width:100%; background:#fff; font-family:'Kanit',sans-serif;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  #print-wrap { width: 190mm; margin-left: auto; margin-right: auto; padding: 10mm 0; }
  .no-print { text-align:center; padding:12px; background:#f8fafc; border-bottom:1px solid #e2e8f0 }
  .no-print button {
    font-family:'Kanit',sans-serif; font-size:15px; font-weight:600;
    padding:10px 24px; margin:4px; border-radius:8px; cursor:pointer;
    border:none; color:#fff; min-width:140px; touch-action:manipulation;
  }
  .btn-print { background:#1D9E75 }
  .btn-close { background:#64748b }
  @media print {
    @page { size: A4 portrait; margin: 10mm 10mm; }
    html, body { width:210mm }
    #print-wrap { width: 190mm; padding: 0; margin-left: auto; margin-right: auto; }
    .no-print { display:none !important }
  }
</style>
</head><body>
<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨 พิมพ์ / Save PDF</button>
  <button class="btn-close" onclick="window.close()">✖ ปิดหน้านี้</button>
</div>
<div id="print-wrap">${body}</div>
</body></html>`;
}

function buildPlanPreviewHTML(plan) {
  let tripRows = [],
    expense = {};
  if (Array.isArray(plan.trips)) {
    tripRows = plan.trips;
  } else if (plan.trips && typeof plan.trips === "object") {
    tripRows = plan.trips.rows || [];
    expense = plan.trips.expense || {};
  }

  const fd = (d) => {
    if (!d) return "-";
    const p = String(d).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
  };
  const fm = (n) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  let tRows = "";
  tripRows.forEach((t, i) => {
    const bg = i % 2 === 0 ? "" : 'style="background:#f7f9fb"';
    tRows += `<tr ${bg}><td>${fd(t.date)}</td><td>${escapeHtml(t.from || "-")}</td><td>${escapeHtml(t.to || "-")}</td><td>${escapeHtml(t.shop1 || "-")}</td><td>${escapeHtml(t.shop2 || "-")}</td><td>${escapeHtml(t.shop3 || "-")}</td><td style="text-align:left;padding-left:4px">${escapeHtml(t.note || "")}</td></tr>`;
  });
  if (!tRows)
    tRows = `<tr><td colspan="7" style="text-align:center;color:#999;padding:10px">ไม่มีข้อมูล</td></tr>`;

  const ar = expense.allowance_rate || 0,
    ad = expense.allowance_days || 0;
  const hr = expense.hotel_rate || 0,
    hn = expense.hotel_nights || 0;
  const oc = expense.other_cost || 0;
  const ta = ar * ad,
    th = hr * hn,
    gt = ta + th + oc;

  const emp = plan.user_name || "-",
    area = plan.area || "-";
  const st = fd(plan.start_date),
    en = fd(plan.end_date);
  const docNo = plan.doc_no || "-";
  const version = "v" + (plan.version || 1);
  const pd = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });

  return `
<style>
.dw{font-family:'Kanit',sans-serif;font-size:11px;color:#1a1a1a;line-height:1.35}
.dc{text-align:center;margin-bottom:2px}
.dc .cn{font-size:18px;font-weight:700}.dc .tt{font-size:14px;font-weight:600;margin-top:1px}
hr.dv{border:none;border-top:1.5px solid #1a1a1a;margin:4px 0 8px}
.dm{display:grid;grid-template-columns:1fr 1fr;border:1px solid #999;border-radius:3px;margin-bottom:8px;overflow:hidden}
.dmc{padding:4px 10px;font-size:14px;line-height:1.6}.dmc:first-child{border-right:1px solid #999}
.ml{font-weight:700;color:#444;margin-right:3px}
.dt{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5px;table-layout:fixed}
.dt th{background:#e8f5f4;color:#1a5550;padding:4px 2px;text-align:center;font-weight:700;font-size:14px;border:1px solid #b2d8d5}
.dt td{padding:3px 4px;text-align:center;border:1px solid #ccc;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{font-size:11px;font-weight:700;margin-bottom:3px;padding-bottom:2px;border-bottom:1.5px solid #b2d8d5;display:flex;align-items:center;gap:4px}
.st::before{content:'';display:inline-block;width:3px;height:12px;background:#7ec8c3;border-radius:2px}
.ct{width:50%;margin-left:auto;margin-bottom:10px;border-collapse:collapse;font-size:14px}
.ct td,.ct th{border:1px solid #ccc;padding:2px 6px}
.ct td:first-child{font-weight:600;color:#333}.ct td:nth-child(2){text-align:center;color:#555}.ct td:last-child{text-align:right}
.ct .tr th{background:#e8f5f4;color:#1a5550;text-align:right;padding:3px 6px;font-size:14px;border:1px solid #b2d8d5;font-weight:700}
.sg{margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center}
.sb{font-size:12.5px;line-height:1.5}.sl{border-top:1px solid #555;padding-top:24px;margin-top:40px}
.sn{font-weight:600}.sr{color:#555}
.dpd{text-align:right;font-size:9px;color:#777;margin-bottom:3px}
</style>
<div class="dw">
  <div class="dpd">วันที่พิมพ์: ${pd}</div>
  <div style="text-align:right;font-size:12px;margin-bottom:4px">
    เลขที่เอกสาร: ${docNo} <br>
    Version: ${version}
  </div>
  <hr style="margin:4px 0;">
  <div class="dc"><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">แผนการเดินทางและเบิกทดลองจ่าย ๑</div></div>
  <hr class="dv">
  <div class="dm">
    <div class="dmc">
      <div><span class="ml">พนักงานขาย :</span>${escapeHtml(emp)}</div>
      <div><span class="ml">เขตการขาย :</span>${escapeHtml(area)}</div>
    </div>
    <div class="dmc">
      <div><span class="ml">ระหว่างวันที่ :</span>${st}</div>
      <div><span class="ml">ถึงวันที่ :</span>${en}</div>
      <div><span class="ml">จำนวน :</span>${tripRows.length} วัน</div>
    </div>
  </div>
  <table class="dt"><thead><tr><th style="width:11%">ว/ด/ป</th><th style="width:14%">จากจังหวัด</th><th style="width:14%">ไปจังหวัด</th><th style="width:18%">ร้านค้า 1</th><th style="width:18%">ร้านค้า 2</th><th style="width:15%">ร้านค้า 3</th><th style="width:10%">หมายเหตุ</th></tr></thead><tbody>${tRows}</tbody></table>
  <div class="st">สรุปค่าใช้จ่าย</div>
  <table class="ct">
    <tr><td>เบี้ยเลี้ยง</td><td>${fm(ar)} × ${ad} วัน</td><td>${fm(ta)} บาท</td></tr>
    <tr><td>ค่าที่พัก</td><td>${fm(hr)} × ${hn} คืน</td><td>${fm(th)} บาท</td></tr>
    <tr><td>อื่นๆ</td><td style="text-align:center">–</td><td>${fm(oc)} บาท</td></tr>
    <tr class="tr"><th colspan="2">รวมเบิกทั้งหมด</th><th style="font-size:14px">${fm(gt)} บาท</th></tr>
  </table>
  <div class="sg">
    <div class="sb"><div class="sl"><div class="sn">(${escapeHtml(emp)})</div><div class="sr">พนักงานขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ผจก.ฝ่ายขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ฝ่ายบัญชี</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ผู้อนุมัติ</div></div></div>
  </div>
</div>`;
}

function buildActualPreviewHTML(d) {
  const fd = (s) => {
    if (!s) return "-";
    const p = String(s).split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
  };
  const fm = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });
  const rows = d.rows || [];
  const ar = d.allowance_rate || 0,
    ad = d.allowance_days || 0,
    hr = d.hotel_rate || 0,
    hn = d.hotel_nights || 0,
    oc = d.other_cost || 0;
  const ta = ar * ad,
    th = hr * hn,
    gt = d.grand_total || ta + th + oc;
  const today = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
  const planRef = d.ref_plan_id
    ? `<div><span class="ml">อ้างอิงแผน :</span>${d.ref_plan_id.substring(0, 8)}...</div>`
    : "";

  let tRows = "";
  rows.forEach((r, i) => {
    const bg = i % 2 === 1 ? ' style="background:#f7f9fb"' : "";
    tRows += `<tr${bg}><td>${fd(r.date)}</td><td style="text-align:left;padding-left:6px">${escapeHtml(r.route || "-")}</td><td style="text-align:left;padding-left:4px">${escapeHtml(r.note || "")}</td></tr>`;
  });

  return `
<style>
.dw{font-family:'Kanit',sans-serif;font-size:11px;color:#1a1a1a;line-height:1.35}
.dc{text-align:center;margin-bottom:2px}.dc .cn{font-size:18px;font-weight:700}.dc .tt{font-size:14px;font-weight:600;margin-top:1px}
hr.dv{border:none;border-top:1.5px solid #1a1a1a;margin:4px 0 8px}
.dpd{text-align:right;font-size:9px;color:#777;margin-bottom:3px}
.dm{display:grid;grid-template-columns:1fr 1fr;border:1px solid #999;border-radius:3px;margin-bottom:8px;overflow:hidden}
.dmc{padding:4px 10px;font-size:14px;line-height:1.6}.dmc:first-child{border-right:1px solid #999}
.ml{font-weight:700;color:#444;margin-right:3px}
.dt{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;table-layout:fixed}
.dt th{background:#e8f5f4;color:#1a5550;padding:4px 4px;text-align:center;border:1px solid #b2d8d5;font-size:14px;font-weight:700}
.dt td{padding:3px 4px;border:1px solid #ccc;text-align:center;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st{font-size:11px;font-weight:700;margin-bottom:3px;padding-bottom:2px;border-bottom:1.5px solid #1a6b64;display:flex;align-items:center;gap:4px}
.st::before{content:'';display:inline-block;width:3px;height:12px;background:#3FB7AE;border-radius:2px}
.ct{width:50%;margin-left:auto;margin-bottom:10px;border-collapse:collapse;font-size:14px}
.ct td,.ct th{border:1px solid #ccc;padding:2px 6px}.ct td:first-child{font-weight:600;color:#333}.ct td:nth-child(2){text-align:center;color:#555}.ct td:last-child{text-align:right}
.ct .tr th{background:#e8f5f4;color:#1a5550;text-align:right;padding:3px 6px;font-size:14px;border:1px solid #b2d8d5;font-weight:700}
.sg{margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center}
.sb{font-size:12.5px;line-height:1.5}.sl{border-top:1px solid #555;padding-top:24px;margin-top:40px}
.sn{font-weight:600}.sr{color:#555}
</style>
<div class="dw">
  <div class="dpd">วันที่พิมพ์: ${today}</div>
  <div class="dc"><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">ใบเดินทางจริงและเคลียร์ค่าใช้จ่าย ๒</div></div>
  <hr class="dv">
  <div class="dm"><div class="dmc"><div><span class="ml">พนักงานขาย :</span>${escapeHtml(d.user_name || "-")}</div><div><span class="ml">เขตการขาย :</span>${escapeHtml(d.zone || "-")}</div>${planRef}</div><div class="dmc"><div><span class="ml">ระหว่างวันที่ :</span>${fd(d.start_date)}</div><div><span class="ml">ถึงวันที่ :</span>${fd(d.end_date)}</div><div><span class="ml">จำนวน :</span>${rows.length} วัน</div></div></div>
  <table class="dt"><thead><tr><th style="width:15%">ว/ด/ป</th><th style="width:65%">เส้นทางจริง</th><th style="width:20%">หมายเหตุ</th></tr></thead><tbody>${tRows || '<tr><td colspan="3" style="text-align:center;color:#999;padding:10px">ไม่มีข้อมูล</td></tr>'}</tbody></table>
  <div class="st">สรุปค่าใช้จ่าย</div>
  <table class="ct">
    <tr><td>เบี้ยเลี้ยง</td><td>${fm(ar)} × ${ad} วัน</td><td>${fm(ta)} บาท</td></tr>
    <tr><td>ค่าที่พัก</td><td>${fm(hr)} × ${hn} คืน</td><td>${fm(th)} บาท</td></tr>
    <tr><td>อื่นๆ</td><td style="text-align:center">–</td><td>${fm(oc)} บาท</td></tr>
    <tr class="tr"><th colspan="2">รวมเบิกทั้งหมด</th><th style="font-size:14px">${fm(gt)} บาท</th></tr>
  </table>
  <div class="sg">
    <div class="sb"><div class="sl"><div class="sn">(${escapeHtml(d.user_name || " - ")})</div><div class="sr">พนักงานขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ผจก.ฝ่ายขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ฝ่ายบัญชี</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ผู้อนุมัติ</div></div></div>
  </div>
</div>`;
}

async function printFormPlanById(id) {
  try {
    const { data, error } = await supabaseClient.from("trips").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) {
      alert("ไม่พบข้อมูลเอกสารแผนเดินทาง");
      return;
    }
    const html = buildPlanPreviewHTML(data);
    const full = buildFullPageHTML(html);
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(full);
      w.document.close();
    } else {
      const blob = new Blob([full], { type: "text/html;charset=utf-8" });
      window.open(URL.createObjectURL(blob), "_blank");
    }
  } catch (e) {
    alert("❌ " + e.message);
  }
}

async function printFormActualById(id) {
  try {
    const { data, error } = await supabaseClient.from("actuals").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) {
      alert("ไม่พบข้อมูลเอกสารเบิกจ่าย");
      return;
    }
    const html = buildActualPreviewHTML(data);
    const full = buildFullPageHTML(html);
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(full);
      w.document.close();
    } else {
      const blob = new Blob([full], { type: "text/html;charset=utf-8" });
      window.open(URL.createObjectURL(blob), "_blank");
    }
  } catch (e) {
    alert("❌ " + e.message);
  }
}

function printCurrentFormDetail() {
  if (!currentFormDetailRef) {
    alert("กรุณาเลือกเอกสารก่อนพิมพ์");
    return;
  }
  if (currentFormDetailRef.type === "plan") {
    printFormPlanById(currentFormDetailRef.id);
  } else if (currentFormDetailRef.type === "actual") {
    printFormActualById(currentFormDetailRef.id);
  }
}

async function printSelectedSalesTripRoundDoc() {
  const select = document.getElementById("salesTripRoundFilter");
  const val = select?.value;
  if (!val) {
    alert("กรุณาเลือกรอบทริปก่อนดึงใบเอกสาร");
    return;
  }
  const [s, e] = val.split("|");
  if (!currentSalesModalId) return;

  const { data: plans } = await supabaseClient
    .from("trips")
    .select("id")
    .eq("user_id", currentSalesModalId)
    .eq("start_date", s)
    .eq("end_date", e)
    .limit(1);

  if (plans && plans.length > 0) {
    printFormPlanById(plans[0].id);
    return;
  }

  const { data: actuals } = await supabaseClient
    .from("actuals")
    .select("id")
    .eq("user_id", currentSalesModalId)
    .eq("start_date", s)
    .eq("end_date", e)
    .limit(1);

  if (actuals && actuals.length > 0) {
    printFormActualById(actuals[0].id);
    return;
  }

  alert("ไม่พบใบเอกสารสำหรับรอบทริปนี้");
}

window.switchSalesModalTab = switchSalesModalTab;
window.openFormPlanOverviewModal = openFormPlanOverviewModal;
window.closeFormPlanOverviewModal = closeFormPlanOverviewModal;
window.openFormActualOverviewModal = openFormActualOverviewModal;
window.closeFormActualOverviewModal = closeFormActualOverviewModal;
window.viewFormDetail = viewFormDetail;
window.closeFormDetailModal = closeFormDetailModal;
window.printFormPlanById = printFormPlanById;
window.printFormActualById = printFormActualById;
window.printCurrentFormDetail = printCurrentFormDetail;
window.printSelectedSalesTripRoundDoc = printSelectedSalesTripRoundDoc;
window.loadAllTripRounds = loadAllTripRounds;
window.selectTripRound = selectTripRound;

// =====================================================
// 📁 เอกสารรอบทริป — ผู้จัดการดูเอกสารที่เซลล์พิมพ์ส่งฝ่ายบัญชี
//    ใบแผน (trips) + ใบเคลียร์ค่าใช้จ่าย (actuals) ของทุกคนในรอบที่เลือก
// =====================================================
let tripRoundDocsData = []; // [{ uid, name, plans:[], actuals:[] }]

async function fetchRoundDocs(round) {
  const [{ data: plans, error: e1 }, { data: actuals, error: e2 }] = await Promise.all([
    supabaseClient.from("trips").select("*")
      .gte("start_date", round.minStart).lte("end_date", round.maxEnd)
      .order("start_date", { ascending: true }),
    supabaseClient.from("actuals").select("*")
      .gte("start_date", round.minStart).lte("end_date", round.maxEnd)
      .order("start_date", { ascending: true }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const inRound = (x) => x.start_date && getTripRoundKey(x.start_date, x.end_date) === round.key;
  return {
    plans: (plans || []).filter((p) => inRound(p) && p.is_latest !== false),
    actuals: (actuals || []).filter(inRound),
  };
}

async function openTripRoundDocsModal() {
  if (!activeTripRound) {
    alert("กรุณาเลือก \"รอบทริป\" ก่อน แล้วกดดูเอกสาร");
    document.getElementById("filterTripRound")?.focus();
    return;
  }
  const round = activeTripRound;
  const modal = document.getElementById("tripRoundDocsModal");
  const tbody = document.getElementById("tripRoundDocsBody");
  document.getElementById("tripRoundDocsTitle").textContent = `เอกสารรอบ ${tripRoundLabel(round.key)}`;
  if (modal) modal.classList.add("show");
  tbody.innerHTML = `<tr><td colspan="6" class="loading">กำลังโหลดเอกสาร...</td></tr>`;

  try {
    const { plans, actuals } = await fetchRoundDocs(round);
    const byUser = new Map();
    const ensure = (uid, name) => {
      if (!byUser.has(uid)) {
        byUser.set(uid, { uid, name: profilesMap[uid]?.display_name || name || "ไม่ทราบชื่อ", plans: [], actuals: [] });
      }
      return byUser.get(uid);
    };
    // เซลล์ทุกคน (รวมคนที่ยังไม่ส่งเอกสาร)
    Object.values(profilesMap)
      .filter((p) => p.role === "sales")
      .forEach((p) => ensure(p.id, p.display_name));
    plans.forEach((p) => ensure(p.user_id, p.user_name).plans.push(p));
    actuals.forEach((a) => ensure(a.user_id, a.user_name).actuals.push(a));

    tripRoundDocsData = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
    renderTripRoundDocs();
  } catch (err) {
    console.error("openTripRoundDocsModal error:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="color:red;text-align:center;">โหลดเอกสารไม่สำเร็จ: ${escapeHtml(err.message || err)}</td></tr>`;
  }
}

function tripDocState(u) {
  const hasPlan = u.plans.length > 0;
  const hasActual = u.actuals.length > 0;
  if (hasPlan && hasActual) return { code: "complete", text: "✅ ส่งครบ", color: "#15803d", bg: "#dcfce7" };
  if (hasActual) return { code: "actual-only", text: "⚠️ ไม่มีใบแผน", color: "#b45309", bg: "#fef3c7" };
  if (hasPlan) return { code: "plan-only", text: "⏳ ยังไม่ส่งใบเคลียร์", color: "#b45309", bg: "#fef3c7" };
  return { code: "none", text: "❌ ยังไม่ส่งเอกสาร", color: "#b91c1c", bg: "#fee2e2" };
}

function renderTripRoundDocs() {
  const tbody = document.getElementById("tripRoundDocsBody");
  const summary = document.getElementById("tripRoundDocsSummary");
  if (!tbody) return;
  const missingOnly = document.getElementById("tripRoundDocsMissingOnly")?.checked;
  const fmtD = (d) => (d ? formatDateShort(d) : "-");
  const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // สรุปภาพรวม
  const total = tripRoundDocsData.length;
  const complete = tripRoundDocsData.filter((u) => tripDocState(u).code === "complete").length;
  const none = tripRoundDocsData.filter((u) => tripDocState(u).code === "none").length;
  const sumActual = tripRoundDocsData.reduce((s, u) => s + u.actuals.reduce((t, a) => t + Number(a.grand_total || 0), 0), 0);
  const chip = (label, value, color) =>
    `<div style="padding:8px 14px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;">${label}<div style="font-size:18px;font-weight:700;color:${color}">${value}</div></div>`;
  if (summary) {
    summary.innerHTML =
      chip("ส่งครบ (ใบแผน + ใบเคลียร์)", `${complete} / ${total} คน`, "#15803d") +
      chip("ยังไม่ส่งเอกสารเลย", `${none} คน`, "#b91c1c") +
      chip("ยอดเบิกรวมทั้งรอบ", `${money(sumActual)} บาท`, "#1e3a8a");
  }

  const rows = tripRoundDocsData.filter((u) => !missingOnly || tripDocState(u).code !== "complete");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">${missingOnly ? "ทุกคนส่งครบแล้ว 🎉" : "ไม่มีเอกสารในรอบนี้"}</td></tr>`;
    return;
  }

  const docBtns = (type, item, label) => `
    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:2px 0;">
      <span style="font-size:12px;">${escapeHtml(label)}</span>
      <button class="btn btn-secondary" style="padding:2px 8px;font-size:12px;" onclick="viewFormDetail('${type}', '${item.id}')">ดู</button>
      <button class="btn btn-primary" style="padding:2px 8px;font-size:12px;" onclick="${type === "plan" ? "printFormPlanById" : "printFormActualById"}('${item.id}')">พิมพ์</button>
    </div>`;

  tbody.innerHTML = rows
    .map((u) => {
      const st = tripDocState(u);
      const ranges = [...u.plans, ...u.actuals]
        .map((x) => `${fmtD(x.start_date)}–${fmtD(x.end_date)}`)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join("<br>") || `<span style="color:#94a3b8">—</span>`;
      const planCell = u.plans.length
        ? u.plans.map((p) => docBtns("plan", p, `${p.doc_no || "ใบแผน"}${p.version ? " v" + p.version : ""} · ${p.status === "completed" ? "สมบูรณ์" : p.status || "ร่าง"}`)).join("")
        : `<span style="color:#b91c1c;font-size:12px;">ยังไม่มี</span>`;
      const actualCell = u.actuals.length
        ? u.actuals.map((a) => docBtns("actual", a, `${fmtD(a.created_at)} · ${a.status === "completed" ? "เคลียร์แล้ว" : "รอดำเนินการ"}`)).join("")
        : `<span style="color:#b91c1c;font-size:12px;">ยังไม่มี</span>`;
      const sum = u.actuals.reduce((t, a) => t + Number(a.grand_total || 0), 0);
      return `
        <tr>
          <td><strong>${escapeHtml(u.name)}</strong></td>
          <td style="white-space:nowrap">${ranges}</td>
          <td>${planCell}</td>
          <td>${actualCell}</td>
          <td class="amount-text" style="white-space:nowrap">${u.actuals.length ? money(sum) + " บาท" : "-"}</td>
          <td><span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:${st.color};background:${st.bg}">${st.text}</span></td>
        </tr>`;
    })
    .join("");
}

// พิมพ์เอกสารทั้งรอบในหน้าเดียว (แยกหน้า A4 ต่อเอกสาร)
function printTripRoundDocs(type) {
  const docs = tripRoundDocsData.flatMap((u) => (type === "plan" ? u.plans : u.actuals));
  if (!docs.length) {
    alert(type === "plan" ? "ไม่มีใบแผนการเดินทางในรอบนี้" : "ไม่มีใบเคลียร์ค่าใช้จ่ายในรอบนี้");
    return;
  }
  const body = docs
    .map((d, i) => {
      const html = type === "plan" ? buildPlanPreviewHTML(d) : buildActualPreviewHTML(d);
      const brk = i < docs.length - 1 ? "page-break-after:always;break-after:page;" : "";
      return `<div style="${brk}">${html}</div>`;
    })
    .join("");
  const full = buildFullPageHTML(body);
  const w = window.open("", "_blank");
  if (w) {
    w.document.open();
    w.document.write(full);
    w.document.close();
  } else {
    const blob = new Blob([full], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
  }
}

function closeTripRoundDocsModal() {
  document.getElementById("tripRoundDocsModal")?.classList.remove("show");
}

window.openTripRoundDocsModal = openTripRoundDocsModal;
window.closeTripRoundDocsModal = closeTripRoundDocsModal;
window.renderTripRoundDocs = renderTripRoundDocs;
window.printTripRoundDocs = printTripRoundDocs;

// =====================================================
// 🔗 รับตัวกรองจากลิงก์ เช่น จากแดชบอร์ดผู้จัดการ
//    ?sale=<id>      → กรองเซลล์คนนั้น
//    ?filter=unread  → เฉพาะที่ยังไม่อ่าน (read / commented ก็ได้)
// =====================================================
function applyUrlFilters() {
  const q = new URLSearchParams(location.search);
  const sale = q.get("sale");
  const status = q.get("filter") || q.get("status");
  let changed = false;
  const saleSel = document.getElementById("filterSales");
  if (sale && saleSel && [...saleSel.options].some((o) => o.value === sale)) {
    saleSel.value = sale;
    changed = true;
  }
  const stSel = document.getElementById("filterStatus");
  if (status && stSel && [...stSel.options].some((o) => o.value === status)) {
    stSel.value = status;
    changed = true;
  }
  if (changed) applyFilter();
}
