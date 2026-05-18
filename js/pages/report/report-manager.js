// reportTracker-layout.js
// วางไฟล์นี้แทนไฟล์ reportTracker.js เดิมได้เลย
// หมายเหตุ: ไฟล์นี้เป็นตัวช่วย layout ให้เข้ากับ Sidebar แบบเดียวกับหน้า Claims QC
// ส่วน logic รายงานเดิมให้ใช้ไฟล์ reportTracker.js เดิมของคุณได้ตามปกติ

// =====================================================
// 🧩 LAYOUT SYNC: Sidebar/Header helper
// ใช้กับ layout แบบเดียวกับ Claims QC
// =====================================================
(function setupReportLayoutShell() {
  function updateAppHeaderDateText() {
    const el = document.getElementById("appHeaderDateText");
    if (!el) return;

    const months = [
      "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
    ];
    const now = new Date();
    el.textContent = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
  }

  function initSidebarToggle() {
    const btn = document.getElementById("sidebarToggle");
    if (!btn) return;

    const saved = localStorage.getItem("ea-sidebar-expanded");
    if (saved === "1") document.body.classList.add("sidebar-expanded");

    btn.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-expanded");
      localStorage.setItem(
        "ea-sidebar-expanded",
        document.body.classList.contains("sidebar-expanded") ? "1" : "0",
      );
    });
  }

  function markActiveSidebarLink() {
    const current = window.location.pathname;
    document.querySelectorAll(".ea-link").forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;
      link.classList.toggle("active", href === current || current.endsWith(href));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateAppHeaderDateText();
    initSidebarToggle();
    markActiveSidebarLink();
  });
})();

// =====================================================
// ✅ วิธีใช้ร่วมกับ reportTracker.js เดิม
// =====================================================
// 1) ให้ HTML เรียกไฟล์ JS หลักของหน้านี้แบบนี้:
//    <script src="/js/pages/report/reportTracker.js"></script>
//
// 2) ถ้าจะใช้ไฟล์ layout helper แยก ให้เรียกต่อท้าย:
//    <script src="/js/pages/report/reportTracker-layout.js"></script>
//
// 3) ถ้าคุณเอา helper นี้ไปต่อท้าย reportTracker.js เดิมแล้ว
//    ไม่ต้องเรียกไฟล์ reportTracker-layout.js แยกอีก
//
// 4) จุดที่ทำให้ JS โหลดไม่ได้บ่อยที่สุดใน HTML คือ path ผิด เช่น:
//    ❌ <script type="module" src="/js/pages/report/"></script>
//    ✅ <script src="/js/pages/report/reportTracker.js"></script>
