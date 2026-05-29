
// ป้องกันหน้า: admin only
document.addEventListener('DOMContentLoaded', async () => {
  await protectPage(['admin' ,'manager']);
  loadHistory();
});

// UI: toggle mode card
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    card.querySelector('input').checked = true;
  });
});

// Preview file เมื่อเลือกไฟล์
document.getElementById('fileInput').addEventListener('change', previewFile);

// ======================================================
// STATE
// ======================================================
const logEl = document.getElementById('log');
const progressBar = document.getElementById('progressBar');
let previewData = null;

function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('th-TH');
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warn' ? '⚠️' : '•';
  logEl.textContent += `\n[${time}] ${prefix} ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}

// ======================================================
// PREVIEW (อ่านไฟล์ + แสดงสรุป)
// ======================================================
async function previewFile() {
  const file = document.getElementById('fileInput').files[0];
  const previewBox = document.getElementById('previewBox');

  if (!file) {
    previewBox.classList.remove('active');
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (!rows.length) {
      alert('ไฟล์ไม่มีข้อมูล');
      return;
    }

    // ตรวจคอลัมน์
    const firstRow = rows[0];
    const cols = Object.keys(firstRow);

    // หา date range
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const dates = rows.map(r => extractDate(r, mode)).filter(Boolean);
    const minDate = dates.length ? dates.reduce((a, b) => a < b ? a : b) : null;
    const maxDate = dates.length ? dates.reduce((a, b) => a > b ? a : b) : null;

    document.getElementById('previewRows').textContent = rows.length.toLocaleString();
    document.getElementById('previewDateRange').textContent = minDate && maxDate
      ? `${fmtDate(minDate)} ถึง ${fmtDate(maxDate)}`
      : '⚠️ หาไม่พบวันที่';
    document.getElementById('previewColumns').textContent = cols.slice(0, 5).join(', ') + (cols.length > 5 ? '...' : '');

    previewData = { rows, minDate, maxDate, file };
    previewBox.classList.add('active');

    log(`อ่านไฟล์เรียบร้อย: ${rows.length.toLocaleString()} แถว`);
    if (minDate && maxDate) {
      log(`ช่วงวันที่: ${fmtDate(minDate)} ถึง ${fmtDate(maxDate)}`);
    }
  } catch (err) {
    alert('อ่านไฟล์ไม่ได้: ' + (err.message || err));
    console.error(err);
  }
}

// ======================================================
// HELPERS
// ======================================================
function fmtDate(d) {
  if (!d) return '-';
  if (typeof d === 'string') return d;
  return d.toISOString().slice(0, 10);
}

function toDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Extract วันที่จาก row ตามโหมด
function extractDate(row, mode) {
  if (mode === 'monthly') {
    const y = parseInt(row['Year']);
    const m = parseInt(row['Month']);
    if (!y || !m) return null;
    // วันสุดท้ายของเดือน
    return new Date(y, m, 0);  // day=0 = last day of previous month → m ของ constructor เริ่มที่ 0 แต่ใส่ m ก็จะได้ last day of m
  }
  // daily mode
  // รองรับ Date column หลากหลายรูปแบบ
  const dateVal = row['Date'] || row['date'] || row['วันที่'];
  if (dateVal) {
    if (dateVal instanceof Date) return dateVal;
    const parsed = new Date(dateVal);
    if (!isNaN(parsed)) return parsed;
  }
  // หรือใช้ Year + Month + Day
  const y = parseInt(row['Year']);
  const m = parseInt(row['Month']);
  const d = parseInt(row['Day'] || row['day']);
  if (y && m && d) return new Date(y, m - 1, d);
  if (y && m) return new Date(y, m, 0);  // fallback = last day of month
  return null;
}

// Helper: แยกชื่อสินค้ากับรหัส
// "ดำเงิน(ชาวสวน)0.80x400y.-45รูเดี่ยว /3-3-03250831"
//   → name = "ดำเงิน(ชาวสวน)0.80x400y.-45รูเดี่ยว"
//   → code = "3-3-03250831"
function splitProductName(fullText) {
  if (!fullText) return { name: null, code: null };
  const trimmed = String(fullText).trim();
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash === -1) {
    // ไม่มี / → ทั้งหมดเป็นชื่อ
    return { name: trimmed, code: null };
  }
  const name = trimmed.substring(0, lastSlash).trim();
  const code = trimmed.substring(lastSlash + 1).trim().replace(/['"]/g, '');
  return { name, code };
}

// Map row → DB
function mapRow(row, mode, filename) {
  const date = extractDate(row, mode);
  if (!date) return null;

  const productFull = row['รายการสินค้า/รหัส'] || null;
  const split = splitProductName(productFull);

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: mode === 'daily' ? date.getDate() : null,
    transaction_date: toDateString(date),
    employee_name: row['Employee_Name'] || null,
    client_id: row['Client_ID'] || null,
    client_name: row['Client_Name'] || null,
    province: row['Province'] || null,
    product_code: productFull,
    product_name: split.name,        // 🆕 ชื่อสินค้า (ตัด / ออก)
    product_code_only: split.code,   // 🆕 รหัสสินค้าอย่างเดียว
    sales_unit: parseFloat(row['ขายสุทธิ_SalesUnit']) || 0,
    unit_name: row['หน่วยนับ'] || null,
    sales_value: parseFloat(row['ขายสุทธิ_SalesValue']) || 0,
    regular_price: parseFloat(row['Regularprice']) || null,
    category: row['หมวด'] || null,
    mesh_density: row['ตาข่าย_ความเข้ม'] != null ? String(row['ตาข่าย_ความเข้ม']) : null,
    color: row['Color'] || null,
    size: row['Size'] || null,
    brand: row['Brand'] || null,
    segment: row['Segment'] || null,
    sub_segment_a: row['Sub_SegmentA'] != null ? String(row['Sub_SegmentA']) : null,
    sub_segment_b: row['Sub_SegmentB'] || null,
    source_file: filename
  };
}

// ======================================================
// IMPORT
// ======================================================
async function startImport() {
  if (!previewData) {
    alert('กรุณาเลือกไฟล์ก่อน');
    return;
  }

  const { rows, minDate, maxDate, file } = previewData;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const strategy = document.getElementById('importStrategy').value;

  // Confirm ก่อนทำงานที่อันตราย
  if (strategy === 'replace_all') {
    if (!confirm('⚠️ ยืนยันการลบข้อมูลทั้งหมด? (ไม่สามารถย้อนกลับได้)')) {
      log('ยกเลิกการ import');
      return;
    }
  } else if (strategy === 'replace_range') {
    if (!confirm(`จะลบข้อมูลในช่วง ${fmtDate(minDate)} ถึง ${fmtDate(maxDate)} แล้ว insert ใหม่ ยืนยันหรือไม่?`)) {
      log('ยกเลิกการ import');
      return;
    }
  }

  const btn = document.getElementById('importBtn');
  btn.disabled = true;
  logEl.textContent = '';
  progressBar.style.width = '0%';

  try {
    log(`เริ่ม import โหมด: ${mode}, strategy: ${strategy}`);

    // Map rows
    const mapped = rows.map(r => mapRow(r, mode, file.name)).filter(r => r && r.client_id);
    log(`ข้อมูลที่ถูกต้อง: ${mapped.length.toLocaleString()}/${rows.length.toLocaleString()} แถว`);

    if (mapped.length < rows.length) {
      log(`ข้าม ${rows.length - mapped.length} แถว (ไม่มี client_id หรือ วันที่)`, 'warn');
    }

    // ขั้นตอนก่อน insert
    if (strategy === 'replace_all') {
      log('กำลังลบข้อมูลทั้งหมด...');
      const { error } = await supabaseClient.from('sales_transactions').delete().neq('id', 0);
      if (error) throw error;
      log('ลบข้อมูลเก่าเรียบร้อย', 'success');
    } else if (strategy === 'replace_range') {
      log(`กำลังลบข้อมูลในช่วง ${fmtDate(minDate)} ถึง ${fmtDate(maxDate)}...`);
      const { data, error } = await supabaseClient.rpc('delete_sales_in_range', {
        p_start_date: toDateString(minDate),
        p_end_date: toDateString(maxDate)
      });
      if (error) throw error;
      log(`ลบข้อมูลในช่วงนี้: ${(data || 0).toLocaleString()} แถว`, 'success');
    }

    // Insert เป็น batch
    const BATCH_SIZE = 500;
    let imported = 0;
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseClient.from('sales_transactions').insert(batch);
      if (error) {
        log(`Error batch ${i}: ${error.message}`, 'error');
        throw error;
      }
      imported += batch.length;
      const pct = Math.round((imported / mapped.length) * 100);
      progressBar.style.width = pct + '%';
      if (imported % 2000 === 0 || imported === mapped.length) {
        log(`Import แล้ว ${imported.toLocaleString()}/${mapped.length.toLocaleString()} (${pct}%)`);
      }
    }

    log(`เสร็จสิ้น! Import ${imported.toLocaleString()} แถว`, 'success');
    log('Views RFM และ Product จะอัปเดตอัตโนมัติ ไปที่ Dashboard เพื่อดูผล');

    loadHistory();

  } catch (err) {
    log('เกิดข้อผิดพลาด: ' + (err.message || err), 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

// ======================================================
// LOAD HISTORY
// ======================================================
async function loadHistory() {
  const wrap = document.getElementById('historyTableWrap');
  wrap.innerHTML = '<p style="color: #888780; font-size: 13px;">กำลังโหลด...</p>';

  try {
    const { data, error } = await supabaseClient
      .from('import_history')
      .select('*')
      .limit(20);
    if (error) throw error;

    if (!data || !data.length) {
      wrap.innerHTML = '<p style="color: #888780; font-size: 13px;">ยังไม่มีประวัติการ import</p>';
      return;
    }

    const rowsHtml = data.map(r => `
      <tr>
        <td>${new Date(r.last_imported_at).toLocaleString('th-TH')}</td>
        <td>${r.source_file || '-'}</td>
        <td>${r.data_from ? fmtDate(new Date(r.data_from)) : '-'} - ${r.data_to ? fmtDate(new Date(r.data_to)) : '-'}</td>
        <td class="num">${Number(r.row_count).toLocaleString()}</td>
        <td class="num">฿${Number(r.total_revenue).toLocaleString()}</td>
      </tr>
    `).join('');

    wrap.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>วันเวลา Import</th>
            <th>ชื่อไฟล์</th>
            <th>ช่วงข้อมูล</th>
            <th class="num">จำนวนแถว</th>
            <th class="num">ยอดรวม</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  } catch (err) {
    wrap.innerHTML = `<p style="color: #A32D2D; font-size: 13px;">โหลดประวัติไม่ได้: ${err.message}</p>`;
    console.error(err);
  }
}
