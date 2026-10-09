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

var NotificationCenter = window.NotificationCenter || {
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
        this.loadHeaderUser(),
      ]);

      this.renderAlertBars();
      this.renderSummaryCards();
      this.renderTeamTable();
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
          report_date,
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
   * วันที่ของรายงาน (ใช้ report_date ถ้ามี ไม่งั้น submitted_at) แบบเวลาท้องถิ่น
   */
  reportDay(r) {
    const raw = r.report_date || r.submitted_at;
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
      const [y, m, d] = String(raw).split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const d = new Date(raw);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  },

  dayKey(d) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },

  /**
   * สถิติรายคนของสัปดาห์นี้ (จันทร์–เสาร์)
   * ⚠️ นับเป็น "วันที่ส่งรายงาน" (ตามกฎ 6 วัน/สัปดาห์) ไม่ใช่จำนวนแถวรายงาน
   *    (1 การเข้าร้านอาจมีหลายแถวตามจำนวนสินค้า)
   * สถานะเทียบกับ "วันทำงานที่ผ่านมาแล้ว" (ไม่นับวันนี้ เพราะยังส่งได้อยู่)
   *   ขาด 0 วัน = ตามแผน · ขาด 1 วัน = warning · ขาด ≥2 วัน = critical
   */
  getSalesWeeklyStats() {
    const monday = this.getMonday(new Date());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const required = this.config.requiredReportsPerWeek; // 6 วัน

    // วันทำงาน จ.–ส. ของสัปดาห์นี้
    const weekDays = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });

    return this.state.salesList.map((sales) => {
      const mine = this.state.reports.filter((r) => r.sale_id === sales.id);

      const daysWithReport = new Set();
      const shopsThisWeek = new Set();
      const unreadVisits = new Set();
      mine.forEach((r) => {
        const d = this.reportDay(r);
        if (!d) return;
        const key = this.dayKey(d);
        if (d >= monday && d <= weekDays[5]) {
          daysWithReport.add(key);
          if (r.shop_id) shopsThisWeek.add(r.shop_id);
        }
        if (!r.manager_acknowledged) unreadVisits.add(`${r.shop_id}__${key}`);
      });

      const days = weekDays.map((d) => {
        const key = this.dayKey(d);
        const done = daysWithReport.has(key);
        let state = 'future';
        if (done) state = 'done';
        else if (d < today) state = 'missed';
        else if (d.getTime() === today.getTime()) state = 'today';
        return { date: d, state };
      });

      const daysDone = days.filter((d) => d.state === 'done').length;
      const missedDays = days.filter((d) => d.state === 'missed').length;

      let status = 'normal';
      let statusText = 'ตามแผน';
      if (daysDone >= required) {
        statusText = 'ส่งครบสัปดาห์';
      } else if (missedDays >= 2) {
        status = 'critical';
        statusText = `ขาด ${missedDays} วัน`;
      } else if (missedDays === 1) {
        status = 'warning';
        statusText = 'ขาด 1 วัน';
      }

      const lastReport = mine.reduce((best, r) => {
        const t = new Date(r.submitted_at || r.report_date || 0).getTime();
        return t > best ? t : best;
      }, 0);

      return {
        ...sales,
        days,
        reportsCount: daysDone, // = จำนวนวันที่ส่งแล้ว
        required,
        missedDays,
        shops: shopsThisWeek.size,
        unread: unreadVisits.size,
        percentage: Math.min(100, Math.round((daysDone / required) * 100)),
        lastReportDate: lastReport ? new Date(lastReport) : null,
        status,
        statusText,
        missing: Math.max(0, required - daysDone),
      };
    });
  },

  /**
   * เซลล์ที่ต้องติดตาม (ขาดส่งในวันที่ผ่านมาแล้ว)
   */
  getInactiveSales() {
    return this.getSalesWeeklyStats()
      .filter((s) => s.status === 'critical' || s.status === 'warning')
      .sort((a, b) => b.missedDays - a.missedDays || a.reportsCount - b.reportsCount);
  },

  /**
   * รายงานที่ยังไม่อ่าน — นับเป็น "การเข้าร้าน" (เซลล์+ร้าน+วัน) ให้ตรงกับหน้า reportTracker
   */
  getUnreadReports() {
    const seen = new Map();
    this.state.reports.forEach((r) => {
      if (r.manager_acknowledged) return;
      const d = this.reportDay(r);
      const key = `${r.sale_id}__${r.shop_id}__${d ? this.dayKey(d) : 'x'}`;
      if (!seen.has(key)) seen.set(key, r);
    });
    return [...seen.values()];
  },

  /**
   * ร้านค้าที่เข้าเยี่ยมสัปดาห์นี้ (ไม่ซ้ำ)
   */
  getWeeklyShopVisits() {
    const monday = this.getMonday(new Date());
    const saturday = this.getSaturday(new Date());
    const uniqueShops = new Set();
    this.state.reports.forEach((r) => {
      const d = this.reportDay(r);
      if (d && d >= monday && d <= saturday && r.shop_id) uniqueShops.add(r.shop_id);
    });
    return {
      count: uniqueShops.size,
      target: this.config.weeklyShopTarget,
      percentage: Math.round((uniqueShops.size / this.config.weeklyShopTarget) * 100),
    };
  },

  /**
   * เซลล์ที่ส่งตามแผน (ไม่ขาดวันที่ผ่านมา)
   */
  getActiveSalesCount() {
    const stats = this.getSalesWeeklyStats();
    const onTrack = stats.filter((s) => s.status === 'normal').length;
    return {
      active: onTrack,
      total: stats.length,
      percentage: stats.length ? Math.round((onTrack / stats.length) * 100) : 0,
    };
  },

  calculateKPI() {
    const activeSales = this.getActiveSalesCount();
    const shopVisits = this.getWeeklyShopVisits();
    const kpi = Math.round((activeSales.percentage + Math.min(shopVisits.percentage, 100)) / 2);
    return { value: kpi, target: this.config.kpiTarget, status: kpi >= this.config.kpiTarget ? 'good' : 'warning' };
  },

  getClaimsSummary() {
    const claims = this.state.claims;
    return {
      total: claims.length,
      pending: claims.filter((c) => c.status === 'pending' || c.status === 'รอดำเนินการ' || !c.status).length,
      approved: claims.filter((c) => c.status === 'approved' || c.status === 'อนุมัติ').length,
      rejected: claims.filter((c) => c.status === 'rejected' || c.status === 'ไม่อนุมัติ').length,
    };
  },

  // ─────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────

  esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /** กล่อง "ต้องดำเนินการ" (คอลัมน์ขวา) */
  renderAlertBars() {
    const container = document.getElementById('alertBars');
    if (!container) return;

    const inactive = this.getInactiveSales();
    const unread = this.getUnreadReports();
    const claims = this.getClaimsSummary();
    const today = new Date();
    const todayUnread = unread.filter((r) => {
      const d = this.reportDay(r);
      return d && d.toDateString() === today.toDateString();
    }).length;

    const items = [];
    const critical = inactive.filter((s) => s.status === 'critical');
    const warning = inactive.filter((s) => s.status === 'warning');

    if (critical.length) {
      items.push({
        type: 'critical', icon: 'error',
        title: `เซลล์ขาดส่ง ≥2 วัน · ${critical.length} คน`,
        desc: critical.slice(0, 3).map((s) => s.display_name || s.username).join(', ') + (critical.length > 3 ? ` +${critical.length - 3}` : ''),
        action: `NotificationCenter.setTeamFilter('follow')`, actionText: 'ดูรายชื่อ',
      });
    }
    if (warning.length) {
      items.push({
        type: 'warning', icon: 'schedule',
        title: `เซลล์ขาดส่ง 1 วัน · ${warning.length} คน`,
        desc: warning.slice(0, 3).map((s) => s.display_name || s.username).join(', ') + (warning.length > 3 ? ` +${warning.length - 3}` : ''),
        action: `NotificationCenter.setTeamFilter('follow')`, actionText: 'ดูรายชื่อ',
      });
    }
    if (unread.length) {
      items.push({
        type: 'info', icon: 'mark_email_unread',
        title: `รายงานรอตรวจ ${unread.length} การเข้าร้าน`,
        desc: `วันนี้ ${todayUnread} รายการ`,
        action: 'NotificationCenter.goToUnreadReports()', actionText: 'ตรวจ',
      });
    }
    if (claims.pending) {
      items.push({
        type: 'warning', icon: 'inventory_2',
        title: `เคลมรอดำเนินการ ${claims.pending} รายการ`,
        desc: 'ตรวจสอบและอนุมัติ',
        action: 'NotificationCenter.goToPendingClaims()', actionText: 'เปิด',
      });
    }

    if (!items.length) {
      container.innerHTML = `
        <div class="md-alert success">
          <span class="material-symbols-outlined">task_alt</span>
          <div class="md-alert-text"><b>ทุกอย่างเรียบร้อย</b><small>ไม่มีรายการที่ต้องดำเนินการ</small></div>
        </div>`;
      return;
    }

    container.innerHTML = items.map((a) => `
      <div class="md-alert ${a.type}">
        <span class="material-symbols-outlined">${a.icon}</span>
        <div class="md-alert-text"><b>${this.esc(a.title)}</b><small>${this.esc(a.desc)}</small></div>
        <button type="button" class="md-alert-btn" onclick="${a.action}">${a.actionText}</button>
      </div>`).join('');
  },

  /** การ์ด KPI 4 ใบ */
  renderSummaryCards() {
    const unread = this.getUnreadReports();
    const monday = this.getMonday(new Date());
    const weekVisits = new Set(
      this.state.reports
        .filter((r) => { const d = this.reportDay(r); return d && d >= monday; })
        .map((r) => `${r.sale_id}__${r.shop_id}__${this.dayKey(this.reportDay(r))}`),
    ).size;

    this.updateCard('valueUnread', unread.length);
    this.updateCard('subUnread', `การเข้าร้าน · สัปดาห์นี้ทั้งหมด ${weekVisits}`);
    this.updateBadge('badgeUnread', unread.length ? 'badge-warning' : 'badge-success', unread.length ? 'ต้องตรวจ' : 'ครบแล้ว');

    const active = this.getActiveSalesCount();
    this.updateCard('valueSales', `${active.active}/${active.total}`);
    this.updateCard('subSales', `ส่งตามแผน (${this.config.requiredReportsPerWeek} วัน/สัปดาห์)`);
    this.updateBadge('badgeSales', active.percentage >= 80 ? 'badge-success' : 'badge-warning', active.percentage >= 80 ? 'ปกติ' : 'ต้องติดตาม');
    this.updateProgress('progressSales', active.percentage, active.percentage >= 80 ? 'success' : 'warning');

    const shops = this.getWeeklyShopVisits();
    this.updateCard('valueShops', shops.count);
    this.updateCard('subShops', `เป้าหมาย ${shops.target} ร้าน/สัปดาห์`);
    this.updateProgress('progressShops', Math.min(shops.percentage, 100), 'info');

    const claims = this.getClaimsSummary();
    this.updateCard('valueClaimPending', claims.pending);
    this.updateCard('subClaimPending', `จากเคลมเดือนนี้ ${claims.total} รายการ`);
    this.updateBadge('badgeClaimPending', claims.pending ? 'badge-warning' : 'badge-success', claims.pending ? 'รอดำเนินการ' : 'ไม่มีค้าง');
  },

  /** ตารางความคืบหน้าทีม (ทุกคน) */
  teamFilter: 'all',

  setTeamFilter(f) {
    this.teamFilter = f;
    document.querySelectorAll('#teamFilter [data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === f));
    this.renderTeamTable();
    document.querySelector('.md-team')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  renderTeamTable() {
    const body = document.getElementById('teamTableBody');
    if (!body) return;
    const dayNames = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    const order = { critical: 0, warning: 1, normal: 2 };
    let stats = this.getSalesWeeklyStats().sort(
      (a, b) => order[a.status] - order[b.status] || a.reportsCount - b.reportsCount ||
        String(a.display_name).localeCompare(String(b.display_name), 'th'),
    );

    // ตัวนับบนปุ่มกรอง
    const nFollow = stats.filter((s) => s.status !== 'normal').length;
    this.updateCard('teamCountAll', stats.length);
    this.updateCard('teamCountFollow', nFollow);
    this.updateCard('teamCountOk', stats.length - nFollow);

    if (this.teamFilter === 'follow') stats = stats.filter((s) => s.status !== 'normal');
    if (this.teamFilter === 'ok') stats = stats.filter((s) => s.status === 'normal');

    if (!stats.length) {
      body.innerHTML = `<tr><td colspan="7" class="md-empty">${this.teamFilter === 'follow' ? '🎉 ไม่มีเซลล์ที่ต้องติดตาม' : 'ไม่มีข้อมูลเซลล์'}</td></tr>`;
      return;
    }

    body.innerHTML = stats.map((s) => {
      const name = s.display_name || s.username || 'ไม่ระบุ';
      const dots = s.days.map((d, i) => {
        const tip = `${dayNames[i]} ${d.date.getDate()}/${d.date.getMonth() + 1} · ${{ done: 'ส่งแล้ว', missed: 'ไม่ได้ส่ง', today: 'วันนี้ (ยังไม่ส่ง)', future: 'ยังไม่ถึง' }[d.state]}`;
        return `<span class="md-day ${d.state}" title="${tip}">${dayNames[i]}</span>`;
      }).join('');
      const barCls = s.status === 'critical' ? 'danger' : s.status === 'warning' ? 'warning' : 'success';
      return `
        <tr class="md-row ${s.status}" onclick="NotificationCenter.openSalesReports('${s.id}')" title="เปิดรายงานของ ${this.esc(name)}">
          <td>
            <div class="md-person">
              <span class="md-avatar ${s.status}">${this.esc(this.getInitials(name))}</span>
              <span class="md-person-text"><b>${this.esc(name)}</b><small>${this.esc(s.area || '')}</small></span>
            </div>
          </td>
          <td><div class="md-days">${dots}</div></td>
          <td>
            <div class="md-progress-cell">
              <span><b>${s.reportsCount}</b>/${s.required} วัน</span>
              <div class="md-bar"><i class="${barCls}" style="width:${s.percentage}%"></i></div>
            </div>
          </td>
          <td class="md-num">${s.shops}</td>
          <td class="md-num">${s.unread ? `<span class="md-pill warn">${s.unread}</span>` : '<span class="md-muted">0</span>'}</td>
          <td class="md-when">${this.relativeTime(s.lastReportDate)}</td>
          <td><span class="md-status ${s.status}">${this.esc(s.statusText)}</span></td>
        </tr>`;
    }).join('');
  },

  // เก็บชื่อเดิมไว้ (โค้ดเก่าเรียกใช้)
  renderSalesAlertList() {
    this.renderTeamTable();
  },

  renderClaimsSummary() {
    const summary = this.getClaimsSummary();
    this.updateCard('claimsMonthTitle', `เคลม ${this.getThaiMonth(new Date())}`);
    this.updateCard('claimsUpdated', `อัปเดต ${this.formatTime(new Date())}`);
    this.updateCard('claimTotal', summary.total);
    this.updateCard('claimPending', summary.pending);
    this.updateCard('claimApproved', summary.approved);
    this.updateCard('claimRejected', summary.rejected);

    const bar = document.getElementById('claimBar');
    if (bar) {
      const t = summary.total || 1;
      bar.innerHTML = summary.total
        ? `<i class="approved" style="width:${(summary.approved / t) * 100}%"></i><i class="pending" style="width:${(summary.pending / t) * 100}%"></i><i class="rejected" style="width:${(summary.rejected / t) * 100}%"></i>`
        : '';
    }
  },

  relativeTime(date) {
    if (!date) return '<span class="md-muted">ยังไม่เคยส่ง</span>';
    const now = new Date();
    const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
    const n0 = new Date(now); n0.setHours(0, 0, 0, 0);
    const diff = Math.round((n0 - d0) / 86400000);
    const hm = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    if (diff === 0) return `วันนี้ ${hm}`;
    if (diff === 1) return `เมื่อวาน ${hm}`;
    if (diff < 7) return `${diff} วันก่อน`;
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  },

  openSalesReports(salesId) {
    window.location.href = `/pages/reports/reportTracker.html?sale=${encodeURIComponent(salesId)}`;
  },

  async loadHeaderUser() {
    try {
      const db = this.getSupabase();
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;
      const { data: p } = await db.from('profiles').select('display_name, username').eq('id', session.user.id).single();
      const name = p?.display_name || p?.username || session.user.email;
      document.querySelectorAll('[data-user="display_name"]').forEach((el) => (el.textContent = name));
      const av = document.getElementById('userAvatar');
      if (av) av.textContent = this.getInitials(name);
    } catch (e) {
      console.warn('loadHeaderUser:', e);
    }
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
      const mon = this.getMonday(new Date());
      const sat = this.getSaturday(new Date());
      const f = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      el.textContent = `${f(mon)} – ${f(sat)} · เป้า ${required} วัน/สัปดาห์ · อัปเดต ${this.formatTime(new Date())}`;
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
    window.location.href = '/pages/dashboard/QcDashboard.html?status=pending';
  },

  goToClaimsPage() {
    window.location.href = '/pages/dashboard/QcDashboard.html';
  },

  viewAllInactiveSales() {
    this.setTeamFilter('follow');
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
      this.renderTeamTable();
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