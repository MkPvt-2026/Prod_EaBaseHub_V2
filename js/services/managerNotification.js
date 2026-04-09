/* ══════════════════════════════════════════════════════════════
   MANAGER NOTIFICATION CENTER - JAVASCRIPT
   ระบบแจ้งเตือนสำหรับ Manager Dashboard
   ไฟล์: /js/components/managerNotification.js
   
   📅 กฎการส่งรายงาน:
   - ส่งรายงาน จันทร์-เสาร์ (6 วัน/สัปดาห์)
   - วันอาทิตย์ = วันหยุด (ไม่นับ)
   - ส่งครบ 6 วัน = ปกติ
   - ส่งไม่ครบ = ต้องติดตาม
   ══════════════════════════════════════════════════════════════ */

const NotificationCenter = {
  // ─────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────
  config: {
    // จำนวนรายงานที่ต้องส่งต่อสัปดาห์ (จันทร์-เสาร์ = 6 รายงาน)
    requiredReportsPerWeek: 6,
    // จำนวนรายงานขั้นต่ำที่ถือว่า warning (ต่ำกว่านี้ = critical)
    warningThreshold: 3,
    // เป้าหมายร้านค้าต่อสัปดาห์
    weeklyShopTarget: 40,
    // เป้าหมาย KPI (%)
    kpiTarget: 85,
    // Refresh interval (ms) - 5 นาที
    refreshInterval: 5 * 60 * 1000,
  },

  // ─────────────────────────────────────
  // STATE
  // ─────────────────────────────────────
  state: {
    salesList: [],
    reports: [],
    claims: [],
    isLoading: true,
    lastUpdate: null,
    db: null,
  },

  // ─────────────────────────────────────
  // GET SUPABASE CLIENT
  // ─────────────────────────────────────
  getSupabase() {
    if (this.state.db) return this.state.db;
    
    if (typeof window.supabaseClient !== 'undefined') {
      this.state.db = window.supabaseClient;
      console.log('✅ Found supabaseClient');
      return this.state.db;
    }
    
    console.error('❌ Supabase client not found!');
    return null;
  },

  // ─────────────────────────────────────
  // DATE HELPERS - สำหรับคำนวณสัปดาห์
  // ─────────────────────────────────────

  /**
   * หาวันจันทร์ของสัปดาห์
   */
  getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    // ถ้าเป็นวันอาทิตย์ (0) ให้ย้อนไป 6 วัน, ไม่งั้นย้อนไป day-1 วัน
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  /**
   * หาวันเสาร์ของสัปดาห์
   */
  getSaturday(date) {
    const monday = this.getMonday(date);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    saturday.setHours(23, 59, 59, 999);
    return saturday;
  },

  /**
   * ตรวจสอบว่าเป็นวันทำงาน (จันทร์-เสาร์)
   */
  isWorkingDay(date) {
    const day = new Date(date).getDay();
    return day >= 1 && day <= 6; // 1=จันทร์, 6=เสาร์
  },

  /**
   * นับจำนวนวันทำงานระหว่าง 2 วัน
   */
  countWorkingDays(startDate, endDate) {
    let count = 0;
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      if (this.isWorkingDay(current)) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  },

  /**
   * หาจำนวนวันทำงานที่ผ่านไปแล้วในสัปดาห์นี้
   */
  getWorkingDaysPassedThisWeek() {
    const today = new Date();
    const monday = this.getMonday(today);
    
    // ถ้าวันนี้เป็นวันอาทิตย์ = ผ่านไปครบ 6 วันแล้ว
    if (today.getDay() === 0) {
      return 6;
    }
    
    return this.countWorkingDays(monday, today);
  },

  // ─────────────────────────────────────
  // INITIALIZE
  // ─────────────────────────────────────
  async init() {
    console.log('🔔 NotificationCenter: Initializing...');
    
    const db = this.getSupabase();
    if (!db) {
      this.showError('ไม่สามารถเชื่อมต่อ Supabase ได้');
      return;
    }
    
    try {
      await Promise.all([
        this.loadSalesList(),
        this.loadReportsData(),
        this.loadClaimsData(),
      ]);

      this.renderAlertBars();
      this.renderSummaryCards();
      this.renderSalesAlertList();
      this.renderClaimsSummary();
      this.updateSummaryDate();

      this.state.isLoading = false;
      this.state.lastUpdate = new Date();
      
      console.log('✅ NotificationCenter: Initialized successfully');
      this.startAutoRefresh();

    } catch (error) {
      console.error('❌ NotificationCenter: Init failed', error);
      this.showError('ไม่สามารถโหลดข้อมูลการแจ้งเตือนได้');
    }
  },

  // ─────────────────────────────────────
  // DATA LOADING
  // ─────────────────────────────────────
  
  async loadSalesList() {
    const db = this.getSupabase();
    if (!db) return;
    
    try {
      const { data, error } = await db
        .from('profiles')
        .select('id, username, display_name, role, area, email')
        .eq('role', 'sales')
        .order('display_name');

      if (error) throw error;
      
      this.state.salesList = data || [];
      console.log(`📋 Loaded ${this.state.salesList.length} sales`);
      
    } catch (error) {
      console.error('Error loading sales list:', error);
      await this.loadSalesFromClaims();
    }
  },

  async loadSalesFromClaims() {
    const db = this.getSupabase();
    if (!db) return;
    
    try {
      const { data, error } = await db
        .from('claims')
        .select('user_id, emp_name')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const salesMap = new Map();
      (data || []).forEach(r => {
        if (r.user_id && !salesMap.has(r.user_id)) {
          salesMap.set(r.user_id, {
            id: r.user_id,
            display_name: r.emp_name || 'ไม่ระบุ'
          });
        }
      });

      this.state.salesList = Array.from(salesMap.values());
      console.log(`📋 Loaded ${this.state.salesList.length} sales from claims`);
      
    } catch (error) {
      console.error('Error loading sales from claims:', error);
      this.state.salesList = [];
    }
  },

  async loadReportsData() {
    const db = this.getSupabase();
    if (!db) return;
    
    try {
      // ดึงรายงาน 4 สัปดาห์ย้อนหลัง
      const fourWeeksAgo = new Date();
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

      const { data, error } = await db
        .from('reports')
        .select(`
          id,
          sale_id,
          shop_id,
          submitted_at,
          status,
          manager_acknowledged
        `)
        .gte('submitted_at', fourWeeksAgo.toISOString())
        .order('submitted_at', { ascending: false });

      if (error) throw error;

      this.state.reports = data || [];
      console.log(`📝 Loaded ${this.state.reports.length} reports`);

    } catch (error) {
      console.error('Error loading reports:', error);
      this.state.reports = [];
    }
  },

  async loadClaimsData() {
    const db = this.getSupabase();
    if (!db) return;
    
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data, error } = await db
        .from('claims')
        .select('id, status, created_at, emp_name, product, qty')
        .gte('created_at', startOfMonth.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.state.claims = data || [];
      console.log(`📦 Loaded ${this.state.claims.length} claims`);

    } catch (error) {
      console.error('Error loading claims:', error);
      this.state.claims = [];
    }
  },

  // ─────────────────────────────────────
  // DATA CALCULATIONS - แบบรายสัปดาห์
  // ─────────────────────────────────────

  /**
   * คำนวณสถิติการส่งรายงานของเซลล์แต่ละคน (สัปดาห์นี้)
   * นับจำนวนรายงาน ไม่ใช่จำนวนวัน (ส่งเกินได้ ไม่มีปัญหา)
   */
  getSalesWeeklyStats() {
    const monday = this.getMonday(new Date());
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    const required = this.config.requiredReportsPerWeek; // 6 รายงาน
    
    return this.state.salesList.map(sales => {
      // หารายงานของเซลล์คนนี้ในสัปดาห์นี้ (จันทร์-อาทิตย์)
      const weeklyReports = this.state.reports.filter(r => {
        if (r.sale_id !== sales.id) return false;
        const reportDate = new Date(r.submitted_at);
        return reportDate >= monday && reportDate <= sunday;
      });

      const reportsCount = weeklyReports.length;
      const percentage = Math.round((reportsCount / required) * 100);

      // หารายงานล่าสุด
      const lastReport = this.state.reports.find(r => r.sale_id === sales.id);
      const lastReportDate = lastReport ? new Date(lastReport.submitted_at) : null;

      // คำนวณสถานะ
      let status = 'normal';
      let statusText = 'ปกติ';
      
      if (reportsCount >= required) {
        // ส่งครบหรือเกิน = ปกติ
        status = 'normal';
        statusText = reportsCount > required ? `ส่งเกิน +${reportsCount - required}` : 'ส่งครบ';
      } else if (reportsCount >= this.config.warningThreshold) {
        // ส่ง 3-5 = warning
        status = 'warning';
        statusText = `ขาด ${required - reportsCount} รายงาน`;
      } else {
        // ส่ง 0-2 = critical
        status = 'critical';
        statusText = reportsCount === 0 ? 'ยังไม่ส่งเลย' : `ส่งแค่ ${reportsCount}`;
      }

      return {
        ...sales,
        reportsCount,
        required,
        percentage: Math.min(percentage, 100), // cap ที่ 100%
        lastReportDate,
        status,
        statusText,
        missing: Math.max(0, required - reportsCount),
      };
    });
  },

  /**
   * หาเซลล์ที่ต้องติดตาม (ส่งไม่ครบ)
   */
  getInactiveSales() {
    const stats = this.getSalesWeeklyStats();
    
    return stats
      .filter(s => s.status === 'critical' || s.status === 'warning')
      .sort((a, b) => {
        // เรียงตาม status (critical ก่อน) แล้วตาม percentage (น้อยก่อน)
        if (a.status === 'critical' && b.status !== 'critical') return -1;
        if (a.status !== 'critical' && b.status === 'critical') return 1;
        return a.percentage - b.percentage;
      });
  },

  /**
   * คำนวณรายงานที่ยังไม่อ่าน
   */
  getUnreadReports() {
    return this.state.reports.filter(r => 
      !r.manager_acknowledged || r.status === 'pending'
    );
  },

  /**
   * คำนวณร้านค้าที่เข้าเยี่ยมสัปดาห์นี้
   */
  getWeeklyShopVisits() {
    const monday = this.getMonday(new Date());
    const saturday = this.getSaturday(new Date());

    const weeklyReports = this.state.reports.filter(r => {
      const reportDate = new Date(r.submitted_at);
      return reportDate >= monday && reportDate <= saturday;
    });

    const uniqueShops = new Set(weeklyReports.map(r => r.shop_id));
    
    return {
      count: uniqueShops.size,
      target: this.config.weeklyShopTarget,
      percentage: Math.round((uniqueShops.size / this.config.weeklyShopTarget) * 100),
    };
  },

  /**
   * คำนวณ Active Sales (ส่งครบ 6 รายงาน/สัปดาห์)
   */
  getActiveSalesCount() {
    const stats = this.getSalesWeeklyStats();
    const activeSales = stats.filter(s => s.reportsCount >= this.config.requiredReportsPerWeek);

    return {
      active: activeSales.length,
      total: this.state.salesList.length,
      percentage: this.state.salesList.length > 0 
        ? Math.round((activeSales.length / this.state.salesList.length) * 100)
        : 0,
    };
  },

  /**
   * คำนวณ KPI
   */
  calculateKPI() {
    const activeSales = this.getActiveSalesCount();
    const shopVisits = this.getWeeklyShopVisits();
    
    const kpi = Math.round((activeSales.percentage + shopVisits.percentage) / 2);
    
    return {
      value: kpi,
      target: this.config.kpiTarget,
      status: kpi >= this.config.kpiTarget ? 'good' : 'warning',
    };
  },

  /**
   * สรุปเคลม
   */
  getClaimsSummary() {
    const claims = this.state.claims;
    
    return {
      total: claims.length,
      pending: claims.filter(c => c.status === 'pending' || c.status === 'รอดำเนินการ' || !c.status).length,
      approved: claims.filter(c => c.status === 'approved' || c.status === 'อนุมัติ').length,
      rejected: claims.filter(c => c.status === 'rejected' || c.status === 'ไม่อนุมัติ').length,
    };
  },

  // ─────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────

  renderAlertBars() {
    const container = document.getElementById('alertBars');
    if (!container) return;

    const alerts = [];
    const inactiveSales = this.getInactiveSales();
    const unreadReports = this.getUnreadReports();
    const claimsSummary = this.getClaimsSummary();
    const required = this.config.requiredReportsPerWeek;

    // Alert: เซลล์ส่งไม่ครบ (Critical - ส่ง 0-2 รายงาน)
    const criticalSales = inactiveSales.filter(s => s.status === 'critical');
    if (criticalSales.length > 0) {
      const names = criticalSales.slice(0, 2).map(s => 
        `${s.display_name || s.username || 'ไม่ระบุ'} (${s.reportsCount}/${required})`
      ).join(', ');
      
      alerts.push({
        type: 'critical',
        icon: '⚠️',
        title: `มีเซลล์ ${criticalSales.length} คน ส่งรายงานน้อยมาก`,
        desc: names + (criticalSales.length > 2 ? ` และอีก ${criticalSales.length - 2} คน` : '') + ' - ต้องติดตามด่วน',
        count: `${criticalSales.length} คน`,
      });
    }

    // Alert: เซลล์ส่งไม่ครบ (Warning - ส่ง 3-5 รายงาน)
    const warningSales = inactiveSales.filter(s => s.status === 'warning');
    if (warningSales.length > 0) {
      alerts.push({
        type: 'warning',
        icon: '👤',
        title: `มีเซลล์ ${warningSales.length} คน ส่งรายงานไม่ครบ`,
        desc: `ส่งน้อยกว่า ${required} รายงาน/สัปดาห์`,
        count: `${warningSales.length} คน`,
      });
    }

    // Alert: เคลมรอดำเนินการ
    if (claimsSummary.pending > 0) {
      alerts.push({
        type: 'warning',
        icon: '📋',
        title: `มีเคลมรอดำเนินการ ${claimsSummary.pending} รายการ`,
        desc: 'กรุณาตรวจสอบและอนุมัติ',
        count: `${claimsSummary.pending} รายการ`,
      });
    }

    // Alert: รายงานยังไม่อ่าน
    if (unreadReports.length > 0) {
      const todayReports = unreadReports.filter(r => {
        const reportDate = new Date(r.submitted_at);
        const today = new Date();
        return reportDate.toDateString() === today.toDateString();
      });

      alerts.push({
        type: 'info',
        icon: '📬',
        title: `รายงานใหม่รอตรวจ ${unreadReports.length} รายการ`,
        desc: `รายงานวันนี้ ${todayReports.length} รายการ`,
        count: `${unreadReports.length} รายการ`,
      });
    }

    // ถ้าไม่มี alert
    if (alerts.length === 0) {
      container.innerHTML = `
        <div class="alert-bar success">
          <span class="alert-icon">✅</span>
          <div class="alert-content">
            <p class="alert-title">ทุกอย่างเรียบร้อย!</p>
            <p class="alert-desc">ไม่มีรายการที่ต้องดำเนินการเร่งด่วน</p>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = alerts.map(alert => `
      <div class="alert-bar ${alert.type}">
        <span class="alert-icon">${alert.icon}</span>
        <div class="alert-content">
          <p class="alert-title">${alert.title}</p>
          <p class="alert-desc">${alert.desc}</p>
        </div>
        <span class="alert-count">${alert.count}</span>
      </div>
    `).join('');
  },

  renderSummaryCards() {
    const unread = this.getUnreadReports();
    const monday = this.getMonday(new Date());
    const weeklyReports = this.state.reports.filter(r => 
      new Date(r.submitted_at) >= monday
    );
    const readPercentage = weeklyReports.length > 0 
      ? Math.round(((weeklyReports.length - unread.length) / weeklyReports.length) * 100)
      : 100;

    // Card 1: รายงานยังไม่อ่าน
    this.updateCard('valueUnread', unread.length);
    this.updateCard('subUnread', `จาก ${weeklyReports.length} รายงานสัปดาห์นี้`);
    this.updateBadge('badgeUnread', unread.length > 0 ? 'badge-warning' : 'badge-success', 
      unread.length > 0 ? 'ต้องดู' : 'ครบแล้ว');
    this.updateProgress('progressUnread', readPercentage, unread.length > 5 ? 'danger' : 'warning');

    // Card 2: เซลล์ส่งรายงานครบ (6 รายงาน/สัปดาห์)
    const activeSales = this.getActiveSalesCount();
    this.updateCard('valueSales', `${activeSales.active}/${activeSales.total}`);
    this.updateCard('subSales', `ส่งครบ ${this.config.requiredReportsPerWeek} รายงาน/สัปดาห์`);
    this.updateBadge('badgeSales', 
      activeSales.percentage >= 80 ? 'badge-success' : 'badge-warning',
      activeSales.percentage >= 80 ? 'ปกติ' : 'ต้องติดตาม');
    this.updateProgress('progressSales', activeSales.percentage, 
      activeSales.percentage >= 80 ? 'success' : 'warning');

    // Card 3: ร้านค้าเข้าเยี่ยม
    const shopVisits = this.getWeeklyShopVisits();
    this.updateCard('valueShops', shopVisits.count);
    this.updateCard('subShops', `เป้าหมาย: ${shopVisits.target} ร้าน`);
    this.updateProgress('progressShops', Math.min(shopVisits.percentage, 100), 'info');

    // Card 4: KPI
    const kpi = this.calculateKPI();
    this.updateCard('valueKPI', `${kpi.value}%`);
    this.updateCard('subKPI', `เป้าหมาย: ${kpi.target}%`);
    this.updateBadge('badgeKPI',
      kpi.status === 'good' ? 'badge-success' : 'badge-warning',
      kpi.status === 'good' ? 'ถึงเป้า' : 'ต่ำกว่าเป้า');
    this.updateProgress('progressKPI', kpi.value, kpi.status === 'good' ? 'success' : 'warning');
  },

  renderSalesAlertList() {
    const container = document.getElementById('salesAlertList');
    if (!container) return;

    const inactiveSales = this.getInactiveSales();
    const required = this.config.requiredReportsPerWeek;

    if (inactiveSales.length === 0) {
      container.innerHTML = `
        <div class="sales-alert-empty">
          <span class="material-symbols-outlined">check_circle</span>
          <div>เซลล์ทุกคนส่งรายงานครบ ${required} รายงาน/สัปดาห์</div>
        </div>
      `;
      return;
    }

    const displaySales = inactiveSales.slice(0, 5);

    container.innerHTML = displaySales.map(sales => {
      const name = sales.display_name || sales.username || 'ไม่ระบุ';
      const initials = this.getInitials(name);
      const avatarClass = sales.status === 'critical' ? 'danger' : 'warning';
      const badgeClass = sales.status === 'critical' ? 'critical' : 'warning';

      return `
        <div class="sales-alert-item" onclick="NotificationCenter.contactSales('${sales.id}', '${sales.email || ''}')">
          <div class="sales-avatar ${avatarClass}">${initials}</div>
          <div class="sales-info">
            <div class="sales-name">${name}</div>
            <div class="sales-status">ส่ง ${sales.reportsCount}/${required} รายงาน</div>
          </div>
          <span class="days-badge ${badgeClass}">${sales.statusText}</span>
        </div>
      `;
    }).join('');

    if (inactiveSales.length > 5) {
      container.innerHTML += `
        <div class="sales-alert-item" onclick="NotificationCenter.viewAllInactiveSales()" style="justify-content: center;">
          <span style="color: #10b981; font-weight: 500;">ดูเพิ่มอีก ${inactiveSales.length - 5} คน →</span>
        </div>
      `;
    }
  },

  renderClaimsSummary() {
    const summary = this.getClaimsSummary();
    const monthName = this.getThaiMonth(new Date());

    this.updateCard('claimsMonthTitle', `เคลม ${monthName}`);
    this.updateCard('claimsUpdated', `อัพเดท: ${this.formatTime(new Date())}`);
    this.updateCard('claimTotal', summary.total);
    this.updateCard('claimPending', summary.pending);
    this.updateCard('claimApproved', summary.approved);
    this.updateCard('claimRejected', summary.rejected);
  },

  // ─────────────────────────────────────
  // HELPER FUNCTIONS
  // ─────────────────────────────────────

  updateCard(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = value;
  },

  updateBadge(elementId, className, text) {
    const el = document.getElementById(elementId);
    if (el) {
      el.className = `notif-badge ${className}`;
      el.textContent = text;
    }
  },

  updateProgress(elementId, percentage, type = '') {
    const el = document.getElementById(elementId);
    if (el) {
      el.style.width = `${Math.min(percentage, 100)}%`;
      el.className = `progress-bar ${type ? 'progress-' + type : ''}`;
    }
  },

  updateSummaryDate() {
    const el = document.getElementById('summaryDate');
    if (el) {
      const required = this.config.requiredReportsPerWeek;
      el.textContent = `เป้าหมาย: ${required} รายงาน/สัปดาห์ | อัพเดท: ${this.formatTime(new Date())}`;
    }
  },

  getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return parts[0].charAt(0) + parts[1].charAt(0);
    }
    return name.substring(0, 2).toUpperCase();
  },

  formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  },

  formatTime(date) {
    return date.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    });
  },

  getThaiMonth(date) {
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 
      'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
      'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    return months[date.getMonth()] + ' ' + (date.getFullYear() + 543);
  },

  showError(message) {
    const container = document.getElementById('alertBars');
    if (container) {
      container.innerHTML = `
        <div class="alert-bar critical">
          <span class="alert-icon">❌</span>
          <div class="alert-content">
            <p class="alert-title">${message}</p>
            <p class="alert-desc">กรุณาลองรีเฟรชหน้าใหม่</p>
          </div>
        </div>
      `;
    }
  },

  // ─────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────

  goToUnreadReports() {
    window.location.href = '/pages/reports/reportTracker.html?filter=unread';
  },

  goToPendingClaims() {
    window.location.href = '/pages/claims/claimManager.html?status=pending';
  },

  goToClaimsPage() {
    window.location.href = '/pages/claims/claimManager.html';
  },

  viewAllInactiveSales() {
    const inactiveSales = this.getInactiveSales();
    const required = this.config.requiredReportsPerWeek;
    
    if (typeof openModal === 'function') {
      const content = `
        <p style="margin-bottom: 15px; color: #6b7280;">เป้าหมาย: ${required} รายงาน/สัปดาห์</p>
        ${inactiveSales.map(s => `
          <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
            <div>
              <div style="font-weight: 500;">${s.display_name || s.username || 'ไม่ระบุ'}</div>
              <div style="font-size: 0.85rem; color: #6b7280;">ส่ง ${s.reportsCount}/${required} รายงาน</div>
            </div>
            <span style="color: ${s.status === 'critical' ? '#ef4444' : '#f59e0b'}; font-weight: 600;">${s.statusText}</span>
          </div>
        `).join('')}
      `;
      
      openModal('เซลล์ที่ต้องติดตาม', content);
    } else {
      alert('รายชื่อเซลล์ที่ต้องติดตาม:\n\n' + 
        inactiveSales.map(s => `${s.display_name || s.username} - ส่ง ${s.reportsCount}/${required} (${s.statusText})`).join('\n'));
    }
  },

  contactSales(salesId, email) {
    if (email) {
      if (confirm(`ส่งอีเมลถึง ${email}?`)) {
        window.location.href = `mailto:${email}?subject=ติดตามรายงานประจำสัปดาห์`;
      }
    } else {
      alert('ไม่พบอีเมลของเซลล์คนนี้');
    }
  },

  contactInactiveSales() {
    const inactiveSales = this.getInactiveSales();
    if (inactiveSales.length === 0) {
      alert('ไม่มีเซลล์ที่ต้องติดตาม');
      return;
    }

    const firstSales = inactiveSales[0];
    this.contactSales(firstSales.id, firstSales.email);
  },

  async exportWeeklyReport() {
    alert('กำลังเตรียมรายงานสรุปรายสัปดาห์...\n\n(ฟีเจอร์นี้จะพร้อมใช้งานเร็วๆ นี้)');
  },

  // ─────────────────────────────────────
  // AUTO REFRESH
  // ─────────────────────────────────────

  startAutoRefresh() {
    setInterval(() => {
      console.log('🔄 NotificationCenter: Auto refreshing...');
      this.refresh();
    }, this.config.refreshInterval);
  },

  async refresh() {
    try {
      await Promise.all([
        this.loadReportsData(),
        this.loadClaimsData(),
      ]);

      this.renderAlertBars();
      this.renderSummaryCards();
      this.renderSalesAlertList();
      this.renderClaimsSummary();
      this.updateSummaryDate();

      this.state.lastUpdate = new Date();
      
    } catch (error) {
      console.error('Error refreshing notifications:', error);
    }
  },
};

// ─────────────────────────────────────
// AUTO INIT
// ─────────────────────────────────────
(function initNotificationCenter() {
  function tryInit() {
    if (typeof window.supabaseClient !== 'undefined') {
      console.log('🚀 supabaseClient ready, initializing NotificationCenter...');
      NotificationCenter.init();
      return true;
    }
    return false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (!tryInit()) {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            if (tryInit() || attempts >= 20) {
              clearInterval(interval);
              if (attempts >= 20) {
                NotificationCenter.showError('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
              }
            }
          }, 250);
        }
      }, 100);
    });
  } else {
    setTimeout(() => {
      if (!tryInit()) {
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          if (tryInit() || attempts >= 20) {
            clearInterval(interval);
            if (attempts >= 20) {
              NotificationCenter.showError('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
            }
          }
        }, 250);
      }
    }, 100);
  }
})();

window.NotificationCenter = NotificationCenter;