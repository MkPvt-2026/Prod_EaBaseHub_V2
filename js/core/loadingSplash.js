/**
 * loadingPopup.js — Reusable Loading Popup (small, centered)
 * วิธีใช้:
 *   LoadingPopup.show()           → แสดง popup
 *   LoadingPopup.show("กำลังบันทึก...") → แสดงพร้อมข้อความกำหนดเอง
 *   LoadingPopup.hide()           → ซ่อน popup
 *
 * ตัวอย่าง:
 *   LoadingPopup.show("กำลังส่งข้อมูล...");
 *   await someAsyncFunction();
 *   LoadingPopup.hide();
 */

const LoadingPopup = (() => {
  // ============================================================
  // 1. Inject CSS (ครั้งเดียว)
  // ============================================================
  const STYLE_ID = "ea-loading-popup-style";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Overlay */
      #ea-loading-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 99998;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }

      #ea-loading-overlay.visible {
        opacity: 1;
        pointer-events: all;
      }

      /* Card */
      #ea-loading-card {
        background: #ffffff;
        border-radius: 18px;
        padding: 28px 36px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.14),
          0 2px 8px rgba(0, 0, 0, 0.08);
        transform: scale(0.85) translateY(10px);
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        min-width: 160px;
      }

      #ea-loading-overlay.visible #ea-loading-card {
        transform: scale(1) translateY(0);
      }

      /* Logo */
      #ea-loading-card .lp-logo {
        width: 52px;
        height: 52px;
        object-fit: contain;
        filter: drop-shadow(0 4px 10px rgba(58, 125, 68, 0.25));
        animation: lpPulse 1.8s ease-in-out infinite;
      }

      /* Dots */
      #ea-loading-card .lp-dots {
        display: flex;
        gap: 6px;
      }

      #ea-loading-card .lp-dots span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #4CAF50;
        animation: lpBounce 0.9s ease-in-out infinite;
      }

      #ea-loading-card .lp-dots span:nth-child(2) { animation-delay: 0.15s; }
      #ea-loading-card .lp-dots span:nth-child(3) { animation-delay: 0.30s; }

      /* Text */
      #ea-loading-card .lp-text {
        color: #555;
        font-family: "Kanit", "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 400;
        letter-spacing: 0.3px;
        text-align: center;
        line-height: 1.4;
      }

      /* Animations */
      @keyframes lpPulse {
        0%, 100% { transform: scale(1);    opacity: 1; }
        50%       { transform: scale(0.93); opacity: 0.8; }
      }

      @keyframes lpBounce {
        0%, 100% { transform: translateY(0);   opacity: 0.4; }
        50%       { transform: translateY(-6px); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 2. สร้าง DOM (ครั้งเดียว, lazy)
  // ============================================================
  let overlay = null;
  let textEl = null;

  function build() {
    if (overlay) return;

    injectStyle();

    overlay = document.createElement("div");
    overlay.id = "ea-loading-overlay";

    const card = document.createElement("div");
    card.id = "ea-loading-card";
    card.innerHTML = `
      <img class="lp-logo" src="/assets/icons/icon-192.png" alt="Loading">
      <div class="lp-dots">
        <span></span><span></span><span></span>
      </div>
      <div class="lp-text">กำลังโหลด...</div>
    `;

    textEl = card.querySelector(".lp-text");
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ============================================================
  // 3. Public API
  // ============================================================
  function show(message = "กำลังโหลด...") {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", () => show(message));
      return;
    }
    build();
    if (textEl) textEl.textContent = message;

    // Force reflow ก่อนเพิ่ม class เพื่อให้ transition ทำงาน
    overlay.getBoundingClientRect();
    overlay.classList.add("visible");
  }

  function hide() {
    if (!overlay) return;
    overlay.classList.remove("visible");
  }

  return { show, hide };
})();