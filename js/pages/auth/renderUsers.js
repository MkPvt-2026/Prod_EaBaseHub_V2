// ============================================================
// renderUsers.js
// แยกออกมาจาก admintor.js
//
// วิธีใช้งาน:
//   1. วาง <template id="tmpl-user-row"> ใน HTML
//   2. โหลดไฟล์นี้แทนที่ส่วน renderUsers() เดิมใน admintor.js
//   3. ต้องการแก้ UI → แก้ที่ template ใน HTML
//      ต้องการแก้สีปุ่ม → แก้ที่ admintor.css
//      ไม่ต้องแตะ JS เลย
// ============================================================



// ============================================================
// renderUsers()
// วน loop สร้าง row จาก template สำหรับแต่ละ user
// ============================================================

function renderUsers(data) {

  const tbody = document.getElementById("userTable");

  tbody.innerHTML = "";

  // ── กรณีไม่มีข้อมูล ────────────────────────────────────
  if (data.length === 0) {

    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="state-cell">
          🔍 ไม่พบผู้ใช้งาน
        </td>
      </tr>`;

    return;
  }

  // ── ดึง template ─────────────────────────────────────────
  const tmpl = document.getElementById("tmpl-user-row");

  if (!tmpl) {
    console.error("renderUsers: ไม่พบ #tmpl-user-row ใน HTML");
    return;
  }

  // ── วน render แต่ละ user ──────────────────────────────────
  data.forEach((user, i) => {

    const row = buildRow(tmpl, user, i);

    tbody.appendChild(row);

  });

}



// ============================================================
// buildRow()
// clone template 1 row แล้วเติมข้อมูล user ลงไป
//
// @param {HTMLTemplateElement} tmpl  - template element
// @param {Object}              user  - ข้อมูล user จาก Supabase
// @param {number}              index - ลำดับ (ใช้คำนวณ animation delay)
// @returns {HTMLElement}       tr element พร้อมข้อมูล
// ============================================================

function buildRow(tmpl, user, index) {

  // clone deep copy จาก template
  const clone = tmpl.content.cloneNode(true);

  // ดึง <tr> ออกมา
  const tr = clone.querySelector("tr");

  // animation delay ตามลำดับ
  tr.style.animationDelay = `${index * 0.03}s`;

  // เก็บ user id ไว้ใน dataset
  tr.dataset.id = user.id;

  const isActive =
    (user.status || "").toLowerCase() === "active";


  // ── เติมข้อมูลข้อความ ─────────────────────────────────────

  setField(clone, "email",
    user.email || "-");

  setField(clone, "username",
    user.username || "-");

  setField(clone, "display_name",
    user.display_name || "-");


  // ── Role Badge ────────────────────────────────────────────

  const roleCell = clone.querySelector("[data-field='role-badge']");

  if (roleCell)
    roleCell.innerHTML = roleBadge(user.role);


  // ── Status Badge ──────────────────────────────────────────

  const statusEl = clone.querySelector("[data-field='status-badge']");

  if (statusEl) {

    statusEl.textContent = isActive ? "✅ Active" : "🚫 Inactive";

    statusEl.classList.add(
      isActive ? "status-active" : "status-inactive"
    );

  }


  // ── Toggle Icon + Label ───────────────────────────────────

  setField(clone, "toggle-icon",
    isActive ? "block" : "check_circle");

  setField(clone, "toggle-label",
    isActive ? "ระงับ" : "เปิดใช้");


  // ── Toggle Button class ───────────────────────────────────

  const toggleBtn = clone.querySelector("[data-action='toggle']");

  if (toggleBtn) {

    toggleBtn.classList.add(
      isActive ? "btn-toggle-inactive" : "btn-toggle-active"
    );

    // ผูก event toggle status
    toggleBtn.addEventListener("click", () =>
      toggleStatus(user.id, isActive ? "Inactive" : "Active")
    );

  }


  // ── ผูก Event ─────────────────────────────────────────────

  // ปุ่ม edit
  const editBtn = clone.querySelector("[data-action='edit']");

  if (editBtn)
    editBtn.addEventListener("click", () =>
      openEditModal(user.id)
    );


  // ปุ่ม delete
  const delBtn = clone.querySelector("[data-action='delete']");

  if (delBtn)
    delBtn.addEventListener("click", () =>
      openDeleteModal(
        user.id,
        user.email || user.username || ""
      )
    );


  return clone;

}



// ============================================================
// setField()
// helper: หา element ที่มี data-field แล้วใส่ text
//
// @param {DocumentFragment|Element} root   - scope ที่จะค้นหา
// @param {string}                   field  - ค่า data-field
// @param {string}                   value  - text ที่จะใส่
// ============================================================

function setField(root, field, value) {

  const el = root.querySelector(`[data-field="${field}"]`);

  if (el)
    el.textContent = escapeHtml(value);

}
