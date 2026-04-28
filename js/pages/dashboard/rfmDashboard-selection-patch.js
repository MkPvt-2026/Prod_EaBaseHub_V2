// ======================================================
// rfmDashboard-selection-patch.js
// เพิ่ม click selection สำหรับ rfmDashboard.js ที่มีอยู่แล้ว
// inject หลัง rfmDashboard.js โหลด
//
// USAGE: เพิ่ม <script src="rfmDashboard-selection-patch.js"></script>
//        หลัง rfmDashboard.js และ selectionManager.js
// ======================================================

(function waitForRFM() {
  if (typeof RFM === 'undefined' || typeof SelectionManager === 'undefined') {
    setTimeout(waitForRFM, 100);
    return;
  }
  applyRFMSelectionPatch();
})();

function applyRFMSelectionPatch() {
  console.log('🔧 Applying RFM Selection Patch...');
  SelectionManager.init();

  // ─── Patch: เมื่อ SelectionManager เปลี่ยน → filter RFM ───────────────────
  SelectionManager.on((sel) => {
    // ถ้า selection มาจาก rfm → ไม่ต้อง react อีก (จะ loop)
    if (sel && (sel.source === 'rfm_table' || sel.source === 'rfm_chart')) return;
    // ถ้า clear → reset RFM filter
    if (!sel) {
      RFM.resetInteraction && RFM.resetInteraction();
    }
  });

  // ─── Patch: tableBody click → select client ───────────────────────────────
  patchRFMTableClicks();

  // ─── Patch: Chart segment click → filter + cross-highlight ───────────────
  patchRFMCharts();

  // Re-patch after each reload (RFM re-renders the table)
  const origRenderTable = getRFMPrivate('renderTable');
  if (origRenderTable) {
    // Can't monkey-patch private; instead observe DOM mutations
    observeTableBody();
  }

  console.log('✅ RFM Selection Patch applied');
}

// ─────────────────────────────────────────────────────────────
// TABLE CLICK PATCH
// ─────────────────────────────────────────────────────────────
function patchRFMTableClicks() {
  const tableBody = document.getElementById('tableBody');
  if (!tableBody) return;

  // Delegate click on tbody
  tableBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (!row) return;

    // Don't intercept "ดูสินค้า" button click
    if (e.target.closest('button')) return;

    const clientName = row.cells[0]?.textContent?.trim();
    const segment = row.querySelector('.segment-badge')?.textContent?.trim()
      || row.cells[7]?.textContent?.trim(); // fallback by column index

    // Toggle selection
    if (SelectionManager.matches('rfm_client', clientName)) {
      SelectionManager.clear();
      clearRFMRowHighlight();
    } else {
      SelectionManager.select('rfm_client', clientName, 'rfm_table');
      highlightRFMRow(row);
    }
  });

  // Add hover cursor via CSS
  addStyle('rfm-table-cursor', `
    #tableBody tr { cursor: pointer; transition: background 0.1s; }
    #tableBody tr:hover { background: #f0faf6 !important; }
    #tableBody tr.sm-selected { background: #e8f7f2 !important; outline: 2px solid #1D9E75; outline-offset:-2px; }
    #tableBody tr.sm-selected td { font-weight: 500; }
  `);
}

function highlightRFMRow(row) {
  clearRFMRowHighlight();
  row.classList.add('sm-selected');
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearRFMRowHighlight() {
  document.querySelectorAll('#tableBody tr.sm-selected').forEach(r => r.classList.remove('sm-selected'));
}

// ─────────────────────────────────────────────────────────────
// CHART CLICK PATCH — intercept Chart.js onClick
// ─────────────────────────────────────────────────────────────
function patchRFMCharts() {
  // Poll for charts to be created, then patch
  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    const canvasSegments = document.getElementById('chartSegments');
    const canvasRevenue = document.getElementById('chartRevenue');

    if (canvasSegments && Chart.getChart(canvasSegments) && Chart.getChart(canvasRevenue)) {
      clearInterval(poll);
      injectChartClickHandlers(canvasSegments, 'segment');
      injectChartClickHandlers(canvasRevenue, 'segment');
    } else if (attempts > 60) {
      clearInterval(poll);
      console.warn('RFM charts not found for patch');
    }
  }, 500);
}

function injectChartClickHandlers(canvas, type) {
  const chart = Chart.getChart(canvas);
  if (!chart) return;

  const origOnClick = chart.options.onClick;
  chart.options.onClick = function(evt, elements, chartInstance) {
    // Call original first
    if (origOnClick) origOnClick.call(this, evt, elements, chartInstance);

    if (elements.length > 0) {
      const idx = elements[0].index;
      const label = chartInstance.data.labels[idx];
      if (!label) return;

      if (SelectionManager.matches('segment', label)) {
        SelectionManager.clear();
        clearRFMSegmentHighlight(chartInstance);
      } else {
        SelectionManager.select('segment', label, 'rfm_chart');
        highlightChartSegment(chartInstance, idx, label);
        // Also filter RFM table via existing dropdown if possible
        filterRFMTableBySegment(label);
      }
    }
  };

  chart.update('none');
  console.log(`✅ Patched onClick for canvas: #${canvas.id}`);
}

function highlightChartSegment(chart, selectedIdx, label) {
  const dataset = chart.data.datasets[0];
  const originalColors = dataset._originalColors || dataset.backgroundColor;

  if (!dataset._originalColors) {
    dataset._originalColors = Array.isArray(dataset.backgroundColor)
      ? [...dataset.backgroundColor]
      : chart.data.labels.map(() => dataset.backgroundColor);
  }

  dataset.backgroundColor = dataset._originalColors.map((color, i) => {
    if (i === selectedIdx) return color;
    // Dim other slices
    return hexToRgba(color, 0.25);
  });

  chart.update('none');
}

function clearRFMSegmentHighlight(chart) {
  const dataset = chart.data.datasets[0];
  if (dataset._originalColors) {
    dataset.backgroundColor = dataset._originalColors;
    delete dataset._originalColors;
    chart.update('none');
  }
}

function filterRFMTableBySegment(segment) {
  // Try to set the segment dropdown and trigger filter
  const segmentSelect = document.getElementById('segmentFilter');
  if (!segmentSelect) return;

  // Find matching option (partial match)
  const options = Array.from(segmentSelect.options);
  const match = options.find(o => o.value === segment || o.text.includes(segment));

  if (match) {
    segmentSelect.value = match.value;
    segmentSelect.dispatchEvent(new Event('change'));
  }
}

// ─────────────────────────────────────────────────────────────
// OBSERVE TABLE FOR RE-RENDERS
// ─────────────────────────────────────────────────────────────
function observeTableBody() {
  const tableBody = document.getElementById('tableBody');
  if (!tableBody) return;

  const observer = new MutationObserver(() => {
    // Re-apply selection highlight if needed
    const sel = SelectionManager.get();
    if (sel && sel.type === 'rfm_client') {
      const rows = tableBody.querySelectorAll('tr');
      rows.forEach(row => {
        const name = row.cells[0]?.textContent?.trim();
        if (name === sel.value) row.classList.add('sm-selected');
      });
    }
    if (sel && sel.type === 'segment') {
      // highlight segment column
      const rows = tableBody.querySelectorAll('tr');
      rows.forEach(row => {
        const badge = row.querySelector('.segment-badge')?.textContent?.trim();
        if (badge && badge !== sel.value) {
          row.style.opacity = '0.4';
        } else {
          row.style.opacity = '';
        }
      });
    }
    if (!sel) {
      tableBody.querySelectorAll('tr').forEach(r => { r.style.opacity = ''; });
    }
  });

  observer.observe(tableBody, { childList: true, subtree: false });
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────
function hexToRgba(color, alpha) {
  if (!color) return `rgba(128,128,128,${alpha})`;
  // Handle rgba already
  if (color.startsWith('rgba')) {
    return color.replace(/[\d.]+\)$/, alpha + ')');
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  // Handle hex
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function addStyle(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}

function getRFMPrivate(name) {
  // RFM is an IIFE — private methods not accessible; return null
  return null;
}

console.log('✅ rfmDashboard-selection-patch.js loaded');