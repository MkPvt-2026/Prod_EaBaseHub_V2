/* ══════════════════════════════════════════════════════════════
   MANAGER NOTIFICATION CENTER - JAVASCRIPT
   ระบบแจ้งเตือนสำหรับ Manager Dashboard
   ไฟล์: /js/components/managerNotification.js
   
   Dependencies:
   - supabaseClient.js (ต้องโหลดก่อน)
   - userService.js (optional)
   ══════════════════════════════════════════════════════════════ */

var NotificationCenter = window.NotificationCenter || {
  // ─────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────
  config: {
    // จำนวนวันที่ถือว่าเซลล์ไม่ active
    inactiveDays: 3,
    // จำนวนวันที่ถือว่าวิกฤต
    criticalDays: 5,
    // เป้าหมายร้านค้าต่อสัปดาห์ (ต่อเซลล์)
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
  },

  // ─────────────────────────────────────
  // INITIALIZE
  // ─────────────────────────────────────
  async init() {
    console.log('🔔 NotificationCenter: Initializing...');
    
    try {
      // โหลดข้อมูลทั้งหมดพร้อมกัน
      await Promise.all([
        this.loadSalesList(),
        this.loadReportsData(),
        this.loadClaimsData(),
      ]);

      // Render ทุกส่วน
      this.renderAlertBars();
      this.renderSummaryCards();
      this.renderSalesAlertList();
      this.renderClaimsSummary();
      this.updateSummaryDate();

      this.state.isLoading = false;
      this.state.lastUpdate = new Date();
      
      console.log('✅ NotificationCenter: Initialized successfully');

      // Auto refresh
      this.startAutoRefresh();

    } catch (error) {
      console.error('❌ NotificationCenter: Init failed', error);
      this.showError('ไม่สามารถโหลดข้อมูลการแจ้งเตือนได้');
    }
  },

  // ─────────────────────────────────────
  // DATA LOADING
  // ─────────────────────────────────────
  
  /**
   * โหลดรายชื่อเซลล์ทั้งหมด
   */
  async loadSalesList() {
    try {
      // ดึงจาก profiles ที่เป็น role = sales
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, avatar_url, role')
        .eq('role', 'sales')
        .order('full_name');

      if (error) throw error;
      
      this.state.salesList = data || [];
      console.log(`📋 Loaded ${this.state.salesList.length} sales`);
      
    } catch (error) {
      console.error('Error loading sales list:', error);
      // Fallback: ดึงจาก reports แทน
      await this.loadSalesFromReports();
    }
  },

  /**
   * Fallback: ดึงรายชื่อเซลล์จาก reports
   */
  async loadSalesFromReports() {
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('sale_id, profiles!inner(id, full_name, phone)')
        .order('submitted_at', { ascending: false });

      if (error) throw error;

      // Unique sales
      const salesMap = new Map();
      (data || []).forEach(r => {
        if (r.profiles && !salesMap.has(r.profiles.id)) {
          salesMap.set(r.profiles.id, r.profiles);
        }
      });

      this.state.salesList = Array.from(salesMap.values());
      
    } catch (error) {
      console.error('Error loading sales from reports:', error);
      this.state.salesList = [];
    }
  },

  /**
   * โหลดข้อมูลรายงาน
   */
  async loadReportsData() {
    try {
      // ดึงรายงาน 30 วันย้อนหลัง
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('reports')
        .select(`
          id,
          sale_id,
          shop_id,
          submitted_at,
          status,
          manager_acknowledged,
          profiles:sale_id (id, full_name),
          shops:shop_id (id, name)
        `)
        .gte('submitted_at', thirtyDaysAgo.toISOString())
        .order('submitted_at', { ascending: false });

      if (error) throw error;

      this.state.reports = data || [];
      console.log(`📝 Loaded ${this.state.reports.length} reports`);

    } catch (error) {
      console.error('Error loading reports:', error);
      this.state.reports = [];
    }
  },

  /**
   * โหลดข้อมูลเคลม
   */
  async loadClaimsData() {
    try {
      // ดึงเคลมเดือนนี้
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('claims')
        .select('id, status, created_at, amount')
        .gte('created_at', startOfMonth.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.state.claims = data || [];
      console.log(`📦 Loaded ${this.state.claims.length} claims`);

    } catch (error) {
      console.error('Error loading claims:', error);
      // ถ้าไม่มีตาราง claims ก็ใช้ค่าเปล่า
      this.state.claims = [];
    }
  },

  // ─────────────────────────────────────
  // DATA CALCULATIONS
  // ─────────────────────────────────────

  /**
   * คำนวณเซลล์ที่ไม่ส่งรายงาน
   */
  getInactiveSales() {
    const today = new Date();
    const inactiveSales = [];

    this.state.salesList.forEach(sales => {
      // หารายงานล่าสุดของเซลล์คนนี้
      const lastReport = this.state.reports.find(r => 
        r.sale_id === sales.id || r.profiles?.id === sales.id
      );

      let daysSinceLastReport = 999;
      let lastReportDate = null;

      if (lastReport) {
        lastReportDate = new Date(lastReport.submitted_at);
        daysSinceLastReport = Math.floor(
          (today - lastReportDate) / (1000 * 60 * 60 * 24)
        );
      }

      if (daysSinceLastReport >= this.config.inactiveDays) {
        inactiveSales.push({
          ...sales,
          daysSinceLastReport,
          lastReportDate,
          isCritical: daysSinceLastReport >= this.config.criticalDays,
        });
      }
    });

    // เรียงจากมากไปน้อย
    return inactiveSales.sort((a, b) => b.daysSinceLastReport - a.daysSinceLastReport);
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
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const weeklyReports = this.state.reports.filter(r => 
      new Date(r.submitted_at) >= startOfWeek
    );

    // Unique shops
    const uniqueShops = new Set(weeklyReports.map(r => r.shop_id));
    
    return {
      count: uniqueShops.size,
      target: this.config.weeklyShopTarget,
      percentage: Math.round((uniqueShops.size / this.config.weeklyShopTarget) * 100),
    };
  },

  /**
   * คำนวณ Active Sales (ส่งรายงานใน 3 วัน)
   */
  getActiveSalesCount() {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const activeSalesIds = new Set(
      this.state.reports
        .filter(r => new Date(r.submitted_at) >= threeDaysAgo)
        .map(r => r.sale_id || r.profiles?.id)
    );

    return {
      active: activeSalesIds.size,
      total: this.state.salesList.length,
      percentage: this.state.salesList.length > 0 
        ? Math.round((activeSalesIds.size / this.state.salesList.length) * 100)
        : 0,
    };
  },

  /**
   * คำนวณ KPI (ตัวอย่าง: อัตราการส่งรายงาน)
   */
  calculateKPI() {
    const activeSales = this.getActiveSalesCount();
    const shopVisits = this.getWeeklyShopVisits();
    
    // KPI = เฉลี่ยของ % เซลล์ active + % ร้านค้าเข้าเยี่ยม
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
      pending: claims.filter(c => c.status === 'pending' || !c.status).length,
      approved: claims.filter(c => c.status === 'approved').length,
      rejected: claims.filter(c => c.status === 'rejected').length,
    };
  },

  // ─────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────

  /**
   * Render Alert Bars
   */
  renderAlertBars() {
    const container = document.getElementById('alertBars');
    if (!container) return;

    const alerts = [];
    const inactiveSales = this.getInactiveSales();
    const unreadReports = this.getUnreadReports();
    const claimsSummary = this.getClaimsSummary();

    // Alert 1: เซลล์ไม่ส่งรายงาน (Critical)
    const criticalSales = inactiveSales.filter(s => s.isCritical);
    if (criticalSales.length > 0) {
      const names = criticalSales.slice(0, 2).map(s => 
        `${s.full_name || 'ไม่ระบุ'} (${s.daysSinceLastReport} วัน)`
      ).join(', ');
      
      alerts.push({
        type: 'critical',
        icon: '⚠️',
        title: `มีเซลล์ ${criticalSales.length} คน ไม่ส่งรายงานเกิน ${this.config.criticalDays} วัน`,
        desc: names + (criticalSales.length > 2 ? ` และอีก ${criticalSales.length - 2} คน` : '') + ' - ต้องติดตามด่วน',
        count: `${criticalSales.length} คน`,
        action: () => this.viewAllInactiveSales(),
      });
    }

    // Alert 2: เซลล์ไม่ส่งรายงาน (Warning)
    const warningSales = inactiveSales.filter(s => !s.isCritical);
    if (warningSales.length > 0 && criticalSales.length === 0) {
      alerts.push({
        type: 'warning',
        icon: '👤',
        title: `มีเซลล์ ${warningSales.length} คน ไม่ส่งรายงาน ${this.config.inactiveDays}+ วัน`,
        desc: 'กรุณาติดตาม',
        count: `${warningSales.length} คน`,
        action: () => this.viewAllInactiveSales(),
      });
    }

    // Alert 3: เคลมรอดำเนินการ
    if (claimsSummary.pending > 0) {
      alerts.push({
        type: 'warning',
        icon: '📋',
        title: `มีเคลมรอดำเนินการ ${claimsSummary.pending} รายการ`,
        desc: 'กรุณาตรวจสอบและอนุมัติ',
        count: `${claimsSummary.pending} รายการ`,
        action: () => this.goToPendingClaims(),
      });
    }

    // Alert 4: รายงานยังไม่อ่าน
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
        action: () => this.goToUnreadReports(),
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

    // Render alerts
    container.innerHTML = alerts.map(alert => `
      <div class="alert-bar ${alert.type}" onclick="(${alert.action.toString()})()">
        <span class="alert-icon">${alert.icon}</span>
        <div class="alert-content">
          <p class="alert-title">${alert.title}</p>
          <p class="alert-desc">${alert.desc}</p>
        </div>
        <span class="alert-count">${alert.count}</span>
      </div>
    `).join('');
  },

  /**
   * Render Summary Cards
   */
  renderSummaryCards() {
    const unread = this.getUnreadReports();
    const totalReports = this.state.reports.length;
    const readPercentage = totalReports > 0 
      ? Math.round(((totalReports - unread.length) / totalReports) * 100)
      : 100;

    // Card 1: รายงานยังไม่อ่าน
    this.updateCard('valueUnread', unread.length);
    this.updateCard('subUnread', `จาก ${totalReports} รายงานเดือนนี้`);
    this.updateBadge('badgeUnread', unread.length > 0 ? 'badge-warning' : 'badge-success', 
      unread.length > 0 ? 'ต้องดู' : 'ครบแล้ว');
    this.updateProgress('progressUnread', readPercentage, unread.length > 5 ? 'danger' : 'warning');

    // Card 2: เซลล์ Active
    const activeSales = this.getActiveSalesCount();
    this.updateCard('valueSales', `${activeSales.active}/${activeSales.total}`);
    this.updateCard('subSales', 'ส่งรายงานใน 3 วันที่ผ่านมา');
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

  /**
   * Render Sales Alert List
   */
  renderSalesAlertList() {
    const container = document.getElementById('salesAlertList');
    if (!container) return;

    const inactiveSales = this.getInactiveSales();

    if (inactiveSales.length === 0) {
      container.innerHTML = `
        <div class="sales-alert-empty">
          <span class="material-symbols-outlined">check_circle</span>
          <div>เซลล์ทุกคนส่งรายงานเป็นปกติ</div>
        </div>
      `;
      return;
    }

    // แสดงแค่ 5 คนแรก
    const displaySales = inactiveSales.slice(0, 5);

    container.innerHTML = displaySales.map(sales => {
      const initials = this.getInitials(sales.full_name);
      const avatarClass = sales.isCritical ? 'danger' : 'warning';
      const badgeClass = sales.isCritical ? 'critical' : 'warning';
      const lastDate = sales.lastReportDate 
        ? this.formatDate(sales.lastReportDate)
        : 'ไม่เคยส่ง';

      return `
        <div class="sales-alert-item" onclick="NotificationCenter.contactSales('${sales.id}', '${sales.phone || ''}')">
          <div class="sales-avatar ${avatarClass}">${initials}</div>
          <div class="sales-info">
            <div class="sales-name">${sales.full_name || 'ไม่ระบุชื่อ'}</div>
            <div class="sales-status">รายงานล่าสุด: ${lastDate}</div>
          </div>
          <span class="days-badge ${badgeClass}">${sales.daysSinceLastReport} วัน</span>
        </div>
      `;
    }).join('');

    // แสดงจำนวนที่เหลือ
    if (inactiveSales.length > 5) {
      container.innerHTML += `
        <div class="sales-alert-item" onclick="NotificationCenter.viewAllInactiveSales()" style="justify-content: center; cursor: pointer;">
          <span style="color: var(--primary-color);">ดูเพิ่มอีก ${inactiveSales.length - 5} คน →</span>
        </div>
      `;
    }
  },

  /**
   * Render Claims Summary
   */
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
      el.textContent = `อัพเดท: ${this.formatTime(new Date())}`;
    }
  },

  getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return parts[0].charAt(0) + parts[1].charAt(0);
    }
    return name.substring(0, 2);
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
    // ไปหน้ารายงานและ filter เฉพาะที่ยังไม่อ่าน
    window.location.href = '/pages/reports/reportTracker.html?filter=unread';
  },

  goToPendingClaims() {
    // ไปหน้าเคลมและ filter เฉพาะที่รอดำเนินการ
    window.location.href = '/pages/claims/claimManager.html?status=pending';
  },

  goToClaimsPage() {
    window.location.href = '/pages/claims/claimManager.html';
  },

  viewAllInactiveSales() {
    // แสดง modal หรือไปหน้าจัดการเซลล์
    const inactiveSales = this.getInactiveSales();
    
    // ถ้ามี modal ก็เปิด modal
    if (typeof openModal === 'function') {
      // TODO: Implement modal
      alert('รายชื่อเซลล์ที่ต้องติดตาม:\n\n' + 
        inactiveSales.map(s => `${s.full_name} - ${s.daysSinceLastReport} วัน`).join('\n'));
    } else {
      window.location.href = '/pages/sales/salesManagement.html?filter=inactive';
    }
  },

  contactSales(salesId, phone) {
    if (phone) {
      if (confirm(`โทรหาเซลล์ที่เบอร์ ${phone}?`)) {
        window.location.href = `tel:${phone}`;
      }
    } else {
      alert('ไม่พบเบอร์โทรศัพท์ของเซลล์คนนี้');
    }
  },

  contactInactiveSales() {
    const inactiveSales = this.getInactiveSales();
    if (inactiveSales.length === 0) {
      alert('ไม่มีเซลล์ที่ต้องติดตาม');
      return;
    }

    const firstSales = inactiveSales[0];
    this.contactSales(firstSales.id, firstSales.phone);
  },

  async exportWeeklyReport() {
    alert('กำลังเตรียมรายงานสรุปรายสัปดาห์...\n\n(ฟีเจอร์นี้จะพร้อมใช้งานเร็วๆ นี้)');
    // TODO: Implement export functionality
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
// AUTO INIT เมื่อ DOM พร้อม
// ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // รอให้ supabase พร้อมก่อน
  if (typeof supabase !== 'undefined') {
    NotificationCenter.init();
  } else {
    console.warn('⏳ Waiting for Supabase...');
    // รอ supabase โหลด
    const checkSupabase = setInterval(() => {
      if (typeof supabase !== 'undefined') {
        clearInterval(checkSupabase);
        NotificationCenter.init();
      }
    }, 100);
  }
});

// Export for use in other files
window.NotificationCenter = NotificationCenter;