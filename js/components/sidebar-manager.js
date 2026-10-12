// =====================================================
// sidebar-manager.js — เมนูข้าง (sidebar) ชุดเดียวกันของหน้า
//   Manager Dashboard · รายงานเข้าร้าน · ประชาสัมพันธ์ · RFM · Marketing Home
//
// markup ของเมนูอยู่ในแต่ละหน้า (เหมือนกันทุกหน้า) ไฟล์นี้ทำ 2 อย่าง:
//   1) ไฮไลต์เมนูของหน้าปัจจุบัน
//   2) ซ่อนเมนูที่ role ของผู้ใช้เปิดไม่ได้
//   3) ย่อ/ขยาย sidebar (เปิดหน้าแล้ว "ขยาย" เสมอ) — ธีมสีอยู่ใน css/components/sidebar-marketing.css (ดู data-roles ในแต่ละเมนู)
//      ไม่มี data-roles = ทุกคนเห็น · admin เห็นทุกเมนู
// =====================================================
(function () {
  function setActive() {
    const path = location.pathname.replace(/\/+$/, "");
    document.querySelectorAll("#appSidebar .sidebar-nav-item").forEach((a) => {
      const href = (a.getAttribute("href") || "").split("?")[0];
      a.classList.toggle("active", href === path);
    });
  }

  async function filterByRole() {
    if (typeof supabaseClient === "undefined") return;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) return;
      const { data: p } = await supabaseClient
        .from("profiles").select("role").eq("id", session.user.id).single();
      let role = p?.role || "";
      if (typeof normalizeRole === "function") role = normalizeRole(role);
      if (role === "admin") return;
      document.querySelectorAll("#sidebarNav .sidebar-nav-item[data-roles]").forEach((a) => {
        const roles = a.dataset.roles.split(",").map((r) => r.trim());
        // ต้องผ่านทั้ง data-roles และสิทธิ์กลาง (roleConfig.js) — ถ้า auth.js ซ่อนไว้แล้ว ห้ามเปิดกลับ
        const okCentral = typeof canAccessPage !== "function" || canAccessPage(role, new URL(a.getAttribute("href") || "", location.href).pathname);
        // มีสิทธิ์กลางให้ใช้ → ยึดสิทธิ์กลางอย่างเดียว (data-roles ใช้เฉพาะตอนไม่มี roleConfig.js)
        const ok = typeof canAccessPage === "function" ? okCentral : roles.includes(role);
        if (ok && !a.hasAttribute("data-ea-hidden")) a.style.removeProperty("display");
        else a.style.setProperty("display", "none", "important"); // บาง CSS ใส่ display:flex !important
      });
    } catch (e) {
      console.warn("sidebar-manager:", e);
    }
  }

  // ---------- ย่อ / ขยาย (ใช้ตัวเดียวกันทุกหน้า) ----------
  // ✅ ทุกครั้งที่เปิดหน้า เริ่มแบบ "ขยาย" เสมอ (ย่อได้ด้วยปุ่ม แต่ไม่จำค่า)
  function applySidebar(open) {
    const sb = document.getElementById("appSidebar");
    const main = document.querySelector(".app-main");
    if (!sb) return;
    sb.classList.toggle("expanded", open);
    sb.classList.toggle("collapsed", !open);
    if (main) {
      main.classList.toggle("sb-open", open);
      main.classList.toggle("sb-closed", !open);
      main.classList.toggle("sidebar-expanded", open); // class เดิมของบางหน้า
      main.style.marginLeft = ""; // ล้างค่าที่สคริปต์เดิมของหน้าตั้งไว้
    }
    const icon = document.getElementById("collapseIcon");
    if (icon) icon.textContent = "chevron_right"; // หมุนด้วย CSS
  }

  function toggleSidebar() {
    const sb = document.getElementById("appSidebar");
    applySidebar(!(sb && sb.classList.contains("expanded")));
  }

  function init() {
    // ใช้ toggle ตัวกลางแทนของแต่ละหน้า (onclick="toggleSidebar()" จะเรียกตัวนี้)
    window.toggleSidebar = toggleSidebar;
    document.documentElement.classList.add("sb-no-anim");
    applySidebar(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.documentElement.classList.remove("sb-no-anim")),
    );
    setActive();
    filterByRole();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  // บางหน้ามีสคริปต์เดิมตั้งเป็น "ย่อ" ตอน load → ยืนยันอีกครั้งหลังโหลดเสร็จ
  window.addEventListener("load", () => {
    window.toggleSidebar = toggleSidebar;
    applySidebar(document.getElementById("appSidebar")?.classList.contains("expanded") ?? true);
  });
})();
