// ============================================================
// external-claims-sidebar.js  (v2 — sync with .ea-sidebar markup)
// ใช้สำหรับ Sidebar ย่อ / ขยายได้
// ============================================================
(function () {
  "use strict";

  const STORAGE_KEY = "ea-sidebar-expanded";

  function initSidebar() {
    const sidebar = document.getElementById("eaSidebar");
    const toggleBtn = document.getElementById("eaSidebarToggle");

    if (!sidebar || !toggleBtn) {
      console.warn("[sidebar] ไม่พบ #eaSidebar หรือ #eaSidebarToggle");
      return;
    }

    // คืนสถานะที่ผู้ใช้เลือกครั้งก่อน
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1" && window.innerWidth > 768) {
        document.body.classList.add("sidebar-expanded");
      }
    } catch (_) {}

    // Toggle ปุ่มลูกศร
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      // มือถือ: เลื่อนเปิด/ปิด แทนการขยาย
      if (window.innerWidth <= 768) {
        document.body.classList.toggle("sidebar-expanded");
        return;
      }

      const isExpanded = document.body.classList.toggle("sidebar-expanded");
      try {
        localStorage.setItem(STORAGE_KEY, isExpanded ? "1" : "0");
      } catch (_) {}
    });

    // กด ESC เพื่อหุบ sidebar (มือถือ)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && window.innerWidth <= 768) {
        document.body.classList.remove("sidebar-expanded");
      }
    });

    // คลิกนอก sidebar บนมือถือเพื่อปิด
    document.addEventListener("click", (e) => {
      if (window.innerWidth > 768) return;
      if (!document.body.classList.contains("sidebar-expanded")) return;
      if (sidebar.contains(e.target)) return;
      document.body.classList.remove("sidebar-expanded");
    });

    // คลิกลิงก์บนมือถือแล้วปิด sidebar เอง
    sidebar.querySelectorAll(".ea-link").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 768) {
          document.body.classList.remove("sidebar-expanded");
        }
      });
    });

    // เมื่อ resize หน้าจอข้ามจุด breakpoint
    let lastIsMobile = window.innerWidth <= 768;
    window.addEventListener("resize", () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile !== lastIsMobile) {
        document.body.classList.remove("sidebar-expanded");
        lastIsMobile = isMobile;
      }
    });

    console.log("✅ external-claims-sidebar.js (v2) initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSidebar);
  } else {
    initSidebar();
  }
})();