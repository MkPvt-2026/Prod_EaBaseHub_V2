/* =========================================================
   INTERNAL CLAIM PAGE — JavaScript
   ฟีเจอร์: ค้นหา + กรอง + เรียง + Pagination + Modal + Export + พิมพ์
   ========================================================= */

(() => {
  'use strict';

  // ===================== CONFIG =====================
  const STATUS_LABEL = {
    pending:  { text: 'รออนุมัติ',    icon: 'pending',  cls: 'badge--pending'  },
    approved: { text: 'อนุมัติแล้ว',  icon: 'verified', cls: 'badge--approved' },
    rejected: { text: 'ปฏิเสธ',       icon: 'cancel',   cls: 'badge--rejected' },
  };

  // ===================== MOCK DATA =====================
  // ในการใช้งานจริง ดึงข้อมูลจาก Supabase แทน mock นี้
  let claims = [
    {
      claim_id: 'CLM001', date: '2026-04-28', reporter: 'สมชาย ใจดี',
      department: 'ผลิต', product_type: 'วัตถุดิบ A',
      issue: 'คุณภาพไม่ตรงตามสเปคที่กำหนด พบสิ่งเจือปนในล็อต',
      status: 'pending', note: ''
    },
    {
      claim_id: 'CLM002', date: '2026-04-27', reporter: 'สมหญิง รักงาน',
      department: 'ผลิต', product_type: 'สินค้าในกระบวนการผลิต B',
      issue: 'เสียหายระหว่างการผลิต พบรอยแตกร้าว',
      status: 'approved', note: 'ส่งคืนและเปลี่ยนใหม่เรียบร้อย'
    },
    {
      claim_id: 'CLM003', date: '2026-04-25', reporter: 'มานพ ขยันงาน',
      department: 'คลังสินค้า', product_type: 'วัตถุดิบ C',
      issue: 'พบความชื้นเกินมาตรฐานในการจัดเก็บ',
      status: 'rejected', note: 'เกิดจากการจัดเก็บไม่เหมาะสม'
    },
    {
      claim_id: 'CLM004', date: '2026-04-22', reporter: 'วิภา สุขใจ',
      department: 'QC', product_type: 'สินค้ากึ่งสำเร็จรูป D',
      issue: 'ผลทดสอบไม่ผ่านเกณฑ์มาตรฐาน',
      status: 'pending', note: ''
    },
    {
      claim_id: 'CLM005', date: '2026-04-20', reporter: 'ประยุทธ์ ทำงาน',
      department: 'จัดซื้อ', product_type: 'วัตถุดิบ E',
      issue: 'ส่งมาผิดสเปคจากผู้ขาย',
      status: 'approved', note: 'แจ้งซัพพลายเออร์เปลี่ยนของแล้ว'
    },
    {
      claim_id: 'CLM006', date: '2026-04-18', reporter: 'จันทรา แสงดาว',
      department: 'ผลิต', product_type: 'วัตถุดิบ A',
      issue: 'น้ำหนักไม่ครบตามใบส่งของ',
      status: 'pending', note: ''
    },
    {
      claim_id: 'CLM007', date: '2026-04-15', reporter: 'กิตติ ตั้งใจ',
      department: 'คลังสินค้า', product_type: 'บรรจุภัณฑ์ F',
      issue: 'บรรจุภัณฑ์ฉีกขาดจำนวนมาก',
      status: 'approved', note: 'เครมจากผู้ขนส่งสำเร็จ'
    },
    {
      claim_id: 'CLM008', date: '2026-04-12', reporter: 'อรุณ รุ่งเรือง',
      department: 'QC', product_type: 'สินค้าสำเร็จรูป G',
      issue: 'สีไม่ตรงตามตัวอย่าง',
      status: 'rejected', note: 'อยู่ในเกณฑ์ที่ยอมรับได้'
    },
    {
      claim_id: 'CLM009', date: '2026-04-10', reporter: 'สมศรี มีสุข',
      department: 'ผลิต', product_type: 'วัตถุดิบ H',
      issue: 'อายุการใช้งานเหลือน้อยกว่าที่ระบุ',
      status: 'pending', note: ''
    },
    {
      claim_id: 'CLM010', date: '2026-04-08', reporter: 'ธนา ทรัพย์มาก',
      department: 'จัดซื้อ', product_type: 'อะไหล่ I',
      issue: 'ขนาดไม่ตรงกับที่สั่งซื้อ',
      status: 'approved', note: 'เปลี่ยนของใหม่แล้ว'
    },
    {
      claim_id: 'CLM011', date: '2026-04-05', reporter: 'พรพรรณ สงสัย',
      department: 'QC', product_type: 'วัตถุดิบ J',
      issue: 'พบการปนเปื้อนของสิ่งแปลกปลอม',
      status: 'pending', note: ''
    },
    {
      claim_id: 'CLM012', date: '2026-04-02', reporter: 'ชัยชนะ ก้าวหน้า',
      department: 'คลังสินค้า', product_type: 'วัตถุดิบ K',
      issue: 'จำนวนไม่ตรงตามใบสั่งซื้อ',
      status: 'approved', note: 'ส่งของเพิ่มมาเติมแล้ว'
    }
  ];

  // ===================== STATE =====================
  const state = {
    search: '',
    status: '',
    department: '',
    date: '',
    sortBy: 'date',
    sortDir: 'desc',
    page: 1,
    pageSize: 10,
  };

  // ===================== ELEMENTS =====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    statTotal:    $('#statTotal'),
    statPending:  $('#statPending'),
    statApproved: $('#statApproved'),
    statRejected: $('#statRejected'),

    searchInput:   $('#searchInput'),
    filterStatus:  $('#filterStatus'),
    filterDept:    $('#filterDept'),
    filterDate:    $('#filterDate'),
    btnReset:      $('#btnReset'),
    resultCount:   $('#resultCount'),

    btnAddClaim:  $('#btnAddClaim'),
    btnExport:    $('#btnExport'),
    btnPrint:     $('#btnPrint'),
    btnBack:      $('#btnBack'),

    pageSize:     $('#pageSize'),
    table:        $('#claimTable'),
    tbody:        $('#claimTbody'),
    resultTbody:  $('#resultTbody'),
    emptyState:   $('#emptyState'),
    pagination:   $('#pagination'),

    // Modal
    modal:        $('#claimModal'),
    modalTitle:   $('#modalTitle'),
    form:         $('#claimForm'),
    formClaimId:  $('#formClaimId'),
    formDate:     $('#formDate'),
    formReporter: $('#formReporter'),
    formDept:     $('#formDept'),
    formProductType: $('#formProductType'),
    formIssue:    $('#formIssue'),
    formStatus:   $('#formStatus'),
    formNote:     $('#formNote'),
    btnSaveClaim: $('#btnSaveClaim'),

    toastContainer: $('#toastContainer'),
  };

  // ===================== UTILITIES =====================
  const formatDate = (d) => {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: '2-digit'
    });
  };

  const escapeHtml = (str) => {
    if (str == null) return '';
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  };

  const generateNextId = () => {
    const nums = claims
      .map(c => parseInt(c.claim_id.replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n));
    const max = nums.length ? Math.max(...nums) : 0;
    return 'CLM' + String(max + 1).padStart(3, '0');
  };

  // ===================== FILTER & SORT =====================
  const getFilteredClaims = () => {
    let list = [...claims];

    // Search
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(c =>
        c.claim_id.toLowerCase().includes(q) ||
        c.reporter.toLowerCase().includes(q) ||
        c.product_type.toLowerCase().includes(q) ||
        c.issue.toLowerCase().includes(q)
      );
    }

    // Status
    if (state.status) {
      list = list.filter(c => c.status === state.status);
    }

    // Department
    if (state.department) {
      list = list.filter(c => c.department === state.department);
    }

    // Date
    if (state.date) {
      list = list.filter(c => c.date === state.date);
    }

    // Sort
    list.sort((a, b) => {
      let av = a[state.sortBy];
      let bv = b[state.sortBy];
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return state.sortDir === 'asc' ? -1 : 1;
      if (av > bv) return state.sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  };

  // ===================== STATS =====================
  const renderStats = () => {
    const total = claims.length;
    const pending = claims.filter(c => c.status === 'pending').length;
    const approved = claims.filter(c => c.status === 'approved').length;
    const rejected = claims.filter(c => c.status === 'rejected').length;

    animateNumber(els.statTotal, total);
    animateNumber(els.statPending, pending);
    animateNumber(els.statApproved, approved);
    animateNumber(els.statRejected, rejected);
  };

  const animateNumber = (el, target) => {
    if (!el) return;
    const current = parseInt(el.textContent, 10) || 0;
    if (current === target) return;
    const diff = target - current;
    const steps = 20;
    const step = diff / steps;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      const val = Math.round(current + step * i);
      el.textContent = i === steps ? target : val;
      if (i >= steps) clearInterval(timer);
    }, 25);
  };

  // ===================== TABLE RENDER =====================
  const renderTable = () => {
    const filtered = getFilteredClaims();
    const total = filtered.length;

    els.resultCount.textContent = total;

    // Pagination math
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.pageSize;
    const pageItems = filtered.slice(start, start + state.pageSize);

    // Empty
    if (total === 0) {
      els.tbody.innerHTML = '';
      els.emptyState.hidden = false;
    } else {
      els.emptyState.hidden = true;
      els.tbody.innerHTML = pageItems.map(c => {
        const s = STATUS_LABEL[c.status] || STATUS_LABEL.pending;
        return `
          <tr>
            <td><span class="ic-cell-id">${escapeHtml(c.claim_id)}</span></td>
            <td>${formatDate(c.date)}</td>
            <td>${escapeHtml(c.reporter)}</td>
            <td>${escapeHtml(c.department)}</td>
            <td>${escapeHtml(c.product_type)}</td>
            <td class="ic-cell-issue">${escapeHtml(c.issue)}</td>
            <td>
              <span class="badge ${s.cls}">
                <span class="material-symbols-outlined">${s.icon}</span>
                ${s.text}
              </span>
            </td>
            <td>
              <div class="ic-actions">
                <button class="ic-action-btn ic-action-btn--view" data-act="view" data-id="${c.claim_id}" title="ดูรายละเอียด">
                  <span class="material-symbols-outlined">visibility</span>
                </button>
                <button class="ic-action-btn ic-action-btn--edit" data-act="edit" data-id="${c.claim_id}" title="แก้ไข">
                  <span class="material-symbols-outlined">edit</span>
                </button>
                <button class="ic-action-btn ic-action-btn--del" data-act="del" data-id="${c.claim_id}" title="ลบ">
                  <span class="material-symbols-outlined">delete</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    renderPagination(total, totalPages);
    renderResultTable();
  };

  const renderResultTable = () => {
    // แสดงเฉพาะที่อนุมัติ/ปฏิเสธ
    const decided = claims.filter(c => c.status !== 'pending');
    if (decided.length === 0) {
      els.resultTbody.innerHTML = `
        <tr><td colspan="5" style="text-align:center; color:var(--ic-text-mute); padding:30px;">
          ยังไม่มีผลการพิจารณา
        </td></tr>`;
      return;
    }
    els.resultTbody.innerHTML = decided.map(c => {
      const s = STATUS_LABEL[c.status];
      return `
        <tr>
          <td><span class="ic-cell-id">${escapeHtml(c.claim_id)}</span></td>
          <td>${formatDate(c.date)}</td>
          <td>${escapeHtml(c.reporter)}</td>
          <td>
            <span class="badge ${s.cls}">
              <span class="material-symbols-outlined">${s.icon}</span>
              ${s.text}
            </span>
          </td>
          <td class="ic-cell-issue">${escapeHtml(c.note || '-')}</td>
        </tr>
      `;
    }).join('');
  };

  // ===================== PAGINATION =====================
  const renderPagination = (total, totalPages) => {
    if (total === 0) {
      els.pagination.innerHTML = '';
      return;
    }

    const pages = [];
    const cur = state.page;

    pages.push(`
      <button class="ic-page-btn" ${cur === 1 ? 'disabled' : ''} data-page="${cur - 1}">
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
    `);

    // เลขหน้า — แสดงแบบฉลาด (1 ... 4 5 6 ... 10)
    const visiblePages = new Set([1, totalPages, cur - 1, cur, cur + 1]);
    let prev = 0;
    for (let i = 1; i <= totalPages; i++) {
      if (!visiblePages.has(i)) continue;
      if (i - prev > 1) pages.push(`<span class="ic-page-ellipsis">…</span>`);
      pages.push(`
        <button class="ic-page-btn ${i === cur ? 'active' : ''}" data-page="${i}">${i}</button>
      `);
      prev = i;
    }

    pages.push(`
      <button class="ic-page-btn" ${cur === totalPages ? 'disabled' : ''} data-page="${cur + 1}">
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    `);

    els.pagination.innerHTML = pages.join('');
  };

  // ===================== MODAL =====================
  const openModal = (mode = 'add', claim = null) => {
    els.form.reset();
    els.formClaimId.value = '';

    if (mode === 'edit' && claim) {
      els.modalTitle.innerHTML = `
        <span class="material-symbols-outlined">edit</span>
        แก้ไขเคลม ${escapeHtml(claim.claim_id)}
      `;
      els.formClaimId.value = claim.claim_id;
      els.formDate.value = claim.date;
      els.formReporter.value = claim.reporter;
      els.formDept.value = claim.department;
      els.formProductType.value = claim.product_type;
      els.formIssue.value = claim.issue;
      els.formStatus.value = claim.status;
      els.formNote.value = claim.note || '';
    } else {
      els.modalTitle.innerHTML = `
        <span class="material-symbols-outlined">add_circle</span>
        เพิ่มเคลมใหม่
      `;
      els.formDate.value = new Date().toISOString().split('T')[0];
    }

    els.modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    els.modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  const saveClaim = () => {
    if (!els.form.checkValidity()) {
      els.form.reportValidity();
      return;
    }

    const data = {
      claim_id:     els.formClaimId.value || generateNextId(),
      date:         els.formDate.value,
      reporter:     els.formReporter.value.trim(),
      department:   els.formDept.value,
      product_type: els.formProductType.value.trim(),
      issue:        els.formIssue.value.trim(),
      status:       els.formStatus.value,
      note:         els.formNote.value.trim(),
    };

    const existIdx = claims.findIndex(c => c.claim_id === data.claim_id);
    if (existIdx >= 0) {
      claims[existIdx] = data;
      showToast('อัปเดตข้อมูลเรียบร้อย', 'success');
    } else {
      claims.unshift(data);
      showToast('เพิ่มเคลมใหม่เรียบร้อย', 'success');
    }

    closeModal();
    renderStats();
    renderTable();
  };

  const deleteClaim = (id) => {
    if (!confirm(`ต้องการลบเคลม ${id} ใช่หรือไม่?`)) return;
    claims = claims.filter(c => c.claim_id !== id);
    showToast('ลบเคลมเรียบร้อย', 'success');
    renderStats();
    renderTable();
  };

  const viewClaim = (id) => {
    const c = claims.find(x => x.claim_id === id);
    if (!c) return;
    const s = STATUS_LABEL[c.status];
    alert(
      `รหัสเคลม: ${c.claim_id}\n` +
      `วันที่: ${formatDate(c.date)}\n` +
      `ผู้แจ้ง: ${c.reporter}\n` +
      `แผนก: ${c.department}\n` +
      `ประเภทสินค้า: ${c.product_type}\n` +
      `ปัญหา: ${c.issue}\n` +
      `สถานะ: ${s.text}\n` +
      `หมายเหตุ: ${c.note || '-'}`
    );
  };

  // ===================== EXPORT EXCEL =====================
  const exportExcel = () => {
    if (typeof XLSX === 'undefined') {
      showToast('ไม่พบ XLSX library', 'error');
      return;
    }
    const filtered = getFilteredClaims();
    if (filtered.length === 0) {
      showToast('ไม่มีข้อมูลให้ Export', 'error');
      return;
    }

    const data = filtered.map(c => ({
      'รหัสเคลม':       c.claim_id,
      'วันที่':         formatDate(c.date),
      'ผู้แจ้งเคลม':    c.reporter,
      'แผนก':           c.department,
      'ประเภทสินค้า':   c.product_type,
      'รายละเอียดปัญหา': c.issue,
      'สถานะ':          STATUS_LABEL[c.status]?.text || c.status,
      'หมายเหตุ':       c.note || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 14 },
      { wch: 22 }, { wch: 40 }, { wch: 14 }, { wch: 30 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'เคลมภายใน');
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `internal_claims_${today}.xlsx`);
    showToast('Export Excel สำเร็จ', 'success');
  };

  // ===================== TOAST =====================
  const showToast = (message, type = 'info') => {
    const icons = { success: 'check_circle', error: 'error', info: 'info' };
    const toast = document.createElement('div');
    toast.className = `ic-toast ic-toast--${type}`;
    toast.innerHTML = `
      <span class="material-symbols-outlined ic-toast-icon">${icons[type] || 'info'}</span>
      <span>${escapeHtml(message)}</span>
    `;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  };

  // ===================== EVENT BINDINGS =====================
  const bindEvents = () => {
    // Search (debounced)
    let searchTimer;
    els.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        state.page = 1;
        renderTable();
      }, 250);
    });

    // Filters
    els.filterStatus.addEventListener('change', (e) => {
      state.status = e.target.value;
      state.page = 1;
      renderTable();
    });
    els.filterDept.addEventListener('change', (e) => {
      state.department = e.target.value;
      state.page = 1;
      renderTable();
    });
    els.filterDate.addEventListener('change', (e) => {
      state.date = e.target.value;
      state.page = 1;
      renderTable();
    });

    // Reset filter
    els.btnReset.addEventListener('click', () => {
      state.search = '';
      state.status = '';
      state.department = '';
      state.date = '';
      state.page = 1;
      els.searchInput.value = '';
      els.filterStatus.value = '';
      els.filterDept.value = '';
      els.filterDate.value = '';
      renderTable();
      showToast('ล้างตัวกรองเรียบร้อย', 'info');
    });

    // Page size
    els.pageSize.addEventListener('change', (e) => {
      state.pageSize = parseInt(e.target.value, 10);
      state.page = 1;
      renderTable();
    });

    // Sort
    $$('#claimTable th[data-sort] .ic-sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const th = btn.closest('th');
        const key = th.dataset.sort;
        if (state.sortBy === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortBy = key;
          state.sortDir = 'asc';
        }
        // อัปเดต UI
        $$('#claimTable .ic-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const icon = btn.querySelector('.ic-sort-icon');
        if (icon) icon.textContent = state.sortDir === 'asc' ? 'expand_less' : 'expand_more';
        renderTable();
      });
    });

    // Pagination (delegated)
    els.pagination.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      const page = parseInt(btn.dataset.page, 10);
      if (!isNaN(page)) {
        state.page = page;
        renderTable();
        document.querySelector('.ic-table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Table actions (delegated)
    els.tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'view') viewClaim(id);
      else if (act === 'edit') {
        const c = claims.find(x => x.claim_id === id);
        if (c) openModal('edit', c);
      } else if (act === 'del') deleteClaim(id);
    });

    // Add / Save
    els.btnAddClaim.addEventListener('click', () => openModal('add'));
    els.btnSaveClaim.addEventListener('click', saveClaim);

    // Modal close
    els.modal.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', closeModal);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.modal.getAttribute('aria-hidden') === 'false') {
        closeModal();
      }
    });

    // Export & Print
    els.btnExport.addEventListener('click', exportExcel);
    els.btnPrint.addEventListener('click', () => {
      showToast('กำลังเตรียมพิมพ์รายงาน...', 'info');
      setTimeout(() => window.print(), 200);
    });

    // Back
    els.btnBack.addEventListener('click', () => {
      window.location.href = '/pages/admin/adminQc.html';
    });
  };

  // ===================== INIT =====================
  const init = () => {
    bindEvents();
    renderStats();
    renderTable();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();