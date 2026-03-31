// salesDashboard.js - กราฟและสถิติยอดขาย

// ========================================
// Global Variables
// ========================================

let salesChart = null;
let profitChart = null;
let topProductsChart = null;

// ========================================
// เริ่มต้นระบบ
// ========================================

async function initSalesDashboard() {
    console.log('📊 Initializing Sales Dashboard...');
    
    try {
        // โหลดข้อมูล
        await loadDashboardData();
        
        // สร้างกราฟ
        createCharts();
        
        console.log('✅ Sales Dashboard ready');
    } catch (error) {
        console.error('❌ Dashboard init error:', error);
    }
}

// ========================================
// โหลดข้อมูลจาก Supabase
// ========================================

async function loadDashboardData() {
    if (!window.supabase) {
        console.error('Supabase not available');
        return;
    }

    // 1. สรุปยอดขายรายวัน (7 วันล่าสุด)
    const { data: dailySales, error: dailyError } = await window.supabase
        .from('sales_summary_daily')
        .select('*')
        .order('import_date', { ascending: false })
        .limit(7);

    if (dailyError) {
        console.error('Daily sales error:', dailyError);
    } else {
        console.log('📅 Daily sales:', dailySales);
        updateDailySalesChart(dailySales);
    }

    // 2. สรุปกำไร (30 วันล่าสุด)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: profitData, error: profitError } = await window.supabase
        .from('sales_data')
        .select('import_date, amount_net, profit')
        .gte('import_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('import_date', { ascending: true });

    if (profitError) {
        console.error('Profit data error:', profitError);
    } else {
        console.log('💰 Profit data:', profitData);
        updateProfitChart(profitData);
    }

    // 3. สินค้าขายดี Top 10
    const { data: topProducts, error: productsError } = await window.supabase
        .from('sales_summary_by_product')
        .select('*')
        .order('total_revenue', { ascending: false })
        .limit(10);

    if (productsError) {
        console.error('Top products error:', productsError);
    } else {
        console.log('🏆 Top products:', topProducts);
        updateTopProductsChart(topProducts);
    }

    // 4. สถิติรวม
    const { data: totalStats, error: statsError } = await window.supabase
        .from('sales_data')
        .select('amount_net, profit, qty_net');

    if (statsError) {
        console.error('Stats error:', statsError);
    } else {
        updateStats(totalStats);
    }
}

// ========================================
// สร้างกราฟ
// ========================================

function createCharts() {
    // กราฟยอดขายรายวัน
    const salesCtx = document.getElementById('salesChart');
    if (salesCtx) {
        salesChart = new Chart(salesCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'ยอดขาย (บาท)',
                    data: [],
                    backgroundColor: '#3a7d44',
                    borderColor: '#2d6235',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'ยอดขายรายวัน (7 วันล่าสุด)'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString('th-TH');
                            }
                        }
                    }
                }
            }
        });
    }

    // กราฟกำไร
    const profitCtx = document.getElementById('profitChart');
    if (profitCtx) {
        profitChart = new Chart(profitCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'กำไร (บาท)',
                    data: [],
                    borderColor: '#28a745',
                    backgroundColor: 'rgba(40, 167, 69, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'กำไรสะสม (30 วันล่าสุด)'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString('th-TH');
                            }
                        }
                    }
                }
            }
        });
    }

    // กราฟสินค้าขายดี
    const topProductsCtx = document.getElementById('topProductsChart');
    if (topProductsCtx) {
        topProductsChart = new Chart(topProductsCtx, {
            type: 'horizontalBar',
            data: {
                labels: [],
                datasets: [{
                    label: 'ยอดขาย (บาท)',
                    data: [],
                    backgroundColor: [
                        '#3a7d44', '#4a8d54', '#5a9d64', '#6aad74', '#7abd84',
                        '#8acd94', '#9adda4', '#aaedb4', '#bafdc4', '#caffd4'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'สินค้าขายดี Top 10'
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString('th-TH');
                            }
                        }
                    }
                }
            }
        });
    }
}

// ========================================
// อัพเดตข้อมูลกราฟ
// ========================================

function updateDailySalesChart(data) {
    if (!salesChart || !data) return;

    // เรียงจากเก่าไปใหม่
    const sortedData = [...data].reverse();

    salesChart.data.labels = sortedData.map(d => {
        const date = new Date(d.import_date);
        return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    });

    salesChart.data.datasets[0].data = sortedData.map(d => d.total_amount || 0);
    salesChart.update();
}

function updateProfitChart(data) {
    if (!profitChart || !data) return;

    // จัดกลุ่มตามวัน
    const dailyProfit = {};
    data.forEach(row => {
        const date = row.import_date;
        if (!dailyProfit[date]) {
            dailyProfit[date] = 0;
        }
        dailyProfit[date] += (row.profit || 0);
    });

    // เรียงตามวัน
    const sortedDates = Object.keys(dailyProfit).sort();
    
    // คำนวณกำไรสะสม
    let cumulative = 0;
    const cumulativeData = sortedDates.map(date => {
        cumulative += dailyProfit[date];
        return cumulative;
    });

    profitChart.data.labels = sortedDates.map(date => {
        const d = new Date(date);
        return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    });

    profitChart.data.datasets[0].data = cumulativeData;
    profitChart.update();
}

function updateTopProductsChart(data) {
    if (!topProductsChart || !data) return;

    topProductsChart.data.labels = data.map(p => {
        // ตัดชื่อสินค้าให้สั้น
        const name = p.product_name || 'ไม่ระบุ';
        return name.length > 30 ? name.substring(0, 30) + '...' : name;
    });

    topProductsChart.data.datasets[0].data = data.map(p => p.total_revenue || 0);
    topProductsChart.update();
}

// ========================================
// อัพเดตสถิติ
// ========================================

function updateStats(data) {
    if (!data) return;

    const totalAmount = data.reduce((sum, row) => sum + (row.amount_net || 0), 0);
    const totalProfit = data.reduce((sum, row) => sum + (row.profit || 0), 0);
    const totalQty = data.reduce((sum, row) => sum + (row.qty_net || 0), 0);

    // อัพเดต DOM
    const amountEl = document.getElementById('totalAmount');
    const profitEl = document.getElementById('totalProfit');
    const qtyEl = document.getElementById('totalQty');

    if (amountEl) amountEl.textContent = totalAmount.toLocaleString('th-TH', { maximumFractionDigits: 2 });
    if (profitEl) profitEl.textContent = totalProfit.toLocaleString('th-TH', { maximumFractionDigits: 2 });
    if (qtyEl) qtyEl.textContent = totalQty.toLocaleString('th-TH');
}

// ========================================
// Refresh ข้อมูล
// ========================================

async function refreshDashboard() {
    console.log('🔄 Refreshing dashboard...');
    await loadDashboardData();
}

// ========================================
// Export
// ========================================

window.initSalesDashboard = initSalesDashboard;
window.refreshDashboard = refreshDashboard;