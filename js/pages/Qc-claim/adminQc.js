// =====================================================
// adminQc.js (v3.0 — Sidebar layout + bugfix + new features)
// หน้า QC Dashboard กลาง — ตรวจสอบ รับเรื่อง อนุมัติ ปฏิเสธ Export
//
// ✨ Changelog v3.0:
//   - FIX: filter status ใช้ qc_status ตรงกับ badge
//   - FIX: updateClaimStatus เขียน qc_status (เดิมเขียนแค่ status)
//   - FIX: getClaimScope ไม่ false-positive จาก "qc" ใน customer name
//   - NEW: filter scope (internal/external/all)
//   - NEW: filter pick state (รอรับ/รับแล้ว/ทั้งหมด)
//   - NEW: sortable columns (วันที่, สถานะ)
//   - NEW: click summary card → filter shortcut
//   - NEW: refresh button
//   - NEW: success popup + confirm dialog แบบใหม่
//   - NEW: scope pill ในตาราง
//   - LINE notify: คงไว้เหมือนเดิม (dynamic import)
// =====================================================

// ── lazy-load sendLineNotify ──
let _sendLineNotify = null;
async function getSendLineNotify() {
  if (_sendLineNotify) return _sendLineNotify;
  try {
    const mod = await import("/js/services/lineNotify.js");
    _sendLineNotify = mod.sendLineNotify;
    return _sendLineNotify;
  } catch (err) {
    console.warn("⚠️  Cannot load lineNotify.js — LINE notifications disabled", err);
    throw err;
  }
}

// =====================================================
// STATE
// =====================================================
let allClaims = [];
let filteredClaims = [];
let currentClaim = null;

// active sort
let sortKey = "claim_date"; // 'claim_date' | 'qc_status'
let sortDir = "desc"; // 'asc' | 'desc'

// active filter
const filterState = {
  search: "",
  status: "", // qc_status: '' | 'pending' | 'checking' | 'approved' | 'rejected' | 'waiting_ceo'
  dateFrom: "",
  dateTo: "",
  scope: "", // '' | 'internal' | 'external'
  pickState: "all", // 'all' | 'pending' | 'picked'
};

// =====================================================
// UTILITIES
// =====================================================
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeStatus(claimOrStatus) {
  if (typeof claimOrStatus === "object" && claimOrStatus !== null) {
    // ลำดับความสำคัญ: exec_status > qc_status > status
    if (
      claimOrStatus.exec_status &&
      ["approved", "rejected"].includes(claimOrStatus.exec_status)
    ) {
      return `exec_${claimOrStatus.exec_status}`;
    }
    return claimOrStatus.qc_status || claimOrStatus.status || "pending";
  }
  if (claimOrStatus === "submitted") return "pending";
  if (claimOrStatus === "in_progress") return "checking";
  return claimOrStatus || "pending";
}

function normalizeMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function normalizeClaimTypes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function getClaimNo(claim) {
  const raw =
    claim?.claim_no || claim?.claim_code || claim?.claim_id || claim?.id || "";
  return String(raw || "").substring(0, 8).toUpperCase() || "—";
}

function getClaimSearchText(claim) {
  return `${claim.product || ""} ${claim.customer || ""} ${claim.emp_name || ""} ${claim.area || ""} ${claim.detail || ""} ${getClaimNo(claim)}`.toLowerCase();
}

function isVideo(url) {
  if (!url) return false;
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/i.test(url);
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function waitForSupabase() {
  let attempts = 0;
  while (typeof supabaseClient === "undefined" && attempts < 50) {
    await new Promise((r) => setTimeout(r, 100));
    attempts++;
  }
  return typeof supabaseClient !== "undefined";
}

// ✅ FIX: getClaimScope ที่แม่นยำขึ้น
function getClaimScope(claim) {
  // 1) ถ้ามี explicit claim_scope ใน DB ใช้ทันที
  if (claim?.claim_scope === "internal") return "internal";
  if (claim?.claim_scope === "external") return "external";

  // 2) ไม่มี customer = น่าจะ internal
  if (!claim?.customer || String(claim.customer).trim() === "") {
    return "internal";
  }

  // 3) ตรวจคำสำคัญใน area / claim_types เท่านั้น (ไม่ดู customer/product เพราะ false-positive ได้)
  const claimTypes = normalizeClaimTypes(claim?.claim_types);
  const text = `${claim?.area || ""} ${claimTypes.join(" ")}`.toLowerCase();

  const internalKeywords = [
    "ภายใน", "internal", "วัตถุดิบ", "raw material",
    "ผลิต", "คลังสินค้า", "วิศวกรรม", "engineering",
    "production", "warehouse",
  ];

  if (internalKeywords.some((kw) => text.includes(kw))) {
    return "internal";
  }

  // 4) default: external
  return "external";
}

// =====================================================
// INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const ready = await waitForSupabase();
    if (!ready) {
      alert("ไม่สามารถเชื่อมต่อระบบได้");
      return;
    }

    setupLogout();
    updateHeaderDate();

    if (typeof protectPage === "function") {
      await protectPage(["admin", "adminQc", "adminqc"]);
    }

    await loadCurrentUserInfo();
    await loadClaims();
    setupEventListeners();

    console.log("✅ adminQc init done");
  } catch (err) {
    console.error("❌ Init error:", err);
    alert("เกิดข้อผิดพลาด: " + err.message);
  }
});

// =====================================================
// EVENT LISTENERS
// =====================================================
function setupEventListeners() {
  // search
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    let timer;
    searchInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        filterState.search = searchInput.value.toLowerCase().trim();
        applyFilters();
      }, 250);
    });
  }

  // status + date
  const statusEl = document.getElementById("filterStatus");
  if (statusEl) {
    statusEl.addEventListener("change", () => {
      filterState.status = statusEl.value;
      applyFilters();
    });
  }

  const dateFromEl = document.getElementById("filterDateFrom");
  if (dateFromEl) {
    dateFromEl.addEventListener("change", () => {
      filterState.dateFrom = dateFromEl.value;
      applyFilters();
    });
  }

  const dateToEl = document.getElementById("filterDateTo");
  if (dateToEl) {
    dateToEl.addEventListener("change", () => {
      filterState.dateTo = dateToEl.value;
      applyFilters();
    });
  }

  // scope segmented
  document.querySelectorAll("[data-scope]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterState.scope = btn.dataset.scope;
      updateSegmentedActive("[data-scope]", btn);
      applyFilters();
    });
  });

  // pick state segmented
  document.querySelectorAll("[data-pick-state]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterState.pickState = btn.dataset.pickState;
      updateSegmentedActive("[data-pick-state]", btn);
      applyFilters();
    });
  });

  // sort
  document.querySelectorAll(".qc-table thead th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = "desc";
      }
      updateSortIndicators();
      applyFilters();
    });
  });
  updateSortIndicators();

  // summary card click → filter shortcut
  document.querySelectorAll(".summary-card[data-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      const filter = card.dataset.filter; // 'all' | 'pending' | 'in-progress' | 'approved' | 'rejected'
      handleSummaryCardClick(filter, card);
    });
  });

  // refresh button
  const refreshBtn = document.getElementById("btnRefresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.classList.add("is-loading");
      await loadClaims();
      setTimeout(() => refreshBtn.classList.remove("is-loading"), 400);
    });
  }

  // modal close
  const modal = document.getElementById("qcModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeLightbox();
    }
  });

  console.log("✅ Event listeners ready");
}

function updateSegmentedActive(selector, activeBtn) {
  document.querySelectorAll(selector).forEach((b) => {
    b.classList.toggle("is-active", b === activeBtn);
  });
}

function updateSortIndicators() {
  document.querySelectorAll(".qc-table thead th.sortable").forEach((th) => {
    const key = th.dataset.sort;
    th.classList.remove("sort-asc", "sort-desc");
    if (key === sortKey) {
      th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function handleSummaryCardClick(filter, cardEl) {
  // reset อื่น ๆ ก่อน
  filterState.pickState = "all";
  filterState.status = "";

  switch (filter) {
    case "all":
      // no-op (เคลียร์)
      break;
    case "pending":
      filterState.pickState = "pending";
      break;
    case "in-progress":
      filterState.pickState = "picked";
      filterState.status = "checking";
      break;
    case "approved":
      filterState.status = "approved";
      break;
    case "rejected":
      filterState.status = "rejected";
      break;
  }

  // sync UI
  const statusEl = document.getElementById("filterStatus");
  if (statusEl) statusEl.value = filterState.status;

  document.querySelectorAll("[data-pick-state]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.pickState === filterState.pickState);
  });

  // highlight card
  document.querySelectorAll(".summary-card").forEach((c) => {
    c.classList.toggle("is-active", c === cardEl && filter !== "all");
  });

  applyFilters();
}

function setupLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (typeof logout === "function") {
      await logout();
      return;
    }
    await supabaseClient.auth.signOut();
    window.location.href = "/index.html";
  });
}

async function loadCurrentUserInfo() {
  try {
    const nameEl = document.getElementById("userName");
    const avatarEl = document.getElementById("userAvatar");
    if (!nameEl || typeof supabaseClient === "undefined") return;

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name, username, role")
      .eq("id", user.id)
      .single();

    const displayName =
      profile?.display_name || profile?.username || user.email || "ผู้ใช้งาน";
    nameEl.textContent = displayName;
    if (avatarEl) {
      avatarEl.textContent =
        displayName.trim().charAt(0).toUpperCase() || "👤";
    }
  } catch (err) {
    console.warn("loadCurrentUserInfo failed:", err);
  }
}

function updateHeaderDate() {
  const el = document.getElementById("appHeaderDateText");
  if (!el) return;
  const months = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];
  const now = new Date();
  el.textContent = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
}

// =====================================================
// LOAD CLAIMS
// =====================================================
async function loadClaims() {
  try {
    showTableLoading();

    const { data, error } = await supabaseClient
      .from("claims")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    allClaims = data || [];
    updateSummaryCards();
    applyFilters();
  } catch (err) {
    console.error("❌ loadClaims error:", err);
    showTableError("โหลดข้อมูลไม่สำเร็จ: " + err.message);
  }
}

// =====================================================
// SUMMARY CARDS
// =====================================================
function updateSummaryCards() {
  const sumTotal = document.getElementById("sumTotal");
  const sumPending = document.getElementById("sumPending");
  const sumInProgress = document.getElementById("sumInProgress");
  const sumApproved = document.getElementById("sumApproved");
  const sumRejected = document.getElementById("sumRejected");

  const pending = allClaims.filter((c) => !c.picked_at).length;
  const inProgress = allClaims.filter((c) => {
    if (!c.picked_at) return false;
    const s = normalizeStatus(c);
    return ["pending", "checking", "in_progress", "draft", "waiting_ceo"].includes(s);
  }).length;
  const approved = allClaims.filter((c) => {
    const s = normalizeStatus(c);
    return ["approved", "exec_approved"].includes(s);
  }).length;
  const rejected = allClaims.filter((c) => {
    const s = normalizeStatus(c);
    return ["rejected", "exec_rejected"].includes(s);
  }).length;

  if (sumTotal) sumTotal.textContent = allClaims.length;
  if (sumPending) sumPending.textContent = pending;
  if (sumInProgress) sumInProgress.textContent = inProgress;
  if (sumApproved) sumApproved.textContent = approved;
  if (sumRejected) sumRejected.textContent = rejected;
}

// =====================================================
// FILTERS + SORTING
// =====================================================
function applyFilters() {
  const { search, status, dateFrom, dateTo, scope, pickState } = filterState;

  filteredClaims = allClaims.filter((c) => {
    // search
    if (search && !getClaimSearchText(c).includes(search)) return false;

    // ✅ FIX: ใช้ normalizeStatus เทียบกับ qc_status ตรงๆ
    if (status) {
      const normalized = normalizeStatus(c);
      // 'approved' ครอบทั้ง 'approved' และ 'exec_approved'
      if (status === "approved" && !["approved", "exec_approved"].includes(normalized))
        return false;
      if (status === "rejected" && !["rejected", "exec_rejected"].includes(normalized))
        return false;
      if (!["approved", "rejected"].includes(status) && normalized !== status)
        return false;
    }

    // date range
    if (dateFrom && c.claim_date < dateFrom) return false;
    if (dateTo && c.claim_date > dateTo) return false;

    // scope
    if (scope) {
      if (getClaimScope(c) !== scope) return false;
    }

    // pick state
    if (pickState === "pending" && c.picked_at) return false;
    if (pickState === "picked" && !c.picked_at) return false;

    return true;
  });

  sortClaims(filteredClaims);
  renderTable(filteredClaims);
  updateResultCount();
}

function sortClaims(claims) {
  const STATUS_ORDER = {
    pending: 1, submitted: 1,
    checking: 2, in_progress: 2,
    draft: 3,
    waiting_ceo: 4,
    approved: 5, exec_approved: 5,
    rejected: 6, exec_rejected: 6,
  };

  claims.sort((a, b) => {
    let va, vb;
    if (sortKey === "qc_status") {
      va = STATUS_ORDER[normalizeStatus(a)] || 99;
      vb = STATUS_ORDER[normalizeStatus(b)] || 99;
    } else {
      // claim_date (fallback ไป created_at ถ้าไม่มี)
      va = a.claim_date || a.created_at || "";
      vb = b.claim_date || b.created_at || "";
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

function updateResultCount() {
  const el = document.getElementById("resultCount");
  if (el) {
    el.innerHTML = `แสดง <strong>${filteredClaims.length}</strong> จาก <strong>${allClaims.length}</strong> รายการ`;
  }
}

function resetFilters() {
  filterState.search = "";
  filterState.status = "";
  filterState.dateFrom = "";
  filterState.dateTo = "";
  filterState.scope = "";
  filterState.pickState = "all";

  const ids = ["searchInput", "filterStatus", "filterDateFrom", "filterDateTo"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // reset segmented
  document.querySelectorAll("[data-scope]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.scope === "");
  });
  document.querySelectorAll("[data-pick-state]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.pickState === "all");
  });

  // clear summary active
  document.querySelectorAll(".summary-card").forEach((c) => c.classList.remove("is-active"));

  applyFilters();
}

// =====================================================
// RENDER TABLE
// =====================================================
function buildStatusBadge(status) {
  const normalized = normalizeStatus(status);
  const map = {
    submitted: { label: "⏳ รอรับเรื่อง", cls: "submitted" },
    pending: { label: "⏳ รอรับเรื่อง", cls: "submitted" },
    checking: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    in_progress: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    draft: { label: "📝 บันทึกร่าง", cls: "draft" },
    waiting_ceo: { label: "⏳ รออนุมัติ CEO", cls: "waiting-ceo" },
    approved: { label: "✅ อนุมัติแล้ว", cls: "approved" },
    rejected: { label: "❌ ปฏิเสธ", cls: "rejected" },
    exec_approved: { label: "✅ CEO อนุมัติแล้ว", cls: "approved" },
    exec_rejected: { label: "❌ CEO ปฏิเสธ", cls: "rejected" },
  };
  const s = map[normalized] || map.pending;
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

function buildScopePill(claim) {
  const scope = getClaimScope(claim);
  if (scope === "internal") {
    return `<span class="scope-pill scope-internal">
      <span class="material-symbols-outlined">factory</span>ภายใน
    </span>`;
  }
  return `<span class="scope-pill scope-external">
    <span class="material-symbols-outlined">storefront</span>ลูกค้า
  </span>`;
}

function getStatusLabel(status) {
  const map = {
    submitted: "รอรับเรื่อง",
    pending: "รอรับเรื่อง",
    checking: "กำลังตรวจสอบ",
    in_progress: "กำลังตรวจสอบ",
    draft: "บันทึกร่าง",
    waiting_ceo: "รอ CEO อนุมัติ",
    approved: "อนุมัติแล้ว",
    rejected: "ปฏิเสธ",
    exec_approved: "CEO อนุมัติแล้ว",
    exec_rejected: "CEO ปฏิเสธ",
  };
  return map[normalizeStatus(status)] || status;
}

function buildThumbsHtml(urls, maxShow, imgClass, vidClass) {
  if (!urls || urls.length === 0) return "";
  let html = "";
  const show = urls.slice(0, maxShow);

  show.forEach((url) => {
    if (isVideo(url)) {
      html += `<div class="${vidClass}">🎥</div>`;
    } else {
      html += `<img class="${imgClass}" src="${escapeHtml(url)}" onerror="this.style.display='none'" alt="">`;
    }
  });

  if (urls.length > maxShow) {
    html += `<div class="cell-thumb-video" style="background:#64748b;font-size:0.72rem;">+${urls.length - maxShow}</div>`;
  }
  return html;
}

function renderTable(claims) {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;

  if (!claims || claims.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="table-empty">
          <span class="material-symbols-outlined empty-icon">search_off</span>
          <h4>ไม่พบรายการตามเงื่อนไข</h4>
          <p>ลองล้างตัวกรอง หรือเปลี่ยนช่วงวันที่</p>
        </td>
      </tr>`;
    return;
  }

  window._claims = {};
  claims.forEach((c) => {
    window._claims[c.id] = c;
  });

  tbody.innerHTML = "";

  claims.forEach((claim) => {
    const tr = document.createElement("tr");
    tr.onclick = () => openModal(claim);

    const mediaUrls = normalizeMediaUrls(claim.media_urls);
    const thumbHtml = buildThumbsHtml(mediaUrls, 3, "cell-thumb", "cell-thumb-video");
    const noMedia = mediaUrls.length === 0;

    const claimTypes = normalizeClaimTypes(claim.claim_types);
    const typesHtml =
      claimTypes.length > 0
        ? claimTypes.map((t) => `<span class="type-tag">${escapeHtml(t)}</span>`).join("")
        : '<span style="color:#cbd5e1;font-size:0.75rem;">—</span>';

    const customerLabel =
      claim.customer && String(claim.customer).trim()
        ? escapeHtml(claim.customer)
        : '<span style="color:#a8a29e;font-size:0.78rem;">— (ภายใน)</span>';

    tr.innerHTML = `
      <td>
        <div class="cell-date">${formatDate(claim.claim_date)}</div>
        <div class="cell-sub">${formatDateTime(claim.created_at)}</div>
      </td>
      <td>
        <div style="font-weight:500;">${escapeHtml(claim.emp_name) || "—"}</div>
        <div class="cell-sub">${escapeHtml(claim.area) || "—"}</div>
      </td>
      <td>
        ${buildScopePill(claim)}
        <div class="cell-sub" style="margin-top:4px;">${customerLabel}</div>
      </td>
      <td class="cell-product">
        <div>${escapeHtml(claim.product) || "—"}</div>
        <div class="cell-sub">${escapeHtml(claim.qty) || ""}</div>
      </td>
      <td><div class="cell-types">${typesHtml}</div></td>
      <td>
        ${noMedia
          ? '<span class="cell-no-media">ไม่มีไฟล์</span>'
          : `<div class="cell-thumbs">${thumbHtml}</div>`}
      </td>
      <td>${buildStatusBadge(claim)}</td>
      <td>
        <div class="cell-action-group">
          <button class="btn-view" onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])">
            <span class="material-symbols-outlined">open_in_new</span>
            ดู
          </button>
          ${!claim.picked_at ? `
            <button class="btn-pick" onclick="event.stopPropagation(); pickClaim('${claim.id}')">
              <span class="material-symbols-outlined">how_to_reg</span>
              รับเรื่อง
            </button>
          ` : ""}
        </div>
      </td>`;

    tbody.appendChild(tr);
  });
}

// =====================================================
// MODAL
// =====================================================
function openModal(claim) {
  if (!claim) return;
  currentClaim = claim;

  const modal = document.getElementById("qcModal");
  if (!modal) return;

  modal.classList.add("open");

  const modalTitle = document.getElementById("modalTitle");
  if (modalTitle) modalTitle.textContent = `เคลม #${getClaimNo(claim)}`;

  const scope = getClaimScope(claim);

  const modalInfoGrid = document.getElementById("modalInfoGrid");
  if (modalInfoGrid) {
    modalInfoGrid.innerHTML = `
      <div class="info-row">
        <div class="info-label">ประเภทเคลม</div>
        <div class="info-value">${buildScopePill(claim)}</div>
      </div>
      <div class="info-row">
        <div class="info-label">สถานะ</div>
        <div class="info-value">${buildStatusBadge(claim)}</div>
      </div>
      <div class="info-row">
        <div class="info-label">พนักงาน / ผู้แจ้ง</div>
        <div class="info-value">${escapeHtml(claim.emp_name) || "—"}</div>
      </div>
      <div class="info-row">
        <div class="info-label">เขต / แผนก</div>
        <div class="info-value">${escapeHtml(claim.area) || "—"}</div>
      </div>
      ${scope === "external" ? `
      <div class="info-row full">
        <div class="info-label">ร้านค้า / ลูกค้า</div>
        <div class="info-value">${escapeHtml(claim.customer) || "—"}</div>
      </div>` : ""}
      <div class="info-row">
        <div class="info-label">วันที่แจ้งเคลม</div>
        <div class="info-value">${formatDate(claim.claim_date)}</div>
      </div>
      <div class="info-row">
        <div class="info-label">วันที่รับเรื่อง</div>
        <div class="info-value">${claim.picked_at ? formatDateTime(claim.picked_at) : "— (ยังไม่ได้รับ)"}</div>
      </div>
      <div class="info-row full">
        <div class="info-label">สินค้า</div>
        <div class="info-value">${escapeHtml(claim.product) || "—"}</div>
      </div>
      <div class="info-row">
        <div class="info-label">จำนวน</div>
        <div class="info-value">${escapeHtml(claim.qty) || "—"}</div>
      </div>
      <div class="info-row">
        <div class="info-label">วันที่เปิดบิล</div>
        <div class="info-value">${formatDate(claim.buy_date)}</div>
      </div>
      ${claim.qc_comment ? `
      <div class="info-row full">
        <div class="info-label">หมายเหตุ QC ปัจจุบัน</div>
        <div class="info-value">${escapeHtml(claim.qc_comment)}</div>
      </div>` : ""}
    `;
  }

  const typesEl = document.getElementById("modalClaimTypes");
  if (typesEl) {
    const claimTypes = normalizeClaimTypes(claim.claim_types);
    typesEl.innerHTML =
      claimTypes.length > 0
        ? claimTypes.map((t) => `<span class="modal-type-tag">${escapeHtml(t)}</span>`).join("")
        : '<span style="color:#94a3b8;">ไม่ระบุ</span>';
  }

  const modalDetail = document.getElementById("modalDetail");
  if (modalDetail) modalDetail.textContent = claim.detail || "—";

  renderModalMedia(normalizeMediaUrls(claim.media_urls));

  const qcStatusEl = document.getElementById("qcStatusCurrent");
  if (qcStatusEl) {
    qcStatusEl.innerHTML = `สถานะปัจจุบัน: ${buildStatusBadge(claim)}`;
  }

  const qcCommentEl = document.getElementById("qcComment");
  if (qcCommentEl) qcCommentEl.value = claim.qc_comment || "";

  // lock ถ้าตัดสินใจแล้ว
  const actionSection = document.querySelector(".qc-action-section");
  const actionButtons = document.querySelectorAll(".qc-action-btns button");
  const normalized = normalizeStatus(claim);
  const isDecided = ["approved", "rejected", "exec_approved", "exec_rejected"].includes(normalized);
  if (actionSection) actionSection.classList.toggle("is-readonly", isDecided);
  actionButtons.forEach((btn) => { btn.disabled = isDecided; });
}

function renderModalMedia(urls) {
  const grid = document.getElementById("modalMediaGrid");
  if (!grid) return;

  if (!urls || urls.length === 0) {
    grid.innerHTML = '<div class="media-no-file">ไม่มีรูปภาพหรือวิดีโอที่แนบ</div>';
    return;
  }

  grid.innerHTML = "";

  urls.forEach((url) => {
    const item = document.createElement("div");
    item.className = "media-item";

    if (isVideo(url)) {
      item.innerHTML = `
        <div class="media-video-wrap">
          <video src="${escapeHtml(url)}" preload="metadata"></video>
          <div class="media-play-icon">▶</div>
        </div>`;
      item.onclick = () => window.open(url, "_blank");
    } else {
      item.innerHTML = `<img src="${escapeHtml(url)}" alt="" onerror="this.parentElement.style.display='none'">`;
      item.onclick = () => openLightbox(url);
    }
    grid.appendChild(item);
  });
}

function closeModal() {
  const modal = document.getElementById("qcModal");
  if (modal) modal.classList.remove("open");
  currentClaim = null;
}

// =====================================================
// PICK CLAIM
// =====================================================
async function pickClaim(claimId) {
  const claim =
    (window._claims || {})[claimId] ||
    allClaims.find((c) => String(c.id) === String(claimId));

  if (!claim) {
    showToast("ไม่พบข้อมูลเคลม", "danger");
    return;
  }

  try {
    const claimScope = claim.claim_scope || getClaimScope(claim) || "external";
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    const now = new Date().toISOString();

    const { data, error } = await supabaseClient
      .from("claims")
      .update({
        status: "in_progress",
        qc_status: "checking",
        claim_scope: claimScope,
        picked_by: user?.id || null,
        picked_at: now,
        updated_at: now,
      })
      .eq("id", claim.id)
      .select("*");

    if (error) {
      console.error("❌ update error:", error);
      showToast("รับเรื่องไม่สำเร็จ: " + error.message, "danger");
      return;
    }

    if (!data || data.length === 0) {
      showToast("กดแล้วแต่ไม่มีแถวถูกอัปเดต — น่าจะติด RLS policy", "warning");
      return;
    }

    const updatedClaim = data[0];
    const idx = allClaims.findIndex((c) => c.id === claim.id);
    if (idx !== -1) allClaims[idx] = updatedClaim;

    // LINE notify
    try {
      await notifyLine("claim_picked", {
        claim: updatedClaim,
        actor: { name: await getCurrentUserName(), role: "qc" },
      });
    } catch (lineErr) {
      console.warn("LINE notify failed (non-critical):", lineErr);
    }

    await showSuccessPopup({
      title: "รับเรื่องสำเร็จ",
      message: `กำลังนำคุณไปยังหน้าตรวจสอบเคลม${claimScope === "internal" ? "ภายใน" : "ลูกค้า"}...`,
      buttonText: "ไปต่อ",
      icon: claimScope === "internal" ? "factory" : "storefront",
      autoCloseMs: 1200,
    });

    if (claimScope === "internal") {
      window.location.href = "/pages/Qc-claim/internal-claims.html";
    } else {
      window.location.href = "/pages/Qc-claim/external-claims.html";
    }
  } catch (err) {
    console.error("❌ pickClaim error:", err);
    showToast("รับเรื่องไม่สำเร็จ: " + err.message, "danger");
  }
}

// =====================================================
// UPDATE CLAIM STATUS — ✅ FIX: update qc_status ด้วย
// =====================================================
async function updateClaimStatus(newStatus) {
  if (!currentClaim) return;

  const qcCommentEl = document.getElementById("qcComment");
  const comment = qcCommentEl ? qcCommentEl.value.trim() : "";
  const label = newStatus === "approved" ? "อนุมัติ" : "ปฏิเสธ";
  const variant = newStatus === "approved" ? "success" : "danger";
  const icon = newStatus === "approved" ? "check_circle" : "cancel";

  const result = await showConfirmDialog({
    title: `ยืนยันการ${label}เคลม`,
    message: `ต้องการ${label}เคลม #${getClaimNo(currentClaim)} ใช่หรือไม่?`,
    confirmText: `ยืนยัน${label}`,
    cancelText: "ยกเลิก",
    icon,
    variant,
    showNote: false,
  });
  if (!result?.confirmed) return;

  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    const now = new Date().toISOString();

    // ✅ FIX: เขียน qc_status ด้วย ให้ตรงกับสิ่งที่ badge อ่าน
    const updateData = {
      status: newStatus,
      qc_status: newStatus,
      qc_comment: comment || null,
      qc_by: user?.id || null,
      updated_at: now,
    };

    const { error } = await supabaseClient
      .from("claims")
      .update(updateData)
      .eq("id", currentClaim.id);

    if (error) throw error;

    // sync local state
    const idx = allClaims.findIndex((c) => c.id === currentClaim.id);
    if (idx !== -1) {
      allClaims[idx] = {
        ...allClaims[idx],
        ...updateData,
      };
    }

    updateSummaryCards();
    const claimSnapshot = idx !== -1 ? allClaims[idx] : currentClaim;

    closeModal();
    applyFilters();

    // LINE notify
    try {
      await notifyLine(
        newStatus === "approved" ? "claim_approved" : "claim_rejected",
        {
          claim: claimSnapshot,
          actor: { name: await getCurrentUserName(), role: "qc" },
          comment,
        }
      );
    } catch (lineErr) {
      console.warn("LINE notify failed (non-critical):", lineErr);
    }

    await showSuccessPopup({
      title: `${label}สำเร็จ`,
      message: `เคลม #${getClaimNo(claimSnapshot)} ถูก${label}เรียบร้อยแล้ว`,
      buttonText: "ตกลง",
      icon,
    });
  } catch (err) {
    console.error("❌ updateClaimStatus error:", err);
    showToast("เกิดข้อผิดพลาด: " + err.message, "danger");
  }
}

// =====================================================
// LINE NOTIFY HELPER
// =====================================================
async function notifyLine(eventType, payload) {
  const sendLineNotify = await getSendLineNotify();
  return sendLineNotify({
    type: eventType,
    claim: payload.claim,
    actor: payload.actor || null,
    comment: payload.comment || "",
  });
}

async function getCurrentUserName() {
  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) return "ระบบ";

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name, username")
      .eq("id", user.id)
      .single();

    return profile?.display_name || profile?.username || user.email || "ระบบ";
  } catch (err) {
    console.warn("getCurrentUserName failed:", err);
    return "ระบบ";
  }
}

// =====================================================
// LIGHTBOX
// =====================================================
function openLightbox(url) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (lb && img) {
    img.src = url;
    lb.classList.add("open");
  }
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (lb) lb.classList.remove("open");
  if (img) img.src = "";
}

// =====================================================
// EXPORT (เก็บไว้เหมือนเดิม + ปรับเล็กน้อย)
// =====================================================
function exportPDF() {
  if (!currentClaim) {
    showToast("กรุณาเลือกเคลมก่อน", "warning");
    return;
  }
  const c = currentClaim;

  const mediaHtml =
    normalizeMediaUrls(c.media_urls).length > 0
      ? normalizeMediaUrls(c.media_urls)
          .filter((u) => !isVideo(u))
          .map((u) => `<img src="${escapeHtml(u)}" style="width:180px;height:180px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" onerror="this.style.display='none'">`)
          .join("")
      : '<p style="color:#94a3b8;">ไม่มีรูปภาพ</p>';

  const typesHtml =
    normalizeClaimTypes(c.claim_types).length > 0
      ? normalizeClaimTypes(c.claim_types)
          .map((t) => `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:20px;padding:3px 12px;font-size:13px;margin-right:4px;">${escapeHtml(t)}</span>`)
          .join("")
      : "—";

  const statusLabel = getStatusLabel(c);

  const printWin = window.open("", "_blank", "width=900,height=700");
  if (!printWin) {
    showToast("กรุณาอนุญาต popup เพื่อพิมพ์ PDF", "warning");
    return;
  }

  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบแจ้งเคลม — ${escapeHtml(getClaimNo(c))}</title>
      <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Kanit', sans-serif; color: #1e293b; padding: 32px; max-width: 800px; margin: auto; }
        h1 { font-size: 1.4rem; color: #0f172a; margin-bottom: 4px; }
        .sub { color: #64748b; font-size: 0.85rem; margin-bottom: 24px; }
        .section { margin-bottom: 24px; }
        .section-title { font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .info-box { background: #f8fafc; border-radius: 8px; padding: 10px 14px; }
        .info-lbl { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; }
        .info-val { font-weight: 500; font-size: 0.9rem; }
        .detail-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; line-height: 1.7; min-height: 60px; white-space: pre-wrap; }
        .media-wrap { display: flex; flex-wrap: wrap; gap: 10px; }
        .footer-note { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 0.75rem; color: #94a3b8; display: flex; justify-content: space-between; }
        @media print { body { padding: 16px; } }
      </style>
    </head>
    <body>
      <h1>⚠️ ใบแจ้งเคลมสินค้า</h1>
      <div class="sub">เลขที่: ${escapeHtml(getClaimNo(c))} • สร้างเมื่อ: ${formatDateTime(c.created_at)}</div>

      <div class="section">
        <div class="section-title">ข้อมูลการแจ้งเคลม</div>
        <div class="grid2">
          <div class="info-box"><div class="info-lbl">ผู้แจ้ง</div><div class="info-val">${escapeHtml(c.emp_name) || "—"}</div></div>
          <div class="info-box"><div class="info-lbl">เขต/แผนก</div><div class="info-val">${escapeHtml(c.area) || "—"}</div></div>
          <div class="info-box"><div class="info-lbl">ร้านค้า / ลูกค้า</div><div class="info-val">${escapeHtml(c.customer) || "— (ภายใน)"}</div></div>
          <div class="info-box"><div class="info-lbl">วันที่แจ้งเคลม</div><div class="info-val">${formatDate(c.claim_date)}</div></div>
          <div class="info-box" style="grid-column:1/-1"><div class="info-lbl">สินค้า</div><div class="info-val">${escapeHtml(c.product) || "—"}</div></div>
          <div class="info-box"><div class="info-lbl">จำนวน</div><div class="info-val">${escapeHtml(c.qty) || "—"}</div></div>
          <div class="info-box"><div class="info-lbl">สถานะ</div><div class="info-val">${statusLabel}</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">ประเภทปัญหา</div>
        <div>${typesHtml}</div>
      </div>

      <div class="section">
        <div class="section-title">รายละเอียด</div>
        <div class="detail-box">${escapeHtml(c.detail) || "—"}</div>
      </div>

      <div class="section">
        <div class="section-title">รูปภาพประกอบ</div>
        <div class="media-wrap">${mediaHtml}</div>
      </div>

      <div class="footer-note">
        <span>EABaseHub — ระบบจัดการเคลมสินค้า</span>
        <span>พิมพ์เมื่อ: ${new Date().toLocaleString("th-TH")}</span>
      </div>
    </body>
    </html>
  `);
  printWin.document.close();
  printWin.onload = () => printWin.print();
}

function exportCSV() {
  if (!currentClaim) {
    showToast("กรุณาเลือกเคลมก่อน", "warning");
    return;
  }
  const c = currentClaim;
  const rows = buildSingleClaimRows(c);
  exportRowsAsCsv(rows, `claim_${getClaimNo(c)}.csv`);
}

function buildSingleClaimRows(c) {
  return [
    ["หัวข้อ", "ค่า"],
    ["เลขเคลม", getClaimNo(c)],
    ["ประเภทเคลม", getClaimScope(c) === "internal" ? "ภายใน" : "ลูกค้า"],
    ["ผู้แจ้ง", c.emp_name || "-"],
    ["เขต/แผนก", c.area || "-"],
    ["ร้านค้า / ลูกค้า", c.customer || "-"],
    ["สินค้า", c.product || "-"],
    ["จำนวน", c.qty || "-"],
    ["ประเภทปัญหา", normalizeClaimTypes(c.claim_types).join(", ")],
    ["รายละเอียด", (c.detail || "").replace(/\n/g, " ")],
    ["สถานะ", getStatusLabel(c)],
    ["วันที่แจ้งเคลม", formatDate(c.claim_date)],
    ["วันที่เปิดบิล", formatDate(c.buy_date)],
    ["วันที่ผลิต", formatDate(c.mfg_date)],
    ["วันที่รับเรื่อง", c.picked_at ? formatDateTime(c.picked_at) : "-"],
    ["หมายเหตุ QC", c.qc_comment || "-"],
    ["สร้างเมื่อ", formatDateTime(c.created_at)],
  ];
}

function exportRowsAsCsv(rows, filename) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลด CSV สำเร็จ", "success");
}

function exportExcel() {
  if (currentClaim) {
    exportSingleClaimExcel();
    return;
  }
  if (!filteredClaims || filteredClaims.length === 0) {
    showToast("ไม่มีข้อมูลสำหรับ Export", "warning");
    return;
  }

  const rows = [
    [
      "เลขเคลม", "ประเภท", "วันที่แจ้ง", "ผู้แจ้ง", "เขต/แผนก", "ลูกค้า",
      "สินค้า", "จำนวน", "ประเภทปัญหา", "รายละเอียด", "สถานะ",
      "วันที่บิล", "วันที่ผลิต", "วันที่รับเรื่อง", "หมายเหตุ QC",
    ],
  ];

  filteredClaims.forEach((c) => {
    rows.push([
      getClaimNo(c),
      getClaimScope(c) === "internal" ? "ภายใน" : "ลูกค้า",
      formatDate(c.claim_date),
      c.emp_name || "",
      c.area || "",
      c.customer || "",
      c.product || "",
      c.qty || "",
      normalizeClaimTypes(c.claim_types).join(", "),
      (c.detail || "").replace(/\n/g, " "),
      getStatusLabel(c),
      formatDate(c.buy_date),
      formatDate(c.mfg_date),
      c.picked_at ? formatDateTime(c.picked_at) : "",
      c.qc_comment || "",
    ]);
  });

  if (typeof XLSX !== "undefined") {
    try {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 12 },
        { wch: 20 }, { wch: 25 }, { wch: 8 }, { wch: 20 }, { wch: 30 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 20 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Claims");
      XLSX.writeFile(wb, `claims_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast(`ดาวน์โหลด ${filteredClaims.length} รายการสำเร็จ`, "success");
      return;
    } catch (err) {
      console.warn("XLSX export failed, fallback to CSV:", err);
    }
  }

  exportRowsAsCsv(rows, `claims_export_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportSingleClaimExcel() {
  if (!currentClaim) {
    showToast("ไม่พบข้อมูลเคลม", "warning");
    return;
  }
  const c = currentClaim;
  const data = buildSingleClaimRows(c);

  if (typeof XLSX !== "undefined") {
    try {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws["!cols"] = [{ wch: 22 }, { wch: 50 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Claim Detail");
      XLSX.writeFile(wb, `claim_${getClaimNo(c)}.xlsx`);
      showToast("ดาวน์โหลด Excel สำเร็จ", "success");
      return;
    } catch (err) {
      console.warn("XLSX export failed, fallback to CSV:", err);
    }
  }
  exportRowsAsCsv(data, `claim_${getClaimNo(c)}.csv`);
}

// =====================================================
// SUCCESS POPUP
// =====================================================
function showSuccessPopup({
  title = "สำเร็จ",
  message = "ดำเนินการเรียบร้อยแล้ว",
  buttonText = "ตกลง",
  icon = "check_circle",
  autoCloseMs = 0,
} = {}) {
  return new Promise((resolve) => {
    document.getElementById("ea-success-popup")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "ea-success-popup";
    wrap.className = "ea-success-overlay";
    wrap.innerHTML = `
      <div class="ea-success-box" role="dialog" aria-modal="true">
        <div class="ea-success-icon-wrap">
          <svg class="ea-success-checkmark" viewBox="0 0 52 52">
            <path class="ea-success-check" d="M14 27 L22 35 L38 18"/>
          </svg>
        </div>
        <div class="ea-success-body">
          <h3 class="ea-success-title">${escapeHtml(title)}</h3>
          <p class="ea-success-message">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
        </div>
        <div class="ea-success-actions">
          <button type="button" class="ea-success-btn-ok">
            <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
            ${escapeHtml(buttonText)}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const okBtn = wrap.querySelector(".ea-success-btn-ok");
    let autoTimer = null;

    function cleanup() {
      wrap.classList.add("closing");
      document.removeEventListener("keydown", onKey);
      if (autoTimer) clearTimeout(autoTimer);
      setTimeout(() => {
        wrap.remove();
        resolve(true);
      }, 220);
    }
    function onKey(e) {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        cleanup();
      }
    }

    okBtn.addEventListener("click", cleanup);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) cleanup(); });
    document.addEventListener("keydown", onKey);
    if (autoCloseMs > 0) autoTimer = setTimeout(cleanup, autoCloseMs);

    requestAnimationFrame(() => {
      wrap.classList.add("open");
      if (okBtn) okBtn.focus();
    });
  });
}

// =====================================================
// CONFIRM DIALOG
// =====================================================
function showConfirmDialog({
  title = "ยืนยันการดำเนินการ",
  message = "ต้องการดำเนินการต่อหรือไม่?",
  noteLabel = "หมายเหตุ / ความเห็นเพิ่มเติม",
  notePlaceholder = "พิมพ์ข้อความ... (ไม่บังคับ)",
  initialNote = "",
  confirmText = "ยืนยัน",
  cancelText = "ยกเลิก",
  icon = "help",
  variant = "primary",
  showNote = true,
} = {}) {
  return new Promise((resolve) => {
    document.getElementById("ea-confirm-dialog")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "ea-confirm-dialog";
    wrap.className = "ea-confirm-overlay";

    const cancelBtnHtml = cancelText
      ? `<button type="button" class="ea-confirm-btn-cancel">
           <span class="material-symbols-outlined">close</span>
           ${escapeHtml(cancelText)}
         </button>`
      : "";

    const noteHtml = showNote
      ? `<div class="ea-confirm-body">
           <label for="eaConfirmNote" class="ea-confirm-label">${escapeHtml(noteLabel)}</label>
           <textarea id="eaConfirmNote" class="ea-confirm-textarea"
             placeholder="${escapeHtml(notePlaceholder)}" rows="3">${escapeHtml(initialNote)}</textarea>
           <div class="ea-confirm-hint">
             <span class="material-symbols-outlined">keyboard</span>
             กด <kbd>Ctrl</kbd>+<kbd>Enter</kbd> เพื่อยืนยัน · <kbd>Esc</kbd> เพื่อยกเลิก
           </div>
         </div>`
      : "";

    wrap.innerHTML = `
      <div class="ea-confirm-box ea-confirm-${escapeHtml(variant)}" role="dialog" aria-modal="true">
        <div class="ea-confirm-header">
          <div class="ea-confirm-icon">
            <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
          </div>
          <div class="ea-confirm-title-wrap">
            <h3 class="ea-confirm-title">${escapeHtml(title)}</h3>
            <p class="ea-confirm-message">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
          </div>
          <button type="button" class="ea-confirm-close" aria-label="ปิด">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        ${noteHtml}
        <div class="ea-confirm-actions">
          ${cancelBtnHtml}
          <button type="button" class="ea-confirm-btn-ok">
            <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
            ${escapeHtml(confirmText)}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const noteEl = wrap.querySelector("#eaConfirmNote");
    const okBtn = wrap.querySelector(".ea-confirm-btn-ok");
    const cancelBtn = wrap.querySelector(".ea-confirm-btn-cancel");
    const closeBtn = wrap.querySelector(".ea-confirm-close");

    function cleanup(result) {
      wrap.classList.add("closing");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => {
        wrap.remove();
        resolve(result);
      }, 180);
    }
    function onConfirm() {
      cleanup({ confirmed: true, note: (noteEl?.value || "").trim() });
    }
    function onCancel() {
      cleanup({ confirmed: false, note: "" });
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onConfirm();
      }
    }

    okBtn.addEventListener("click", onConfirm);
    if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
    closeBtn.addEventListener("click", onCancel);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) onCancel(); });
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => {
      wrap.classList.add("open");
      if (showNote && noteEl) noteEl.focus();
      else if (okBtn) okBtn.focus();
    });
  });
}

// =====================================================
// TOAST
// =====================================================
function showToast(message, type = "success", opts = {}) {
  const old = document.getElementById("ea-toast");
  if (old) old.remove();

  const colorMap = {
    success: { bg: "#10b981", icon: "✅" },
    danger: { bg: "#ef4444", icon: "❌" },
    error: { bg: "#ef4444", icon: "❌" },
    warning: { bg: "#f59e0b", icon: "⚠️" },
    info: { bg: "#3b82f6", icon: "ℹ️" },
  };
  const c = colorMap[type] || colorMap.success;
  const duration = Number.isFinite(opts.duration) ? opts.duration : 3000;

  const toast = document.createElement("div");
  toast.id = "ea-toast";
  toast.style.cssText = `
    position: fixed; bottom: 32px; right: 32px;
    background: ${c.bg}; color: #fff;
    font-family: "Kanit","IBM Plex Sans Thai",sans-serif;
    font-size: 14px; font-weight: 500;
    padding: 12px 20px; border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,.2);
    display: flex; align-items: center; gap: 8px;
    z-index: 99999; opacity: 0;
    transform: translateY(12px);
    transition: opacity .3s ease, transform .3s ease;
    max-width: 420px; white-space: pre-wrap;
  `;
  toast.innerHTML = `<span>${c.icon}</span><span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(12px)";
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }, duration);
}

// =====================================================
// LOADING / ERROR HELPERS
// =====================================================
function showTableLoading() {
  const tbody = document.getElementById("qcTableBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="table-loading">
          <span class="material-symbols-outlined spin">progress_activity</span>
          กำลังโหลด...
        </td>
      </tr>`;
  }
}

function showTableError(msg) {
  const tbody = document.getElementById("qcTableBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="table-loading" style="color:#dc2626;">
          ❌ ${escapeHtml(msg)}
        </td>
      </tr>`;
  }
}

// =====================================================
// EXPOSE TO GLOBAL
// =====================================================
window.openModal = openModal;
window.closeModal = closeModal;
window.pickClaim = pickClaim;
window.updateClaimStatus = updateClaimStatus;
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.exportPDF = exportPDF;
window.exportCSV = exportCSV;
window.exportExcel = exportExcel;
window.exportSingleClaimExcel = exportSingleClaimExcel;
window.resetFilters = resetFilters;
window.applyFilters = applyFilters;
window.showConfirmDialog = showConfirmDialog;
window.showSuccessPopup = showSuccessPopup;

console.log("✅ adminQc.js (v3.0) loaded");