/**
 * confirm-dialog.js — Custom Confirm Dialog
 * แทนที่ browser confirm() และ alert() ด้วย popup สวยงาม
 *
 * วิธีใช้: ใส่ <script src="/js/core/confirm-dialog.js"></script>
 *
 * ฟังก์ชันที่ใช้ได้:
 *
 *   // 1. ยืนยัน (มีปุ่ม OK / ยกเลิก)
 *   const ok = await ConfirmDialog.show({
 *     title:     "ยืนยันการอนุมัติ",
 *     message:   "ยืนยันการอนุมัติเคลมนี้?",
 *     okText:    "อนุมัติ",
 *     cancelText:"ยกเลิก",
 *     type:      "success"   // "success" | "danger" | "warning" | "info"
 *   });
 *   if (ok) { ... }
 *
 *   // 2. แจ้งเตือน (ไม่มีปุ่ม หายเองอัตโนมัติ)
 *   ConfirmDialog.alert({
 *     title:   "บันทึกสำเร็จ",
 *     message: "ดำเนินการเรียบร้อยแล้ว",
 *     type:    "success"
 *   });
 *   ConfirmDialog.alert({ ... }, 3000); // อยู่นาน 3 วิ (default 2000ms)
 */

const ConfirmDialog = (() => {

  // ============================================================
  // 1. Inject CSS
  // ============================================================
  const style = document.createElement("style");
  style.textContent = `
    #ea-confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(10, 40, 12, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 99997;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }

    #ea-confirm-backdrop.show {
      opacity: 1;
      pointer-events: all;
    }

    .ea-confirm-box {
      background: #fff;
      border-radius: 20px;
      padding: 32px 36px 28px;
      width: 100%;
      max-width: 360px;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0,0,0,0.18);
      transform: scale(0.82) translateY(12px);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      margin: 16px;
    }

    #ea-confirm-backdrop.show .ea-confirm-box {
      transform: scale(1) translateY(0);
    }

    .ea-confirm-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 24px;
    }

    .ea-confirm-icon.success { background: #e8f5e9; color: #2e7d32; }
    .ea-confirm-icon.danger  { background: #fdecea; color: #c62828; }
    .ea-confirm-icon.warning { background: #fff8e1; color: #e65100; }
    .ea-confirm-icon.info    { background: #e3f2fd; color: #1565c0; }

    .ea-confirm-title {
      font-family: "Kanit", "Segoe UI", sans-serif;
      font-size: 17px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 8px;
    }

    .ea-confirm-message {
      font-family: "Kanit", "Segoe UI", sans-serif;
      font-size: 14px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 24px;
    }

    .ea-confirm-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .ea-confirm-actions button {
      flex: 1;
      padding: 11px 0;
      border: none;
      border-radius: 12px;
      font-family: "Kanit", "Segoe UI", sans-serif;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .ea-confirm-actions button:hover  { transform: translateY(-1px); }
    .ea-confirm-actions button:active { transform: translateY(0); }

    .ea-btn-cancel {
      background: #f1f5f9;
      color: #475569;
    }

    .ea-btn-cancel:hover {
      background: #e2e8f0 !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }

    .ea-btn-ok.success { background: linear-gradient(135deg, #4CAF50, #2e7d32); color: #fff; box-shadow: 0 6px 16px rgba(76,175,80,0.35); }
    .ea-btn-ok.danger  { background: linear-gradient(135deg, #ef5350, #c62828); color: #fff; box-shadow: 0 6px 16px rgba(239,83,80,0.35); }
    .ea-btn-ok.warning { background: linear-gradient(135deg, #ffa726, #e65100); color: #fff; box-shadow: 0 6px 16px rgba(255,167,38,0.35); }
    .ea-btn-ok.info    { background: linear-gradient(135deg, #42a5f5, #1565c0); color: #fff; box-shadow: 0 6px 16px rgba(66,165,245,0.35); }
    .ea-btn-ok:hover   { box-shadow: 0 8px 20px rgba(0,0,0,0.2) !important; }
  `;
  document.head.appendChild(style);

  // ============================================================
  // 2. Inject HTML
  // ============================================================
  const backdrop = document.createElement("div");
  backdrop.id = "ea-confirm-backdrop";
  backdrop.innerHTML = `
    <div class="ea-confirm-box">
      <div class="ea-confirm-icon"  id="ea-confirm-icon">✓</div>
      <div class="ea-confirm-title" id="ea-confirm-title">ยืนยัน</div>
      <div class="ea-confirm-message" id="ea-confirm-message"></div>
      <div class="ea-confirm-actions" id="ea-confirm-actions">
        <button class="ea-btn-cancel" id="ea-confirm-cancel">ยกเลิก</button>
        <button class="ea-btn-ok"     id="ea-confirm-ok">ตกลง</button>
      </div>
    </div>
  `;

  const inject = () => document.body.appendChild(backdrop);
  if (document.body) inject();
  else document.addEventListener("DOMContentLoaded", inject);

  const iconMap = {
    success: "✓",
    danger:  "✕",
    warning: "⚠",
    info:    "ℹ",
  };

  // helper อัปเดต icon + title + message
  function setContent(title, message, type) {
    document.getElementById("ea-confirm-title").textContent   = title;
    document.getElementById("ea-confirm-message").textContent = message;
    const iconEl = document.getElementById("ea-confirm-icon");
    iconEl.textContent = iconMap[type] || "✓";
    iconEl.className   = `ea-confirm-icon ${type}`;
  }

  // ============================================================
  // 3. Public API
  // ============================================================
  return {

    // ----------------------------------------------------------
    // show() — popup ยืนยัน มีปุ่ม OK / ยกเลิก
    // ----------------------------------------------------------
    show(options = {}) {
      if (typeof options === "string") options = { message: options };

      const {
        title      = "ยืนยัน",
        message    = "คุณต้องการดำเนินการต่อใช่ไหม?",
        okText     = "ตกลง",
        cancelText = "ยกเลิก",
        type       = "success",
      } = options;

      setContent(title, message, type);

      document.getElementById("ea-confirm-cancel").textContent = cancelText;
      document.getElementById("ea-confirm-ok").textContent     = okText;
      document.getElementById("ea-confirm-ok").className       = `ea-btn-ok ${type}`;

      // แสดงปุ่ม
      document.getElementById("ea-confirm-actions").style.display = "";

      backdrop.classList.add("show");

      return new Promise((resolve) => {
        const cleanup = (result) => {
          backdrop.classList.remove("show");
          const newOk     = document.getElementById("ea-confirm-ok");
          const newCancel = document.getElementById("ea-confirm-cancel");
          newOk.replaceWith(newOk.cloneNode(true));
          newCancel.replaceWith(newCancel.cloneNode(true));
          resolve(result);
        };

        document.getElementById("ea-confirm-ok")
          .addEventListener("click", () => cleanup(true),  { once: true });
        document.getElementById("ea-confirm-cancel")
          .addEventListener("click", () => cleanup(false), { once: true });

        backdrop.addEventListener("click", (e) => {
          if (e.target === backdrop) cleanup(false);
        }, { once: true });
      });
    },

    // ----------------------------------------------------------
    // alert() — popup แจ้งเตือน ไม่มีปุ่ม หายเองอัตโนมัติ
    // ----------------------------------------------------------
    alert(options = {}, duration = 2000) {
      if (typeof options === "string") options = { message: options };

      const {
        title   = "แจ้งเตือน",
        message = "",
        type    = "success",
      } = options;

      setContent(title, message, type);

      // ซ่อนปุ่ม
      document.getElementById("ea-confirm-actions").style.display = "none";

      backdrop.classList.add("show");

      setTimeout(() => {
        backdrop.classList.remove("show");
        // คืนปุ่มหลัง transition จบ
        setTimeout(() => {
          document.getElementById("ea-confirm-actions").style.display = "";
        }, 300);
      }, duration);
    },

  };

})();