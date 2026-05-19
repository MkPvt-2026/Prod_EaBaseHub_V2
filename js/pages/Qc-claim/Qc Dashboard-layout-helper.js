// ============================================================
// QcDashboard-layout-helper.js
// ใช้คู่กับ QcDashboard.html + QcDashboard.css
// วางไฟล์นี้ไว้ที่: /js/pages/dashboard/QcDashboard-layout-helper.js
// แล้วเรียกต่อท้าย QcDashboard.js
//
// จุดที่แก้:
// 1) Sidebar ย่อ/ขยายให้คง layout เดิมบน Notebook + Tablet
// 2) มือถือจริงเท่านั้นจึงเปลี่ยนเป็น bottom nav
// 3) แก้ Calendar ที่เรียงตัวเลขลงแนวตั้งให้เป็น grid
// 4) Sync active menu ตาม path ปัจจุบัน
// 5) Resize chart ตอน layout เปลี่ยน
// 6) ช่วยลด error จาก event listener ที่ return Promise
// ============================================================

(function () {
  "use strict";

  const STORAGE_KEY = "ea-sidebar-expanded";
  const MOBILE_QUERY = "(max-width: 640px)";
  const TABLET_QUERY = "(min-width: 641px) and (max-width: 1180px)";

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  // ------------------------------------------------------------
  // Sidebar
  // ------------------------------------------------------------
  function setSidebarExpanded(expanded) {
    document.body.classList.toggle("sidebar-expanded", !!expanded);
    localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
    resizeChartsSoon();
  }

  function toggleSidebar() {
    setSidebarExpanded(!document.body.classList.contains("sidebar-expanded"));
  }

  function initSidebarState() {
    const isMobile = window.matchMedia(MOBILE_QUERY).matches;
    const saved = localStorage.getItem(STORAGE_KEY);

    // Notebook / Tablet ให้คง sidebar ซ้ายเหมือนเดิม
    // ถ้าไม่เคยเลือกไว้ ให้เริ่มแบบย่อ
    if (!isMobile) {
      setSidebarExpanded(saved === "1");
      return;
    }

    // มือถือจริง ไม่บังคับ expanded
    document.body.classList.remove("sidebar-expanded");
  }

  function initSidebarButtons() {
    const toggleBtn = qs(".toggle-btn");
    const hamburgerBtn = qs("#hamburgerBtn");

    if (toggleBtn) {
      toggleBtn.addEventListener("click", function (e) {
        e.preventDefault();
        toggleSidebar();
      });
    }

    if (hamburgerBtn) {
      hamburgerBtn.addEventListener("click", function (e) {
        e.preventDefault();
        toggleSidebar();
      });
    }

    // ให้ onclick เดิมใน HTML ยังเรียกได้
    window.toggleSidebar = toggleSidebar;
    window.toggleMenu = toggleSidebar;
  }

  function markActiveMenu() {
    const currentPath = window.location.pathname.replace(/\/$/, "");

    qsa(".menu-item").forEach((link) => {
      const href = (link.getAttribute("href") || "").replace(/\/$/, "");
      const isActive = href && (href === currentPath || currentPath.endsWith(href));
      link.classList.toggle("active", isActive);
    });
  }

  // ------------------------------------------------------------
  // Responsive class
  // ------------------------------------------------------------
  function syncResponsiveClass() {
    const isMobile = window.matchMedia(MOBILE_QUERY).matches;
    const isTablet = window.matchMedia(TABLET_QUERY).matches;

    document.body.classList.toggle("is-qc-mobile", isMobile);
    document.body.classList.toggle("is-qc-tablet", isTablet);
    document.body.classList.toggle("is-qc-desktop", !isMobile && !isTablet);

    // tablet / notebook ให้คง sidebar ซ้าย ไม่กลายเป็น bottom nav
    if (!isMobile) {
      const saved = localStorage.getItem(STORAGE_KEY);
      document.body.classList.toggle("sidebar-expanded", saved === "1");
    } else {
      document.body.classList.remove("sidebar-expanded");
    }

    resizeChartsSoon();
  }

  // ------------------------------------------------------------
  // Calendar fallback
  // ใช้ในกรณี CSS หลักยังไม่ได้กำหนด .calendar-grid / .calendar-day
  // ------------------------------------------------------------
  function injectLayoutFixCSS() {
    if (qs("#qcDashboardLayoutFixCSS")) return;

    const style = document.createElement("style");
    style.id = "qcDashboardLayoutFixCSS";
    style.textContent = `
      /* ===== QC Dashboard runtime layout fixes ===== */

      .calendar-grid,
      #calendarGrid {
        display: grid !important;
        grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
        gap: 6px !important;
        width: 100% !important;
      }

      .calendar-grid > *,
      #calendarGrid > * {
        min-width: 0 !important;
        min-height: 30px !important;
        display: grid !important;
        place-items: center !important;
        border-radius: 8px !important;
        font-size: 12px !important;
        color: var(--ink-2, #44403c) !important;
      }

      .calendar-grid .day-name,
      #calendarGrid .day-name,
      .calendar-grid .calendar-day-name,
      #calendarGrid .calendar-day-name {
        font-weight: 600 !important;
        color: var(--ink-3, #78716c) !important;
        background: transparent !important;
      }

      .calendar-grid .today,
      #calendarGrid .today,
      .calendar-grid .active,
      #calendarGrid .active {
        background: var(--role-color, #f97316) !important;
        color: #fff !important;
        font-weight: 700 !important;
      }

      .right-panel .btn-ea:empty::before {
        content: "จัดการเคลม";
      }

      .right-panel .btn-ea,
      .btn-ea.btn-adminqc {
        min-height: 48px !important;
        border-radius: 16px !important;
      }

      .right-panel .btn-ea .icon,
      .right-panel .btn-ea .material-symbols-outlined {
        color: #fff !important;
      }

      /* Notebook + Tablet: คง layout เดิมเป็น sidebar ซ้าย */
      @media (min-width: 641px) and (max-width: 1180px) {
        body.role-adminQc,
        body.role-adminQc.sidebar-expanded {
          padding-bottom: 0 !important;
        }

        .sidebar {
          top: var(--ea-side-gap, 18px) !important;
          bottom: var(--ea-side-gap, 18px) !important;
          left: var(--ea-side-gap, 18px) !important;
          right: auto !important;
          height: auto !important;
          width: var(--ea-side-mini, 84px) !important;
          flex-direction: column !important;
          border-radius: var(--radius-xl, 20px) !important;
          padding: 22px 10px !important;
        }

        body.sidebar-expanded .sidebar {
          width: var(--ea-side-full, 240px) !important;
          padding: 22px 14px !important;
        }

        .sidebar .logo {
          display: flex !important;
        }

        .toggle-btn {
          display: grid !important;
        }

        .menu {
          flex-direction: column !important;
          align-items: stretch !important;
          justify-content: flex-start !important;
          overflow-y: auto !important;
        }

        .menu-item,
        body.sidebar-expanded .menu-item {
          width: 100% !important;
          height: 46px !important;
        }

        body.sidebar-expanded .menu-text {
          display: inline !important;
        }

        body:not(.sidebar-expanded) .menu-text {
          display: none !important;
        }

        .content-layout {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        .right-panel {
          position: static !important;
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          align-items: start !important;
        }

        .calendar-card,
        .qc-mini-stats {
          grid-column: auto !important;
        }
      }

      /* Mobile จริงเท่านั้น: เปลี่ยนเป็น bottom nav */
      @media (max-width: 640px) {
        body.role-adminQc,
        body.role-adminQc.sidebar-expanded {
          padding-left: 0 !important;
          padding-bottom: 92px !important;
        }

        .sidebar {
          top: auto !important;
          left: 12px !important;
          right: 12px !important;
          bottom: 12px !important;
          width: auto !important;
          height: 70px !important;
          border-radius: 22px !important;
          padding: 8px 12px !important;
          flex-direction: row !important;
          align-items: center !important;
        }

        .sidebar .logo,
        .toggle-btn {
          display: none !important;
        }

        .menu {
          flex-direction: row !important;
          align-items: center !important;
          justify-content: space-around !important;
          overflow: visible !important;
          gap: 4px !important;
        }

        .menu-item,
        body.sidebar-expanded .menu-item {
          width: 48px !important;
          height: 48px !important;
          padding: 0 !important;
          justify-content: center !important;
        }

        .menu-text,
        body.sidebar-expanded .menu-text {
          display: none !important;
        }

        .content-layout {
          grid-template-columns: 1fr !important;
        }

        .right-panel {
          position: static !important;
          display: flex !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // ------------------------------------------------------------
  // Chart resize helpers
  // ------------------------------------------------------------
  function resizeChartsSoon() {
    window.setTimeout(() => {
      [
        window._pfChart,
        window._trendChart,
        window._topProductChart,
        window._cmpChart,
      ].forEach((chart) => {
        if (chart && typeof chart.resize === "function") {
          chart.resize();
        }
      });
    }, 280);
  }

  // ------------------------------------------------------------
  // Safe wrappers
  // ------------------------------------------------------------
  function makeAsyncSafe(fnName) {
    const original = window[fnName];
    if (typeof original !== "function" || original.__qcSafeWrapped) return;

    const wrapped = function (...args) {
      try {
        const result = original.apply(this, args);
        if (result && typeof result.catch === "function") {
          result.catch((err) => console.error(`${fnName} error:`, err));
        }
        return undefined;
      } catch (err) {
        console.error(`${fnName} error:`, err);
        return undefined;
      }
    };

    wrapped.__qcSafeWrapped = true;
    window[fnName] = wrapped;
  }

  function patchKnownGlobalHandlers() {
    // ลดปัญหา event handler / callback ที่ return Promise แล้ว browser เตือน
    [
      "logout",
      "prevMonth",
      "nextMonth",
      "filterTable",
      "loadDashboardData",
    ].forEach(makeAsyncSafe);
  }

  // ------------------------------------------------------------
  // Profile click upload fallback
  // ------------------------------------------------------------
  function initAvatarClick() {
    const wrapper = qs(".avatar-wrapper");
    const input = qs("#uploadAvatar");
    if (!wrapper || !input) return;

    wrapper.addEventListener("click", () => input.click());
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  function init() {
    injectLayoutFixCSS();
    initSidebarState();
    initSidebarButtons();
    markActiveMenu();
    syncResponsiveClass();
    initAvatarClick();

    window.addEventListener("resize", syncResponsiveClass);
    window.addEventListener("orientationchange", syncResponsiveClass);

    // รอ QcDashboard.js โหลด global functions ก่อนค่อย wrap
    window.setTimeout(patchKnownGlobalHandlers, 500);
    window.setTimeout(resizeChartsSoon, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
