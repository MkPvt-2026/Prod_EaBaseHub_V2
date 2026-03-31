// ============================================================
// themeToggle.js
// จัดการ light / dark mode ร่วมกันทั้งระบบ
// บันทึกค่าใน localStorage key: "ea-theme"
// ============================================================

(function () {
  const KEY   = 'ea-theme';
  const DARK  = 'dark';
  const LIGHT = 'light';

  // ── apply theme to <html> ──────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);

    // อัปเดตปุ่ม toggle ทุกตัวในหน้า
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      const icon  = btn.querySelector('.theme-icon');
      const label = btn.querySelector('.theme-label');
      if (icon)  icon.textContent  = theme === DARK ? 'light_mode' : 'dark_mode';
      if (label) label.textContent = theme === DARK ? 'Light' : 'Dark';
      btn.setAttribute('aria-label', theme === DARK ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('data-current', theme);
    });
  }

  // ── toggle ──────────────────────────────────────────────
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || DARK;
    applyTheme(current === DARK ? LIGHT : DARK);
  }

  // ── init on DOM ready ────────────────────────────────────
  function init() {
    // อ่านค่าที่บันทึกไว้ ถ้าไม่มีใช้ dark เป็น default
    const saved = localStorage.getItem(KEY) || DARK;
    applyTheme(saved);

    // bind ปุ่มที่มีอยู่แล้ว
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', toggleTheme);
    });
  }

  // expose globally
  window.toggleTheme = toggleTheme;
  window.applyTheme  = applyTheme;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();