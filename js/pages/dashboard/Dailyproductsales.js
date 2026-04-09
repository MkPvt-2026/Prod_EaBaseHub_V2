// =====================================================
// dailyProductSales.js — Daily Product Sales Module
// =====================================================
// แสดงข้อมูลสินค้าที่ขายได้ในแต่ละวัน
// - ตารางรายวัน (วันที่ + รายการสินค้า)
// - กราฟแยกวัน
// - Dropdown เลือกวันที่ดู
// =====================================================

'use strict';


// ── State สำหรับ Daily View ──
let dailyChartInst = null;
let selectedDate = null;  // วันที่เลือกดู (null = แสดงทุกวัน)

// =====================================================
// 🗓️ INITIALIZE DAILY SECTION
// =====================================================
function initDailyProductSection() {
  setupDateDropdown();
  renderDailyProductTable();
  renderDailyProductChart();

  
}

// =====================================================
// 📅 DATE DROPDOWN
// =====================================================
function setupDateDropdown() {
  const dropdown = document.getElementById('dailyDateSelect');
  if (!dropdown) return;
  
  // รวบรวมวันที่ทั้งหมดจาก salesData
  const dates = [...new Set(salesData.map(r => r.report_date))].sort().reverse();
  
  // สร้าง options
  let html = '<option value="">📅 ทุกวัน (รวม)</option>';
  dates.forEach(date => {
    const d = new Date(date);
    const label = d.toLocaleDateString('th-TH', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short', 
      year: '2-digit' 
    });
    html += `<option value="${date}">${label}</option>`;
  });
  
  dropdown.innerHTML = html;
  
  // Event listener
  dropdown.addEventListener('change', () => {
    selectedDate = dropdown.value || null;
    renderDailyProductTable();
    renderDailyProductChart();
    updateDailySummary();
  });
}

// =====================================================
// 📊 DAILY SUMMARY CARDS
// =====================================================
function updateDailySummary() {
  const filtered = selectedDate 
    ? salesData.filter(r => r.report_date === selectedDate)
    : salesData;
  
  const totalQty = filtered.reduce((s, r) => s + (r.qty_net || 0), 0);
  const totalAmount = filtered.reduce((s, r) => s + (r.amount_net || 0), 0);
  const uniqueProducts = new Set(filtered.map(r => r.product_code).filter(Boolean)).size;
  const uniqueSales = new Set(filtered.map(r => r.sales_code).filter(Boolean)).size;
  
  setEl('dailyTotalQty', fmtNum(totalQty) + ' ชิ้น');
  setEl('dailyTotalAmount', '฿' + fmtNum(totalAmount));
  setEl('dailyProductCount', uniqueProducts + ' รายการ');
  setEl('dailySalesCount', uniqueSales + ' คน');
  
  // Update badge
  const badge = document.getElementById('dailyDateBadge');
  if (badge) {
    if (selectedDate) {
      const d = new Date(selectedDate);
      badge.textContent = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    } else {
      const days = [...new Set(salesData.map(r => r.report_date))].length;
      badge.textContent = `${days} วัน`;
    }
  }
}

// =====================================================
// 📋 DAILY PRODUCT TABLE
// =====================================================
function renderDailyProductTable() {
  const container = document.getElementById('dailyProductTable');
  if (!container) return;
  
  // กรองตามวันที่เลือก
  const filtered = selectedDate 
    ? salesData.filter(r => r.report_date === selectedDate)
    : salesData;
  
  if (!filtered.length) {
    container.innerHTML = '<div class="loading-text">ไม่มีข้อมูลในวันที่เลือก</div>';
    return;
  }
  
  // จัดกลุ่มตามวัน
  const byDate = {};
  filtered.forEach(r => {
    const date = r.report_date;
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(r);
  });
  
  // สร้าง HTML
  let html = '';
  const sortedDates = Object.keys(byDate).sort().reverse();
  
  sortedDates.forEach(date => {
    const records = byDate[date];
    const d = new Date(date);
    const dateLabel = d.toLocaleDateString('th-TH', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    
    // สรุปของวัน
    const dayTotal = records.reduce((s, r) => s + (r.amount_net || 0), 0);
    const dayQty = records.reduce((s, r) => s + (r.qty_net || 0), 0);
    const dayProfit = records.reduce((s, r) => s + (r.profit || 0), 0);
    
    // จัดกลุ่มสินค้า
    const productMap = {};
    records.forEach(r => {
      const pKey = r.product_code || r.product_name || 'ไม่ระบุ';
      if (!productMap[pKey]) {
        productMap[pKey] = {
          name: r.product_name || r.product_code || 'ไม่ระบุ',
          qty: 0,
          amount: 0,
          profit: 0,
          sellers: new Set()
        };
      }
      productMap[pKey].qty += (r.qty_net || 0);
      productMap[pKey].amount += (r.amount_net || 0);
      productMap[pKey].profit += (r.profit || 0);
      if (r.sales_name || r.sales_code) {
        productMap[pKey].sellers.add(r.sales_name || r.sales_code);
      }
    });
    
    const products = Object.values(productMap).sort((a, b) => b.amount - a.amount);
    
    html += `
      <div class="daily-date-group">
        <div class="daily-date-header">
          <div class="daily-date-title">
            <span class="daily-date-icon">📆</span>
            <span>${dateLabel}</span>
          </div>
          <div class="daily-date-summary">
            <span class="daily-stat">📦 ${fmtNum(dayQty)} ชิ้น</span>
            <span class="daily-stat">💰 ฿${fmtNum(dayTotal)}</span>
            <span class="daily-stat">💎 ฿${fmtNum(dayProfit)}</span>
          </div>
        </div>
        
        <div class="daily-table-wrap">
          <table class="daily-table">
            <thead>
              <tr>
                <th>#</th>
                <th>สินค้า</th>
                <th>จำนวน</th>
                <th>ยอดขาย</th>
                <th>เซลล์</th>
              </tr>
            </thead>
            <tbody>
              ${products.map((p, i) => `
                <tr>
                  <td class="rank-col">${i + 1}</td>
                  <td class="product-col">${p.name}</td>
                  <td class="qty-col">${fmtNum(p.qty)} ชิ้น</td>
                  <td class="amount-col">฿${fmtNum(p.amount)}</td>
                  <td class="seller-col">
                    ${[...p.sellers].slice(0, 3).map(s => `<span class="seller-tag">${s}</span>`).join('')}
                    ${p.sellers.size > 3 ? `<span class="seller-more">+${p.sellers.size - 3}</span>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  updateDailySummary();
}

// =====================================================
// 📈 DAILY PRODUCT CHART
// =====================================================
function renderDailyProductChart() {
  const ctx = document.getElementById('chartDailyProducts');
  if (!ctx) return;
  
  if (dailyChartInst) {
    try { dailyChartInst.destroy(); } catch (_) {}
  }
  
  // กรองตามวันที่เลือก
  const filtered = selectedDate 
    ? salesData.filter(r => r.report_date === selectedDate)
    : salesData;
  
  if (!filtered.length) return;
  
  if (selectedDate) {
    // แสดง Bar Chart: สินค้า Top 10 ของวันนั้น
    renderSingleDayChart(ctx, filtered);
  } else {
    // แสดง Stacked Bar: ยอดขายแต่ละวัน แยกตามสินค้า Top 5
    renderMultiDayChart(ctx, filtered);
  }
}

function renderSingleDayChart(ctx, data) {
  // รวมยอดตามสินค้า
  const productMap = {};
  data.forEach(r => {
    const name = r.product_name || r.product_code || 'ไม่ระบุ';
    if (!productMap[name]) productMap[name] = { qty: 0, amount: 0 };
    productMap[name].qty += (r.qty_net || 0);
    productMap[name].amount += (r.amount_net || 0);
  });
  
  const sorted = Object.entries(productMap)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10);
  
  dailyChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([name]) => name.length > 20 ? name.slice(0, 20) + '...' : name),
      datasets: [
        {
          label: 'ยอดขาย (฿)',
          data: sorted.map(([, d]) => d.amount),
          backgroundColor: 'rgba(0,212,170,0.7)',
          borderColor: '#00d4aa',
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          label: 'จำนวน (ชิ้น)',
          data: sorted.map(([, d]) => d.qty),
          backgroundColor: 'rgba(77,159,255,0.7)',
          borderColor: '#4d9fff',
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { 
          position: 'top',
          labels: { color: '#7a9cc0', font: { family: 'Kanit', size: 11 } }
        },
        tooltip: {
          backgroundColor: '#1e2d42',
          titleColor: '#e8f0fe',
          bodyColor: '#7a9cc0',
          borderColor: 'rgba(0,212,170,0.3)',
          borderWidth: 1,
          titleFont: { family: 'Kanit' },
          bodyFont: { family: 'Kanit' }
        }
      },
      scales: {
        x: { 
          ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 }, maxRotation: 45 },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          type: 'linear',
          position: 'left',
          ticks: { color: '#00d4aa', font: { family: 'Kanit', size: 10 }, callback: v => '฿' + fmtNum(v) },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          ticks: { color: '#4d9fff', font: { family: 'Kanit', size: 10 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function renderMultiDayChart(ctx, data) {
  // หาสินค้า Top 5 โดยรวม
  const totalByProduct = {};
  data.forEach(r => {
    const name = r.product_name || r.product_code || 'ไม่ระบุ';
    totalByProduct[name] = (totalByProduct[name] || 0) + (r.amount_net || 0);
  });
  const top5Products = Object.entries(totalByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
  
  // จัดกลุ่มตามวัน
  const dates = [...new Set(data.map(r => r.report_date))].sort();
  const datasets = [];
  
  const colors = [
    { bg: 'rgba(0,212,170,0.7)', border: '#00d4aa' },
    { bg: 'rgba(245,166,35,0.7)', border: '#f5a623' },
    { bg: 'rgba(77,159,255,0.7)', border: '#4d9fff' },
    { bg: 'rgba(168,85,247,0.7)', border: '#a855f7' },
    { bg: 'rgba(231,76,139,0.7)', border: '#e74c8b' }
  ];
  
  top5Products.forEach((product, i) => {
    const amounts = dates.map(date => {
      const dayData = data.filter(r => r.report_date === date);
      return dayData
        .filter(r => (r.product_name || r.product_code) === product)
        .reduce((s, r) => s + (r.amount_net || 0), 0);
    });
    
    datasets.push({
      label: product.length > 15 ? product.slice(0, 15) + '...' : product,
      data: amounts,
      backgroundColor: colors[i].bg,
      borderColor: colors[i].border,
      borderWidth: 1,
      borderRadius: 4
    });
  });
  
  // เพิ่ม "อื่นๆ"
  const otherAmounts = dates.map(date => {
    const dayData = data.filter(r => r.report_date === date);
    return dayData
      .filter(r => !top5Products.includes(r.product_name || r.product_code))
      .reduce((s, r) => s + (r.amount_net || 0), 0);
  });
  
  if (otherAmounts.some(v => v > 0)) {
    datasets.push({
      label: 'อื่นๆ',
      data: otherAmounts,
      backgroundColor: 'rgba(120,140,160,0.5)',
      borderColor: '#788ca0',
      borderWidth: 1,
      borderRadius: 4
    });
  }
  
  dailyChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates.map(d => {
        const dt = new Date(d);
        return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      }),
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: 'top',
          labels: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 }, boxWidth: 12 }
        },
        tooltip: {
          backgroundColor: '#1e2d42',
          titleColor: '#e8f0fe',
          bodyColor: '#7a9cc0',
          borderColor: 'rgba(0,212,170,0.3)',
          borderWidth: 1,
          titleFont: { family: 'Kanit' },
          bodyFont: { family: 'Kanit' },
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ฿${fmtNum(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { 
          stacked: true,
          ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          stacked: true,
          ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 }, callback: v => '฿' + fmtNum(v) },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

// =====================================================
// 📤 EXPORT FUNCTIONS (for main dashboard to call)
// =====================================================
// เรียกใช้จาก managerDashboard.js หลัง loadDashboard()
// เพิ่ม: initDailyProductSection();