// ======================================================
// selectionManager.js v1
// ระบบ Click Selection แบบ Cross-Component
// ใช้ร่วมกับ rfmDashboard.js + productAnalytics.js
// ======================================================

const SelectionManager = (function () {

  // State
  let activeSelection = null; // { type, value, source }
  // type: 'segment' | 'rfm_client' | 'product' | 'category' | 'brand'
  // source: 'rfm_chart' | 'rfm_table' | 'product_chart' | 'product_table' | 'legend'

  const listeners = [];

  // ─── SUBSCRIBE ───────────────────────────────────────────
  function on(fn) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  function notify() {
    listeners.forEach(fn => fn(activeSelection));
  }

  // ─── SELECT / DESELECT ───────────────────────────────────
  function select(type, value, source) {
    // Toggle off if same
    if (activeSelection && activeSelection.type === type && activeSelection.value === value) {
      activeSelection = null;
    } else {
      activeSelection = { type, value, source };
    }
    notify();
    renderSelectionBadge();
  }

  function clear() {
    activeSelection = null;
    notify();
    renderSelectionBadge();
  }

  function get() {
    return activeSelection;
  }

  function isActive() {
    return activeSelection !== null;
  }

  function matches(type, value) {
    if (!activeSelection) return false;
    return activeSelection.type === type && activeSelection.value === value;
  }

  // ─── BADGE UI ─────────────────────────────────────────────
  function renderSelectionBadge() {
    let badge = document.getElementById('selectionBadge');

    if (!activeSelection) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'selectionBadge';
      badge.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1D9E75;
        color: white;
        padding: 10px 18px;
        border-radius: 10px;
        font-size: 13px;
        font-family: inherit;
        box-shadow: 0 4px 16px rgba(29,158,117,0.35);
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 9999;
        animation: slideUp 0.2s ease;
        cursor: default;
      `;
      document.body.appendChild(badge);
    }

    const labels = {
      segment: '🎯 Segment',
      rfm_client: '👤 ลูกค้า',
      product: '📦 สินค้า',
      category: '🏷️ หมวด',
      brand: '🏢 Brand',
    };

    const label = labels[activeSelection.type] || activeSelection.type;
    badge.innerHTML = `
      <span><strong>${label}:</strong> ${escapeHtml(String(activeSelection.value))}</span>
      <button onclick="SelectionManager.clear()" style="
        background: rgba(255,255,255,0.25);
        border: none;
        color: white;
        padding: 3px 8px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 11px;
        font-family: inherit;
      ">✕ ล้าง</button>
    `;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── CSS INJECT ───────────────────────────────────────────
  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'selection-manager-styles';
    style.textContent = `
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* Highlighted row */
      tr.sm-selected {
        background: #e8f7f2 !important;
        outline: 2px solid #1D9E75;
        outline-offset: -2px;
      }
      tr.sm-dimmed {
        opacity: 0.38;
      }
      tr.sm-selected td {
        font-weight: 500;
      }

      /* Clickable rows */
      tr.sm-clickable {
        cursor: pointer;
        transition: background 0.12s;
      }
      tr.sm-clickable:hover {
        background: #f0faf6 !important;
      }

      /* Selection ring on chart cards */
      .chart-card.sm-card-selected {
        box-shadow: 0 0 0 2px #1D9E75, 0 4px 20px rgba(29,158,117,0.15);
      }

      /* Active filter pill */
      .sm-filter-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #e8f7f2;
        color: #1D9E75;
        border: 1px solid #1D9E75;
        border-radius: 20px;
        padding: 2px 10px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
      }
      .sm-filter-pill:hover { background: #d0f0e5; }
    `;
    document.head.appendChild(style);
  }

  // ─── INIT ─────────────────────────────────────────────────
  function init() {
    if (document.getElementById('selection-manager-styles')) return;
    injectStyles();
    console.log('✅ SelectionManager initialized');
  }

  return { init, on, select, clear, get, isActive, matches };
})();

window.SelectionManager = SelectionManager;