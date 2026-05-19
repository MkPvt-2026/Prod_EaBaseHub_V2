// =====================================================
// adminQc.js (v3.2 — Bug-fixed & polished)
// หน้า QC Dashboard กลาง — ตรวจสอบ รับเรื่อง Export
// =====================================================

// ── lazy-load sendLineNotify ──────────────────────────
let _sendLineNotify = null;
async function getSendLineNotify() {
  if (_sendLineNotify) return _sendLineNotify;
  try {
    const mod = await import("/js/services/lineNotify.js");
    _sendLineNotify = mod.sendLineNotify;
    return _sendLineNotify;
  } catch (err) {
    console.warn("⚠️  lineNotify.js ไม่พบ — LINE notifications disabled", err);
    throw err;
  }
}

// ── State ─────────────────────────────────────────────
let allClaims      = [];
let filteredClaims = [];
let currentClaim   = null;
let sortKey        = "claim_date";
let sortDir        = "desc";

const filterState = {
  search:    "",
  status:    "",
  dateFrom:  "",
  dateTo:    "",
  scope:     "",
  pickState: "all",
};

// ── Helpers ───────────────────────────────────────────

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * คืนค่า status ที่ normalize แล้ว
 * รับได้ทั้ง object (claim) หรือ string (status raw)
 */
function normalizeStatus(claimOrStatus) {
  if (claimOrStatus && typeof claimOrStatus === "object") {
    const c = claimOrStatus;
    // exec_status ที่ final ให้ใช้ก่อน
    if (c.exec_status === "approved") return "exec_approved";
    if (c.exec_status === "rejected") return "exec_rejected";
    return c.qc_status || c.status || "pending";
  }
  // string
  const s = String(claimOrStatus || "");
  if (s === "submitted")   return "pending";
  if (s === "in_progress") return "checking";
  return s || "pending";
}

function normalizeMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const p = JSON.parse(value);
      if (Array.isArray(p)) return p.filter(Boolean);
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
      const p = JSON.parse(value);
      if (Array.isArray(p)) return p.filter(Boolean);
    } catch (_) {}
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function getClaimNo(claim) {
  const raw = claim?.claim_no || claim?.claim_code || claim?.claim_id || claim?.id || "";
  return String(raw).substring(0, 8).toUpperCase() || "—";
}

function getClaimSearchText(claim) {
  return [
    claim.product, claim.customer, claim.emp_name,
    claim.area, claim.detail, getClaimNo(claim),
  ].filter(Boolean).join(" ").toLowerCase();
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

async function waitForSupabase(timeoutMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === "undefined") {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

/**
 * ระบุ scope ของ claim (internal / external)
 * ใช้ claim_scope field ก่อน — ถ้าไม่มีค่อย infer จาก customer
 */
function getClaimScope(claim) {
  if (!claim) return "external";
  const scopeField = (claim.claim_scope || "").trim().toLowerCase();
  if (scopeField === "internal") return "internal";
  if (scopeField === "external") return "external";

  // ไม่มี claim_scope — infer จาก customer
  const customer = String(claim.customer || "").trim();
  if (!customer) return "internal";
  return "external";
}

// ── Init ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const ready = await waitForSupabase();
    if (!ready) {
      alert("ไม่สามารถเชื่อมต่อระบบได้ — กรุณารีเฟรชหน้า");
      return;
    }

    setupSidebarState();
    setupLogout();
    updateHeaderDate();

    if (typeof protectPage === "function") {
      await protectPage(["admin", "adminQc", "adminqc"]);
    }

    await loadCurrentUserInfo();
    await loadClaims();
    setupEventListeners();

    console.log("✅ adminQc v3.2 ready");
  } catch (err) {
    console.error("❌ Init error:", err);
    showTableError("เกิดข้อผิดพลาดตอนเริ่มต้น: " + err.message);
  }
});

// ── Sidebar ───────────────────────────────────────────

function setupSidebarState() {
  const saved = localStorage.getItem("ea-sidebar-expanded");
  if (saved === "1") document.body.classList.add("sidebar-expanded");

  const toggle = document.querySelector(".ea-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const expanded = document.body.classList.toggle("sidebar-expanded");
      localStorage.setItem("ea-sidebar-expanded", expanded ? "1" : "0");
    });
  }
}

function setupLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (typeof logout === "function") { await logout(); return; }
    await supabaseClient.auth.signOut();
    window.location.href = "/index.html";
  });
}

// ── Event Listeners ───────────────────────────────────

function setupEventListeners() {
  // Search input (debounced)
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

  // Status select
  const statusEl = document.getElementById("filterStatus");
  if (statusEl) {
    statusEl.addEventListener("change", () => {
      filterState.status = statusEl.value;
      applyFilters();
    });
  }

  // Date range
  ["filterDateFrom", "filterDateTo"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        filterState[id === "filterDateFrom" ? "dateFrom" : "dateTo"] = el.value;
        applyFilters();
      });
    }
  });

  // Scope segment
  document.querySelectorAll("[data-scope]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterState.scope = btn.dataset.scope;
      updateSegmentActive("[data-scope]", btn);
      applyFilters();
    });
  });

  // Pick-state segment
  document.querySelectorAll("[data-pick-state]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterState.pickState = btn.dataset.pickState;
      updateSegmentActive("[data-pick-state]", btn);
      applyFilters();
    });
  });

  // Sort headers
  document.querySelectorAll(".qc-table thead th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = key; sortDir = "desc"; }
      updateSortIndicators();
      applyFilters();
    });
  });
  updateSortIndicators();

  // Summary card shortcuts
  document.querySelectorAll(".summary-card[data-filter]").forEach((card) => {
    card.addEventListener("click", () => handleSummaryCardClick(card.dataset.filter, card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSummaryCardClick(card.dataset.filter, card);
      }
    });
  });

  // Refresh button
  const btnRefresh = document.getElementById("btnRefresh");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", async () => {
      btnRefresh.classList.add("is-loading");
      await loadClaims();
      setTimeout(() => btnRefresh.classList.remove("is-loading"), 400);
    });
  }

  // Modal backdrop close
  const modal = document.getElementById("qcModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeLightbox(); }
  });
}

function updateSegmentActive(selector, activeBtn) {
  document.querySelectorAll(selector).forEach((b) =>
    b.classList.toggle("is-active", b === activeBtn)
  );
}

function updateSortIndicators() {
  document.querySelectorAll(".qc-table thead th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === sortKey) {
      th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function handleSummaryCardClick(filter, cardEl) {
  // Reset relevant filters
  filterState.pickState = "all";
  filterState.status    = "";

  switch (filter) {
    case "pending":
      filterState.pickState = "pending";
      break;
    case "in-progress":
      filterState.pickState = "picked";
      filterState.status    = "checking";
      break;
    case "approved":
      filterState.status = "approved";
      break;
    case "rejected":
      filterState.status = "rejected";
      break;
    default: /* "all" — already reset above */ break;
  }

  const statusEl = document.getElementById("filterStatus");
  if (statusEl) statusEl.value = filterState.status;

  document.querySelectorAll("[data-pick-state]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.pickState === filterState.pickState)
  );
  document.querySelectorAll(".summary-card").forEach((c) =>
    c.classList.toggle("is-active", c === cardEl && filter !== "all")
  );

  applyFilters();
}

// ── Data Loading ──────────────────────────────────────

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
    console.error("❌ loadClaims:", err);
    showTableError("โหลดข้อมูลไม่สำเร็จ: " + err.message);
  }
}

async function loadCurrentUserInfo() {
  try {
    const nameEl   = document.getElementById("userName");
    const avatarEl = document.getElementById("userAvatar");
    if (!nameEl || typeof supabaseClient === "undefined") return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name, username, role")
      .eq("id", user.id)
      .single();

    const displayName = profile?.display_name || profile?.username || user.email || "ผู้ใช้งาน";
    nameEl.textContent = displayName;
    if (avatarEl) avatarEl.textContent = displayName.trim().charAt(0).toUpperCase() || "👤";
  } catch (err) {
    console.warn("loadCurrentUserInfo:", err);
  }
}

function updateHeaderDate() {
  const el = document.getElementById("appHeaderDateText");
  if (!el) return;
  const months = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const now = new Date();
  el.textContent = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
}

// ── Summary Cards ─────────────────────────────────────

function updateSummaryCards() {
  const pending    = allClaims.filter((c) => !c.picked_at).length;
  const inProgress = allClaims.filter((c) => {
    if (!c.picked_at) return false;
    const s = normalizeStatus(c);
    return ["pending","checking","in_progress","draft","waiting_ceo"].includes(s);
  }).length;
  const approved = allClaims.filter((c) =>
    ["approved","exec_approved"].includes(normalizeStatus(c))
  ).length;
  const rejected = allClaims.filter((c) =>
    ["rejected","exec_rejected"].includes(normalizeStatus(c))
  ).length;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("sumTotal",      allClaims.length);
  set("sumPending",    pending);
  set("sumInProgress", inProgress);
  set("sumApproved",   approved);
  set("sumRejected",   rejected);
}

// ── Filtering & Sorting ───────────────────────────────

function applyFilters() {
  const { search, status, dateFrom, dateTo, scope, pickState } = filterState;

  filteredClaims = allClaims.filter((c) => {
    if (search && !getClaimSearchText(c).includes(search)) return false;

    if (status) {
      const ns = normalizeStatus(c);
      if (status === "approved" && !["approved","exec_approved"].includes(ns)) return false;
      if (status === "rejected" && !["rejected","exec_rejected"].includes(ns)) return false;
      if (!["approved","rejected"].includes(status) && ns !== status) return false;
    }

    if (dateFrom && c.claim_date && c.claim_date < dateFrom) return false;
    if (dateTo   && c.claim_date && c.claim_date > dateTo)   return false;

    if (scope && getClaimScope(c) !== scope) return false;

    if (pickState === "pending" && c.picked_at)  return false;
    if (pickState === "picked"  && !c.picked_at) return false;

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
    draft: 3, waiting_ceo: 4,
    approved: 5, exec_approved: 5,
    rejected: 6, exec_rejected: 6,
  };

  claims.sort((a, b) => {
    let va, vb;
    if (sortKey === "qc_status") {
      va = STATUS_ORDER[normalizeStatus(a)] ?? 99;
      vb = STATUS_ORDER[normalizeStatus(b)] ?? 99;
    } else {
      va = a.claim_date || a.created_at || "";
      vb = b.claim_date || b.created_at || "";
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ?  1 : -1;
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
  filterState.search    = "";
  filterState.status    = "";
  filterState.dateFrom  = "";
  filterState.dateTo    = "";
  filterState.scope     = "";
  filterState.pickState = "all";

  ["searchInput","filterStatus","filterDateFrom","filterDateTo"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  document.querySelectorAll("[data-scope]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.scope === "")
  );
  document.querySelectorAll("[data-pick-state]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.pickState === "all")
  );
  document.querySelectorAll(".summary-card").forEach((c) => c.classList.remove("is-active"));

  applyFilters();
}

// ── Badge & Pill Builders ─────────────────────────────

function buildStatusBadge(claim) {
  const ns = normalizeStatus(claim);
  const map = {
    submitted:    { label: "รอรับเรื่อง",       cls: "submitted",   icon: "hourglass_empty" },
    pending:      { label: "รอรับเรื่อง",       cls: "submitted",   icon: "hourglass_empty" },
    checking:     { label: "กำลังตรวจสอบ",     cls: "in-progress", icon: "manage_search" },
    in_progress:  { label: "กำลังตรวจสอบ",     cls: "in-progress", icon: "manage_search" },
    draft:        { label: "บันทึกร่าง",        cls: "draft",       icon: "edit_note" },
    waiting_ceo:  { label: "รออนุมัติ CEO",     cls: "waiting-ceo", icon: "approval" },
    approved:     { label: "อนุมัติแล้ว",       cls: "approved",    icon: "check_circle" },
    rejected:     { label: "ปฏิเสธ",            cls: "rejected",    icon: "cancel" },
    exec_approved:{ label: "CEO อนุมัติแล้ว",  cls: "approved",    icon: "verified" },
    exec_rejected:{ label: "CEO ปฏิเสธ",        cls: "rejected",    icon: "block" },
  };
  const s = map[ns] || map.pending;
  return `<span class="status-badge ${s.cls}"><span class="material-symbols-outlined">${s.icon}</span>${s.label}</span>`;
}

function getStatusLabel(claim) {
  const ns = normalizeStatus(claim);
  const map = {
    submitted: "รอรับเรื่อง", pending: "รอรับเรื่อง",
    checking: "กำลังตรวจสอบ", in_progress: "กำลังตรวจสอบ",
    draft: "บันทึกร่าง", waiting_ceo: "รอ CEO อนุมัติ",
    approved: "อนุมัติแล้ว", rejected: "ปฏิเสธ",
    exec_approved: "CEO อนุมัติแล้ว", exec_rejected: "CEO ปฏิเสธ",
  };
  return map[ns] || ns;
}

function buildScopePill(claim) {
  const scope = getClaimScope(claim);
  if (scope === "internal") {
    return `<span class="scope-pill scope-internal"><span class="material-symbols-outlined">factory</span>ภายใน</span>`;
  }
  return `<span class="scope-pill scope-external"><span class="material-symbols-outlined">storefront</span>ลูกค้า</span>`;
}

function getStatusRowClass(claim) {
  const ns = normalizeStatus(claim);
  if (["approved","exec_approved"].includes(ns)) return "row-approved";
  if (["rejected","exec_rejected"].includes(ns)) return "row-rejected";
  if (["checking","in_progress"].includes(ns))   return "row-checking";
  if (!claim?.picked_at || ["pending","submitted"].includes(ns)) return "row-pending";
  return "";
}

// ── Table Rendering ───────────────────────────────────

function buildThumbsHtml(urls, maxShow) {
  if (!urls || urls.length === 0) return "";
  let html = "";
  urls.slice(0, maxShow).forEach((url) => {
    if (isVideo(url)) {
      html += `<div class="cell-thumb-video" title="วิดีโอ">🎥</div>`;
    } else {
      html += `<img class="cell-thumb" src="${escapeHtml(url)}" loading="lazy"
        onerror="this.style.display='none'" alt="ภาพประกอบ" />`;
    }
  });
  if (urls.length > maxShow) {
    html += `<div class="cell-thumb-video" style="font-size:.7rem;font-weight:600">+${urls.length - maxShow}</div>`;
  }
  return html;
}

function renderTable(claims) {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;

  if (!claims.length) {
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

  // Register claims globally for onclick access
  window._claims = {};
  claims.forEach((c) => { window._claims[c.id] = c; });

  tbody.innerHTML = "";

  claims.forEach((claim) => {
    const tr = document.createElement("tr");
    tr.className = getStatusRowClass(claim);
    tr.onclick = () => openModal(claim);

    const mediaUrls  = normalizeMediaUrls(claim.media_urls);
    const claimTypes = normalizeClaimTypes(claim.claim_types);

    const typesHtml = claimTypes.length
      ? claimTypes.map((t) => `<span class="type-tag">${escapeHtml(t)}</span>`).join("")
      : '<span class="cell-muted">—</span>';

    const customerLabel = claim.customer && String(claim.customer).trim()
      ? escapeHtml(claim.customer)
      : '<span class="cell-muted">— (ภายใน)</span>';

    tr.innerHTML = `
      <td>
        <div class="cell-date">${formatDate(claim.claim_date)}</div>
        <div class="cell-sub">${formatDateTime(claim.created_at)}</div>
      </td>
      <td>
        <div class="cell-main">${escapeHtml(claim.emp_name) || "—"}</div>
        <div class="cell-sub">${escapeHtml(claim.area)     || "—"}</div>
      </td>
      <td>
        ${buildScopePill(claim)}
        <div class="cell-sub">${customerLabel}</div>
      </td>
      <td class="cell-product">
        <div>${escapeHtml(claim.product) || "—"}</div>
        <div class="cell-sub">${escapeHtml(claim.qty) || ""}</div>
      </td>
      <td><div class="cell-types">${typesHtml}</div></td>
      <td>
        ${mediaUrls.length
          ? `<div class="cell-thumbs">${buildThumbsHtml(mediaUrls, 3)}</div>`
          : '<span class="cell-no-media">ไม่มีไฟล์</span>'}
      </td>
      <td>${buildStatusBadge(claim)}</td>
      <td>
        <div class="cell-action-group">
          <button class="btn-view" type="button"
            onclick="event.stopPropagation(); openModal(window._claims['${escapeHtml(claim.id)}'])">
            <span class="material-symbols-outlined">open_in_new</span> ข้อมูล
          </button>
          ${!claim.picked_at ? `
            <button class="btn-pick" type="button"
              onclick="event.stopPropagation(); pickClaim('${escapeHtml(claim.id)}')">
              <span class="material-symbols-outlined">how_to_reg</span> รับเรื่อง
            </button>` : ""}
        </div>
      </td>`;

    tbody.appendChild(tr);
  });
}

// ── Modal ─────────────────────────────────────────────

function openModal(claim) {
  if (!claim) return;
  currentClaim = claim;

  const modal = document.getElementById("qcModal");
  if (!modal) return;
  modal.classList.add("open");

  // Title
  const titleEl = document.getElementById("modalTitle");
  if (titleEl) titleEl.textContent = `เคลม #${getClaimNo(claim)}`;

  // Info grid
  const infoGrid = document.getElementById("modalInfoGrid");
  if (infoGrid) {
    infoGrid.innerHTML = `
      <div class="info-row"><div class="info-label">ประเภทเคลม</div><div class="info-value">${buildScopePill(claim)}</div></div>
      <div class="info-row"><div class="info-label">สถานะ</div><div class="info-value">${buildStatusBadge(claim)}</div></div>
      <div class="info-row"><div class="info-label">พนักงาน / ผู้แจ้ง</div><div class="info-value">${escapeHtml(claim.emp_name) || "—"}</div></div>
      <div class="info-row"><div class="info-label">เขต / พื้นที่</div><div class="info-value">${escapeHtml(claim.area) || "—"}</div></div>
      <div class="info-row"><div class="info-label">ร้านค้า</div><div class="info-value">${escapeHtml(claim.customer) || "—"}</div></div>
      <div class="info-row"><div class="info-label">สินค้า</div><div class="info-value">${escapeHtml(claim.product) || "—"}</div></div>
      <div class="info-row"><div class="info-label">จำนวน</div><div class="info-value">${escapeHtml(claim.qty) || "—"}</div></div>
      <div class="info-row"><div class="info-label">วันที่แจ้ง</div><div class="info-value">${formatDateTime(claim.created_at)}</div></div>
      ${claim.picked_at ? `<div class="info-row"><div class="info-label">รับเรื่องเมื่อ</div><div class="info-value">${formatDateTime(claim.picked_at)}</div></div>` : ""}
      ${claim.qc_comment ? `<div class="info-row full"><div class="info-label">ความเห็น QC</div><div class="info-value">${escapeHtml(claim.qc_comment)}</div></div>` : ""}
    `;
  }

  // Claim types — ID: modalTypes (ตรงกับ HTML)
  const typesEl = document.getElementById("modalTypes");
  if (typesEl) {
    const types = normalizeClaimTypes(claim.claim_types);
    typesEl.innerHTML = types.length
      ? types.map((t) => `<span class="modal-type-tag">${escapeHtml(t)}</span>`).join("")
      : '<span class="cell-muted">—</span>';
  }

  // Detail
  const detailEl = document.getElementById("modalDetail");
  if (detailEl) detailEl.textContent = claim.detail || "—";

  // Gallery — ID: modalGallery (ตรงกับ HTML)
  const galleryEl = document.getElementById("modalGallery");
  if (galleryEl) renderModalGallery(galleryEl, normalizeMediaUrls(claim.media_urls));

  // QC action area
  updateModalActionState(claim);
}

function renderModalGallery(container, urls) {
  if (!urls || urls.length === 0) {
    container.innerHTML = `<div class="media-no-file">ไม่มีไฟล์แนบ</div>`;
    return;
  }
  container.innerHTML = urls.map((url, i) => {
    const safe = escapeHtml(url);
    if (isVideo(url)) {
      return `<div class="media-item">
        <video controls preload="none" src="${safe}" style="width:100%;height:100%;object-fit:cover"></video>
      </div>`;
    }
    return `<div class="media-item" onclick="openLightbox('${safe}')">
      <img src="${safe}" alt="ไฟล์แนบ ${i + 1}" loading="lazy"
        onerror="this.parentElement.style.display='none'" />
    </div>`;
  }).join("");
}

function updateModalActionState(claim) {
  const btnPick    = document.getElementById("btnPickClaim");
  const btnApprove = document.getElementById("btnApprove");
  const btnReject  = document.getElementById("btnReject");
  const commentEl  = document.getElementById("qcComment");
  const statusText = document.getElementById("qcStatusText");

  const ns      = normalizeStatus(claim);
  const isFinal = ["approved","rejected","exec_approved","exec_rejected"].includes(ns);
  const isPicked = !!claim.picked_at;

  // Show/hide pick button
  if (btnPick)    btnPick.style.display = isPicked ? "none" : "inline-flex";

  // Approve/reject only after picked, not yet final
  if (btnApprove) btnApprove.disabled = !isPicked || isFinal;
  if (btnReject)  btnReject.disabled  = !isPicked || isFinal;

  // Comment field read-only if final
  if (commentEl) {
    commentEl.value = claim.qc_comment || "";
    commentEl.readOnly = isFinal;
    commentEl.style.background = isFinal ? "var(--surface-2)" : "";
  }

  // Current status text
  if (statusText) statusText.innerHTML = buildStatusBadge(claim);

  // Mark section as readonly
  const section = document.getElementById("qcActionSection");
  if (section) section.classList.toggle("is-readonly", isFinal);
}

function closeModal() {
  const modal = document.getElementById("qcModal");
  if (modal) modal.classList.remove("open");
  currentClaim = null;
}

// ── Lightbox ──────────────────────────────────────────

function openLightbox(url) {
  const box = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!box || !img) return;
  img.src = url;
  box.classList.add("open");
}

function closeLightbox() {
  const box = document.getElementById("lightbox");
  if (box) box.classList.remove("open");
}

// ── Table Loading/Error States ────────────────────────

function showTableLoading() {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="table-loading">
        <span class="material-symbols-outlined spin">progress_activity</span>
        กำลังโหลด...
      </td>
    </tr>`;
}

function showTableError(message) {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="table-empty">
        <span class="material-symbols-outlined empty-icon">error</span>
        <h4>เกิดข้อผิดพลาด</h4>
        <p>${escapeHtml(message)}</p>
      </td>
    </tr>`;
}

// ── Claim Actions ─────────────────────────────────────

/** รับเรื่องจากปุ่มในตาราง */
async function pickClaim(id) {
  if (!id) return;
  const confirmed = await showConfirmDialog({
    title:       "ยืนยันรับเรื่อง",
    message:     "ต้องการรับเรื่องเคลมนี้เพื่อเริ่มตรวจสอบหรือไม่?",
    confirmText: "รับเรื่อง",
    icon:        "how_to_reg",
  });
  if (!confirmed) return;
  await _doPickClaim(id);
}

/** รับเรื่องจากปุ่มใน modal */
async function pickClaimFromModal() {
  if (!currentClaim?.id) return;
  const confirmed = await showConfirmDialog({
    title:       "ยืนยันรับเรื่อง",
    message:     `รับเรื่องเคลม #${getClaimNo(currentClaim)} เพื่อเริ่มตรวจสอบหรือไม่?`,
    confirmText: "รับเรื่อง",
    icon:        "how_to_reg",
  });
  if (!confirmed) return;
  await _doPickClaim(currentClaim.id);
}

async function _doPickClaim(id) {
  try {
    const { error } = await supabaseClient
      .from("claims")
      .update({
        picked_at:  new Date().toISOString(),
        qc_status:  "checking",
      })
      .eq("id", id);

    if (error) throw error;

    showSuccessPopup("รับเรื่องเรียบร้อย", "รายการถูกย้ายไปสถานะกำลังตรวจสอบแล้ว");
    closeModal();
    await loadClaims();
  } catch (err) {
    alert("รับเรื่องไม่สำเร็จ: " + err.message);
  }
}

async function updateClaimStatus(status) {
  if (!currentClaim?.id) return;

  const isApprove = status === "approved";
  const result = await showConfirmDialog({
    title:       isApprove ? "ยืนยันอนุมัติ" : "ยืนยันปฏิเสธ",
    message:     isApprove ? "ต้องการอนุมัติเคลมนี้หรือไม่?" : "ต้องการปฏิเสธเคลมนี้หรือไม่?",
    noteLabel:   "หมายเหตุ QC",
    confirmText: isApprove ? "อนุมัติ" : "ปฏิเสธ",
    icon:        isApprove ? "check_circle" : "cancel",
    variant:     isApprove ? "primary" : "danger",
    showNote:    true,
  });
  if (!result) return;

  // อ่าน comment จาก dialog หรือ textarea ใน modal
  const note = (typeof result === "object" ? result.note : null)
    || document.getElementById("qcComment")?.value?.trim()
    || null;

  try {
    const { error } = await supabaseClient
      .from("claims")
      .update({
        qc_status:      status,
        status:         status,
        qc_comment:     note || null,
        qc_checked_at:  new Date().toISOString(),
      })
      .eq("id", currentClaim.id);

    if (error) throw error;

    // LINE Notify (optional — ไม่ block ถ้าไม่มี)
    try {
      const sendLineNotify = await getSendLineNotify();
      await sendLineNotify({ claim: currentClaim, status, note: note || "" });
    } catch (_) { /* ไม่ต้องแสดง error */ }

    showSuccessPopup(
      "บันทึกผลเรียบร้อย",
      isApprove ? "อนุมัติรายการนี้แล้ว" : "ปฏิเสธรายการนี้แล้ว"
    );
    closeModal();
    await loadClaims();
  } catch (err) {
    alert("บันทึกผลไม่สำเร็จ: " + err.message);
  }
}

// ── Dialogs ───────────────────────────────────────────

function showConfirmDialog({
  title       = "ยืนยันการดำเนินการ",
  message     = "ต้องการดำเนินการต่อหรือไม่?",
  noteLabel   = "หมายเหตุ / ความเห็นเพิ่มเติม",
  notePlaceholder = "พิมพ์ข้อความ... (ไม่บังคับ)",
  confirmText = "ยืนยัน",
  cancelText  = "ยกเลิก",
  icon        = "help",
  variant     = "primary",
  showNote    = false,
} = {}) {
  return new Promise((resolve) => {
    document.getElementById("ea-confirm-dialog")?.remove();

    const wrap = document.createElement("div");
    wrap.id = "ea-confirm-dialog";
    wrap.className = "ea-confirm-overlay";

    wrap.innerHTML = `
      <div class="ea-confirm-box ea-confirm-${escapeHtml(variant)}" role="dialog" aria-modal="true">
        <div class="ea-confirm-icon">
          <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${showNote ? `
          <label class="ea-confirm-note-label">${escapeHtml(noteLabel)}</label>
          <textarea class="ea-confirm-note" rows="3" placeholder="${escapeHtml(notePlaceholder)}"></textarea>
        ` : ""}
        <div class="ea-confirm-actions">
          <button type="button" class="ea-confirm-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="ea-confirm-ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;

    document.body.appendChild(wrap);

    const close = (result) => { wrap.remove(); resolve(result); };

    wrap.querySelector(".ea-confirm-cancel").onclick = () => close(false);
    wrap.querySelector(".ea-confirm-ok").onclick = () => {
      const note = wrap.querySelector(".ea-confirm-note")?.value?.trim() || "";
      close(showNote ? { ok: true, note } : true);
    };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); });

    // Focus ok button
    setTimeout(() => wrap.querySelector(".ea-confirm-ok")?.focus(), 50);
  });
}

function showSuccessPopup(title, message = "") {
  document.getElementById("ea-success-popup")?.remove();

  const wrap = document.createElement("div");
  wrap.id = "ea-success-popup";
  wrap.className = "ea-success-overlay";
  wrap.innerHTML = `
    <div class="ea-success-box">
      <div class="ea-success-icon">
        <span class="material-symbols-outlined">check_circle</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
    </div>`;

  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1800);
}

// ── Export ────────────────────────────────────────────

function getExportRows() {
  return filteredClaims.map((c) => ({
    เลขเคลม:       getClaimNo(c),
    วันที่:         formatDate(c.claim_date),
    พนักงาน:       c.emp_name || "",
    เขต:            c.area || "",
    ร้านค้า:        c.customer || "",
    สินค้า:         c.product || "",
    จำนวน:          c.qty || "",
    ประเภทปัญหา:   normalizeClaimTypes(c.claim_types).join(", "),
    สถานะ:          getStatusLabel(c),
    ความเห็น:       c.qc_comment || "",
  }));
}

function exportCSV() {
  const rows = getExportRows();
  if (!rows.length) { alert("ไม่มีข้อมูลสำหรับ export"); return; }

  const header = Object.keys(rows[0]);
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      header.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `claims-qc-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportExcel() {
  const rows = getExportRows();
  if (!rows.length) { alert("ไม่มีข้อมูลสำหรับ export"); return; }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Claims QC");
  XLSX.writeFile(wb, `claims-qc-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportPDF() {
  window.print();
}