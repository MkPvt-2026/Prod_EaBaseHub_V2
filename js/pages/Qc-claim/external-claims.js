// external-claims-sidebar.js
// ใช้สำหรับ Sidebar ย่อ / ขยายได้
// ✅ วิธีใช้: วางไฟล์นี้ไว้ที่ /js/pages/Qc-claim/external-claims-sidebar.js
// แล้วเรียกใน HTML ก่อนปิด </body>
// <script src="/js/pages/Qc-claim/external-claims-sidebar.js"></script>

(function () {
  function initSidebar() {
    document.body.classList.add("has-sidebar");

    const toggleBtn = document.getElementById("sidebarToggle");
    const backdrop = document.getElementById("sidebarBackdrop");
    const sidebarLinks = document.querySelectorAll(".sidebar-link[href]");

    if (!toggleBtn) {
      console.warn("ไม่พบปุ่ม #sidebarToggle");
      return;
    }

    toggleBtn.addEventListener("click", () => {
      if (window.innerWidth <= 900) {
        document.body.classList.toggle("sidebar-open");
      } else {
        document.body.classList.toggle("sidebar-collapsed");
      }
    });

    if (backdrop) {
      backdrop.addEventListener("click", () => {
        document.body.classList.remove("sidebar-open");
      });
    }

    sidebarLinks.forEach((link) => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 900) {
          document.body.classList.remove("sidebar-open");
        }
      });
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) {
        document.body.classList.remove("sidebar-open");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSidebar);
  } else {
    initSidebar();
  }
})();
