/**
 * splash.js — Reusable Intro Splash Screen
 * วิธีใช้: ใส่ <script src="/js/core/splash.js"></script>
 *          เป็น script แรกสุดใน <body> ของทุกหน้าที่ต้องการ
 */

(function () {
  // ============================================================
  // 1. Inject CSS
  // ============================================================
  const style = document.createElement("style");
  style.textContent = `
    #ea-splash {
      position: fixed;
      inset: 0;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 99999;
      transition: opacity 0.5s ease;
    }

    #ea-splash.hide {
      opacity: 0;
      pointer-events: none;
    }

    #ea-splash .sp-logo {
      animation: spPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
    }

    #ea-splash .sp-logo img {
      width: 85px;
      filter: drop-shadow(0 6px 16px rgba(76,175,80,0.3));
    }

    #ea-splash .sp-title {
      color: #2e7d32;
      font-family: "Kanit", "Segoe UI", sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin-top: 14px;
      letter-spacing: 1px;
      animation: spSlideUp 0.45s ease 0.45s both;
    }

    #ea-splash .sp-sub {
      color: #999;
      font-family: "Kanit", "Segoe UI", sans-serif;
      font-size: 13px;
      margin-top: 5px;
      animation: spSlideUp 0.45s ease 0.6s both;
    }

    #ea-splash .sp-dots {
      display: flex;
      gap: 8px;
      margin-top: 38px;
      animation: spSlideUp 0.45s ease 0.75s both;
    }

    #ea-splash .sp-dots span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4CAF50;
      animation: spDotBounce 1s ease-in-out infinite;
    }

    #ea-splash .sp-dots span:nth-child(2) { animation-delay: 0.15s; }
    #ea-splash .sp-dots span:nth-child(3) { animation-delay: 0.3s; }

    @keyframes spPop {
      from { opacity: 0; transform: scale(0.5); }
      to   { opacity: 1; transform: scale(1); }
    }

    @keyframes spSlideUp {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes spDotBounce {
      0%, 100% { transform: translateY(0);   opacity: 0.5; }
      50%       { transform: translateY(-8px); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // ============================================================
  // 2. Inject HTML
  // ============================================================
  const splash = document.createElement("div");
  splash.id = "ea-splash";
  splash.innerHTML = `
    <div class="sp-logo">
      <img src="/assets/icons/icon-192.png" alt="EABaseHub Logo">
    </div>
    <div class="sp-title">EABaseHub</div>
    <div class="sp-sub">ศูนย์รวมข้อมูลและระบบงาน</div>
    <div class="sp-dots">
      <span></span><span></span><span></span>
    </div>
  `;

  // ใส่ทันทีก่อน DOM พร้อม เพื่อให้โผล่ขึ้นมาก่อนเลย
  if (document.body) {
    document.body.prepend(splash);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.prepend(splash);
    });
  }

  // ============================================================
  // 3. ซ่อน splash หลัง 2 วินาที (หรือหน้าโหลดเสร็จ แล้วแต่อะไรช้ากว่า)
  // ============================================================
  const MIN_DISPLAY = 2000; // ms — ขั้นต่ำที่ splash แสดง
  const start = Date.now();

  function hideSplash() {
    const elapsed = Date.now() - start;
    const delay = Math.max(0, MIN_DISPLAY - elapsed);

    setTimeout(() => {
      splash.classList.add("hide");
      // ลบออกจาก DOM หลัง transition จบ
      setTimeout(() => splash.remove(), 550);
    }, delay);
  }

  if (document.readyState === "complete") {
    hideSplash();
  } else {
    window.addEventListener("load", hideSplash);
  }
})();