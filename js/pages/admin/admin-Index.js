/* ==========================================================
   ADMINISTRATION CONSOLE SCRIPT
   ใช้ render เมนูจาก Array เพื่อให้เพิ่ม/ลบ/แก้เมนูง่าย
   ========================================================== */


/* ----------------------------------------------------------
   1) ข้อมูลเมนูทั้งหมด
   ถ้าต้องการเพิ่มเมนูใหม่ ให้เพิ่ม item ใน array นี้ได้เลย
   ---------------------------------------------------------- */

const adminMenus = [
  {
    group: "User & Access",
    icon: "group",
    items: [
      {
        title: "จัดการผู้ใช้งาน",
        desc: "เพิ่ม / แก้ไข / ปิดใช้งานบัญชีผู้ใช้งานในระบบ",
        icon: "person",
        url: "/pages/admin/admintor.html"
      },
      {
        title: "กำหนดสิทธิ์ Role",
        desc: "จัดการสิทธิ์การเข้าถึงของแต่ละบทบาท",
        icon: "admin_panel_settings",
        url: "/pages/admin/admintor.html"
      },
      {
        title: "ประวัติการเข้าใช้งาน",
        desc: "ตรวจสอบกิจกรรมการเข้าใช้งานของผู้ใช้",
        icon: "history",
        url: "admin-login-log.html"
      }
    ]
  },

  {
    group: "Master Data",
    icon: "widgets",
    items: [
      {
        title: "จัดการร้านค้า",
        desc: "ข้อมูลร้านค้า เขตพื้นที่ และเซลผู้ดูแล",
        icon: "storefront",
        url: "admin-shops.html"
      },
      {
        title: "จัดการสินค้า",
        desc: "หมวดหมู่สินค้า / รายการสินค้า / Attribute",
        icon: "inventory_2",
        url: "admin-products.html"
      },
      {
        title: "จัดการพื้นที่ขาย",
        desc: "โซน จังหวัด และเขตการขาย",
        icon: "location_on",
        url: "admin-areas.html"
      }
    ]
  },

  {
    group: "Workflow Settings",
    icon: "account_tree",
    items: [
      {
        title: "ตั้งค่าการอนุมัติ",
        desc: "กำหนดลำดับการอนุมัติ Manager → Executive",
        icon: "account_tree",
        url: "admin-approval.html"
      },
      {
        title: "ตั้งค่าเอกสาร",
        desc: "เลขที่เอกสาร / เวอร์ชัน / รูปแบบฟอร์ม",
        icon: "description",
        url: "admin-documents.html"
      },
      {
        title: "ตั้งค่าการแจ้งเตือน",
        desc: "LINE / Email / Reminder แจ้งเตือนในระบบ",
        icon: "notifications",
        url: "admin-notifications.html"
      }
    ]
  },

  {
    group: "System Tools",
    icon: "construction",
    items: [
      {
        title: "นำเข้า / ส่งออกข้อมูล",
        desc: "CSV / Excel / Backup ข้อมูลระบบ",
        icon: "upload_file",
        url: "admin-import-export.html"
      },
      {
        title: "Audit Log",
        desc: "ประวัติการแก้ไขข้อมูลสำคัญในระบบ",
        icon: "fact_check",
        url: "admin-audit-log.html"
      },
      {
        title: "System Config",
        desc: "ตั้งค่าระบบเพิ่มเติม และการเชื่อมต่อ",
        icon: "settings",
        url: "admin-config.html"
      }
    ]
  }
];


/* ----------------------------------------------------------
   2) Render เมนูทั้งหมดลงหน้า HTML
   ---------------------------------------------------------- */

function renderAdminMenus(keyword = "") {
  const container = document.getElementById("adminMenuContainer");
  if (!container) return;

  const searchText = keyword.trim().toLowerCase();

  let html = "";
  let foundCount = 0;

  adminMenus.forEach(section => {
    // กรองเมนูตามคำค้นหา
    const filteredItems = section.items.filter(item => {
      return (
        item.title.toLowerCase().includes(searchText) ||
        item.desc.toLowerCase().includes(searchText) ||
        section.group.toLowerCase().includes(searchText)
      );
    });

    // ถ้าไม่มีเมนูในหมวดนี้ ให้ข้าม
    if (filteredItems.length === 0) return;

    foundCount += filteredItems.length;

    html += `
      <div class="menu-section">
        <div class="menu-section-header">
          <div class="menu-section-title">
            <span class="material-symbols-outlined">${section.icon}</span>
            <h2>${section.group}</h2>
          </div>
          <a href="#">ดูทั้งหมด ›</a>
        </div>

        <div class="menu-card-grid">
          ${filteredItems.map(item => `
            <article class="menu-card" data-url="${item.url}">
              <div class="menu-card-icon">
                <span class="material-symbols-outlined">${item.icon}</span>
              </div>
              <h3>${item.title}</h3>
              <p>${item.desc}</p>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  });

  // ถ้าค้นหาแล้วไม่เจอ
  if (foundCount === 0) {
    html = `
      <div class="empty-state">
        <h3>ไม่พบเมนูที่ค้นหา</h3>
        <p>ลองค้นหาด้วยคำอื่น เช่น ผู้ใช้งาน, ร้านค้า, เอกสาร, แจ้งเตือน</p>
      </div>
    `;
  }

  container.innerHTML = html;

  bindMenuCardClick();
}


/* ----------------------------------------------------------
   3) คลิกการ์ดแล้วเปลี่ยนหน้า
   ---------------------------------------------------------- */

function bindMenuCardClick() {
  const cards = document.querySelectorAll(".menu-card");

  cards.forEach(card => {
    card.addEventListener("click", () => {
      const url = card.dataset.url;

      if (!url) return;

      // ถ้ายังไม่อยากให้เปลี่ยนหน้าจริง ให้เปลี่ยนเป็น console.log(url)
      window.location.href = url;
    });
  });
}


/* ----------------------------------------------------------
   4) ค้นหาเมนูแบบ real-time
   ---------------------------------------------------------- */

function setupSearch() {
  const searchInput = document.getElementById("menuSearch");
  if (!searchInput) return;

  searchInput.addEventListener("input", event => {
    renderAdminMenus(event.target.value);
  });
}


/* ----------------------------------------------------------
   5) เริ่มทำงานเมื่อโหลดหน้าเสร็จ
   ---------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  renderAdminMenus();
  setupSearch();
});