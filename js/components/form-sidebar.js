// =====================================================
// form-sidebar.js — เมนูด้านข้างของชุดแบบฟอร์ม (Form Hub)
// ใช้กับ: formHub, formPlan, formActual, special-price-sale, credit-limit-sale, new-shop-sale
//
// วิธีใช้: ใส่ <script src="/js/components/form-sidebar.js"></script> ต่อจาก </main> (ก่อนสคริปต์อื่น)
//   → สร้างเมนูทันที (ระหว่างตรวจสิทธิ์หน้ายังซ่อนอยู่ จึงไม่เห็นหน้ากระพริบ)
//
// ✏️ เพิ่ม / แก้เมนู → แก้ที่ FS_MENU ด้านล่างที่เดียว
//    เมนูที่ role เปิดไม่ได้ซ่อนเองตามสิทธิ์กลาง (roleConfig.js) · ปุ่ม "กลับหน้าหลัก" ไปหน้าแรกของ role นั้น
//
// หน้า Form Hub เอง (<body data-form-nav="home">) มีการ์ดใหญ่อยู่แล้ว → ไม่สร้างเมนูด้านข้าง
//   ตั้งเฉพาะปุ่ม "กลับหน้าหลัก" ([data-fs-home]) ให้ไปหน้าแรกของ role
//
// ขนาดจอ: ≥1100px เมนูเต็ม · 768–1099px (แท็บเล็ตแนวตั้ง) แถบไอคอน + ชื่อสั้น · <768px ซ่อน กดปุ่ม ☰ บนหัวเว็บเพื่อเปิด
// =====================================================
(function formSidebar() {
  "use strict";
  if (document.getElementById("formSidebar")) return;

  const FS_MENU = [
    { items: [{ title: "ทุกแบบฟอร์ม", short: "ทั้งหมด", icon: "apps", url: "/pages/forms/formHub.html" }] },
    {
      group: "การเดินทาง",
      items: [
        { title: "แผนการเดินทาง", short: "แผนเดินทาง", icon: "emoji_transportation", color: "blue", url: "/pages/forms/formPlan.html" },
        { title: "ใบเดินทางจริง", short: "เดินทางจริง", icon: "receipt_long", color: "green", url: "/pages/forms/formActual.html" },
      ],
    },
    {
      group: "ขออนุมัติ",
      items: [
        { title: "ขออนุมัติราคาพิเศษ", short: "ราคาพิเศษ", icon: "sell", color: "orange", url: "/pages/forms/special-price-sale.html" },
        { title: "ขออนุมัติวงเงินชั่วคราว", short: "วงเงิน", icon: "credit_card", color: "purple", url: "/pages/forms/credit-limit-sale.html" },
        { title: "เปิดร้านค้าใหม่", short: "ร้านใหม่", icon: "add_business", color: "teal", url: "/pages/forms/new-shop-sale.html" },
      ],
    },
  ];

  const main = document.querySelector("body > main");
  if (!main) return;
  const homeOnly = document.body.dataset.formNav === "home";
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (p) => (typeof normalizePath === "function" ? normalizePath(p) : String(p).replace(/\.html$/, ""));
  const here = norm(location.pathname);

  // เมนูเดิมแถบบน (ลิงก์ทั่วไปของเซลล์) ไม่ใช้ในชุดแบบฟอร์มแล้ว
  document.querySelectorAll("body > nav.app-nav").forEach((n) => n.remove());

  // ---------- ตาม role: ปุ่มกลับหน้าหลัก + ซ่อนเมนูที่เปิดไม่ได้ ----------
  async function applyRole(aside) {
    let role = window.EA_ROLE;
    try {
      for (let i = 0; !role && i < 60; i++) {
        if (typeof eaGetMyProfile === "function" && typeof supabaseClient !== "undefined") {
          const { profile } = await eaGetMyProfile();
          role = profile?.role;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (e) { /* ignore */ }
    if (!role) return;
    if (typeof normalizeRole === "function") role = normalizeRole(role);
    const home = typeof getDefaultPage === "function" ? getDefaultPage(role) : "/index.html";
    document.querySelectorAll("#fsHome, [data-fs-home]").forEach((h) => { h.href = home; });
    if (aside && typeof canAccessPage === "function") {
      aside.querySelectorAll(".fs-item").forEach((a) => {
        if (!canAccessPage(role, new URL(a.href, location.origin).pathname)) a.closest("li").hidden = true;
      });
      aside.querySelectorAll(".fs-group").forEach((g) => { g.hidden = !g.querySelector("li:not([hidden])"); });
    }
  }

  if (homeOnly) { applyRole(null); return; }

  // ---------- เมนู ----------
  const aside = document.createElement("aside");
  aside.className = "fs";
  aside.id = "formSidebar";
  aside.setAttribute("aria-label", "เมนูแบบฟอร์ม");
  aside.innerHTML = `
    <a class="sidebar-logo fs-home" id="fsHome" href="/index.html" title="กลับหน้าหลัก">
      <span class="material-symbols-outlined">home</span><span class="fs-l">กลับหน้าหลัก</span><span class="fs-s">หน้าหลัก</span>
    </a>
    <div class="fs-title"><span class="material-symbols-outlined">assignment</span><span class="fs-l">แบบฟอร์ม</span></div>
    <nav class="fs-nav">${FS_MENU.map((g) => `
      <div class="fs-group">
        ${g.group ? `<div class="fs-gtitle">${esc(g.group)}</div>` : ""}
        <ul>${g.items.map((it) => {
          const on = norm(it.url) === here;
          return `<li><a class="fs-item${on ? " is-active" : ""}" href="${esc(it.url)}"${on ? ' aria-current="page"' : ""} title="${esc(it.title)}">
            <span class="fs-ic${it.color ? " c-" + it.color : ""}"><span class="material-symbols-outlined">${esc(it.icon)}</span></span>
            <span class="fs-l">${esc(it.title)}</span><span class="fs-s">${esc(it.short || it.title)}</span></a></li>`;
        }).join("")}</ul>
      </div>`).join("")}
    </nav>`;

  // โครงหน้า: [เมนู | เนื้อหา] ใต้หัวเว็บ
  const shell = document.createElement("div");
  shell.className = "fs-shell";
  main.before(shell);
  shell.append(aside, main);
  document.body.classList.add("fs-on");

  // ---------- จอเล็ก: ปุ่ม ☰ เปิดเมนู ----------
  const header = document.querySelector(".app-header");
  const scrim = document.createElement("div");
  scrim.className = "fs-scrim";
  document.body.appendChild(scrim);
  const setOpen = (open) => {
    document.body.classList.toggle("fs-open", open);
    burger && burger.setAttribute("aria-expanded", String(open));
  };
  let burger = null;
  if (header) {
    burger = document.createElement("button");
    burger.type = "button";
    burger.className = "fs-burger";
    burger.setAttribute("aria-label", "เปิดเมนูแบบฟอร์ม");
    burger.setAttribute("aria-controls", "formSidebar");
    burger.setAttribute("aria-expanded", "false");
    burger.innerHTML = `<span class="material-symbols-outlined">menu</span>`;
    header.prepend(burger);
    burger.addEventListener("click", () => setOpen(!document.body.classList.contains("fs-open")));
  }
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });

  // ความสูงหัวเว็บ → ตำแหน่งเมนู (หัวเว็บติดบนจอ)
  const fitTop = () => { if (header) document.documentElement.style.setProperty("--fs-top", `${header.offsetHeight}px`); };
  fitTop();
  window.addEventListener("resize", fitTop);

  applyRole(aside);
})();
