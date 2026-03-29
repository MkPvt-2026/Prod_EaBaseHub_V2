/**
 * loading-overlay.js — Reusable Loading Overlay Popup
 *
 * วิธีใช้: ใส่ <script src="/js/core/loading-overlay.js"></script>
 *          ใน <head> หรือก่อน </body> ของทุกหน้าที่ต้องการ
 *
 * แล้วเรียกใช้ผ่าน:
 *   LoadingOverlay.show()               → แสดง overlay (ข้อความ default)
 *   LoadingOverlay.show("กำลังบันทึก...") → แสดงพร้อมข้อความกำหนดเอง
 *   LoadingOverlay.hide()               → ซ่อน overlay
 *   LoadingOverlay.redirect(url)        → แสดง แล้ว redirect หลัง 900ms
 */

const LoadingOverlay = (() => {
  // ============================================================
  // 1. Inject CSS
  // ============================================================
  const style = document.createElement("style");
  style.textContent = `
    #ea-loading-overlay {
      position: fixed;
      inset: 0;
      background: rgba(10, 40, 12, 0.65);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 99998;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    #ea-loading-overlay.show {
      opacity: 1;
      pointer-events: all;
    }

    .ea-overlay-box {
      background: #fff;
      border-radius: 24px;
      padding: 40px 52px;
      text-align: center;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.2);
      transform: scale(0.85);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      min-width: 220px;
    }

    #ea-loading-overlay.show .ea-overlay-box {
      transform: scale(1);
    }

    .ea-overlay-ring {
      width: 56px;
      height: 56px;
      border: 5px solid #e8f5e9;
      border-top: 5px solid #4CAF50;
      border-radius: 50%;
      animation: eaOverlaySpin 0.8s linear infinite;
      margin: 0 auto 18px;
    }

    .ea-overlay-box h3 {
      font-family: "Kanit", "Segoe UI", sans-serif;
      font-size: 17px;
      font-weight: 600;
      color: #2e7d32;
      margin-bottom: 5px;
    }

    .ea-overlay-box p {
      font-family: "Kanit", "Segoe UI", sans-serif;
      font-size: 13px;
      color: #999;
    }

    @keyframes eaOverlaySpin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  // ============================================================
  // 2. Inject HTML
  // ============================================================
  const overlay = document.createElement("div");
  overlay.id = "ea-loading-overlay";
  overlay.innerHTML = `
    <div class="ea-overlay-box">
      <div class="ea-overlay-ring"></div>
      <h3 id="ea-overlay-title">กำลังโหลด...</h3>
      <p id="ea-overlay-sub">กรุณารอสักครู่</p>
    </div>
  `;

  const inject = () => document.body.appendChild(overlay);
  if (document.body) inject();
  else document.addEventListener("DOMContentLoaded", inject);

  // ============================================================
  // 3. Public API
  // ============================================================
  return {
    /**
     * แสดง overlay
     * @param {string} title  - ข้อความหลัก (optional)
     * @param {string} sub    - ข้อความรอง (optional)
     */
    show(title = "กำลังโหลด...", sub = "กรุณารอสักครู่") {
      document.getElementById("ea-overlay-title").textContent = title;
      document.getElementById("ea-overlay-sub").textContent = sub;
      overlay.classList.add("show");
    },

    /** ซ่อน overlay */
    hide() {
      overlay.classList.remove("show");
    },

    /**
     * แสดง overlay แล้ว redirect หลัง delay
     * @param {string} url    - URL ปลายทาง
     * @param {string} title  - ข้อความหลัก (optional)
     * @param {number} delay  - หน่วง ms ก่อน redirect (default 900)
     */
    redirect(url, title = "กำลังเข้าสู่ระบบ...", delay = 900) {
      this.show(title);
      setTimeout(() => { window.location.href = url; }, delay);
    },
  };
})();