// ======================================================
// date-filter.js
// Global Date Range Filter
// ใช้ร่วมกันระหว่าง RFM และ Product tabs
// ======================================================

const DateFilter = (function () {

  // -----------------------------
  // State
  // -----------------------------
  let dataMinDate = null;  // วันที่แรกสุดในข้อมูล
  let dataMaxDate = null;  // วันที่ล่าสุดในข้อมูล
  let currentStart = null; // null = ไม่มี filter
  let currentEnd = null;

  // -----------------------------
  // Utilities
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function toISO(d) {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }
  function fmtThai(dStr) {
    if (!dStr) return '-';
    const d = typeof dStr === 'string' ? new Date(dStr) : dStr;
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // -----------------------------
  // INITIALIZE: โหลดช่วงวันที่จาก DB + setup presets
  // -----------------------------
  async function init() {
    try {
      const { data, error } = await supabaseClient.rpc('get_data_date_range');
      if (error) throw error;
      if (data && data.length) {
        dataMinDate = data[0].min_date;
        dataMaxDate = data[0].max_date;
        console.log(`📅 Data range: ${dataMinDate} to ${dataMaxDate} (${data[0].total_rows} rows)`);
      }
    } catch (err) {
      console.warn('⚠️ get_data_date_range failed, using fallback:', err.message);
      // Fallback: ใช้ query ตรงถ้า RPC ยังไม่สร้าง
      try {
        const { data } = await supabaseClient
          .from('sales_transactions')
          .select('transaction_date')
          .order('transaction_date', { ascending: true })
          .limit(1);
        if (data && data[0]) dataMinDate = data[0].transaction_date;
        const { data: data2 } = await supabaseClient
          .from('sales_transactions')
          .select('transaction_date')
          .order('transaction_date', { ascending: false })
          .limit(1);
        if (data2 && data2[0]) dataMaxDate = data2[0].transaction_date;
      } catch (e) {
        console.error('❌ Cannot get date range:', e);
      }
    }

    // Set input min/max
    if (dataMinDate) $('dateStart').min = dataMinDate;
    if (dataMaxDate) {
      $('dateStart').max = dataMaxDate;
      $('dateEnd').max = dataMaxDate;
      $('dateEnd').min = dataMinDate;
    }

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset, btn));
    });

    // Enter key บน inputs = apply
    [$('dateStart'), $('dateEnd')].forEach(el => {
      el.addEventListener('keypress', (e) => { if (e.key === 'Enter') apply(); });
    });

    // เริ่มต้น "ทั้งหมด"
    applyPreset('all', document.querySelector('[data-preset="all"]'));
    updateInfo();
  }

  // -----------------------------
  // PRESETS
  // -----------------------------
  function applyPreset(preset, btn) {
    if (!dataMaxDate) return;
    const max = new Date(dataMaxDate);
    let start, end;

    switch (preset) {
      case 'all':
        start = null; end = null;
        break;
      case 'ytd':
        start = new Date(max.getFullYear(), 0, 1);
        end = max;
        break;
      case 'ly':
        start = new Date(max.getFullYear() - 1, 0, 1);
        end = new Date(max.getFullYear() - 1, 11, 31);
        break;
      case 'last12':
        start = new Date(max); start.setMonth(start.getMonth() - 12);
        end = max;
        break;
      case 'last6':
        start = new Date(max); start.setMonth(start.getMonth() - 6);
        end = max;
        break;
      case 'last3':
        start = new Date(max); start.setMonth(start.getMonth() - 3);
        end = max;
        break;
      case 'q1-25':
        start = new Date(2025, 0, 1); end = new Date(2025, 2, 31); break;
      case 'q2-25':
        start = new Date(2025, 3, 1); end = new Date(2025, 5, 30); break;
      case 'q3-25':
        start = new Date(2025, 6, 1); end = new Date(2025, 8, 30); break;
      case 'q4-25':
        start = new Date(2025, 9, 1); end = new Date(2025, 11, 31); break;
    }

    currentStart = start ? toISO(start) : null;
    currentEnd = end ? toISO(end) : null;

    $('dateStart').value = currentStart || '';
    $('dateEnd').value = currentEnd || '';

    // Highlight preset active
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    triggerRefresh();
    updateInfo();
  }

  // -----------------------------
  // APPLY CUSTOM
  // -----------------------------
  function apply() {
    const s = $('dateStart').value;
    const e = $('dateEnd').value;

    if (s && e && s > e) {
      alert('วันที่เริ่มต้องน้อยกว่าวันที่สิ้นสุด');
      return;
    }

    currentStart = s || null;
    currentEnd = e || null;

    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));

    triggerRefresh();
    updateInfo();
  }

  function reset() {
    currentStart = null;
    currentEnd = null;
    $('dateStart').value = '';
    $('dateEnd').value = '';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-preset="all"]')?.classList.add('active');
    triggerRefresh();
    updateInfo();
  }

  // -----------------------------
  // UPDATE INFO BAR
  // -----------------------------
  function updateInfo() {
    const info = $('dateInfo');
    if (!currentStart && !currentEnd) {
      info.innerHTML = `📊 แสดงข้อมูลทั้งหมด (${fmtThai(dataMinDate)} - ${fmtThai(dataMaxDate)})`;
    } else {
      info.innerHTML = `🔍 กรองช่วง <strong>${fmtThai(currentStart)} ถึง ${fmtThai(currentEnd)}</strong>`;
    }
  }

  // -----------------------------
  // TRIGGER REFRESH ไปยัง modules ที่สมัคร
  // -----------------------------
  function triggerRefresh() {
    console.log(`🔄 Date filter changed: ${currentStart || 'any'} → ${currentEnd || 'any'}`);

    // RFM reload
    if (typeof RFM !== 'undefined' && RFM.reload) {
      RFM.reload();
    }
    // Product reload (ถ้าเคยโหลดแล้ว)
    if (typeof Product !== 'undefined' && Product.isLoaded && Product.isLoaded()) {
      Product.reload();
    }
  }

  // -----------------------------
  // PUBLIC API
  // -----------------------------
  return {
    init,
    apply,
    reset,
    getRange: () => ({ start: currentStart, end: currentEnd }),
    hasFilter: () => !!(currentStart || currentEnd),
    getDataRange: () => ({ min: dataMinDate, max: dataMaxDate })
  };

})();

window.DateFilter = DateFilter;

console.log('✅ date-filter.js loaded');