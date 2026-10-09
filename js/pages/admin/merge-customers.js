// =====================================================
// merge-customers.js — รวมลูกค้าที่มีหลายรหัสให้เป็นลูกค้าเดียวกัน
// ข้อมูลลูกค้า: customer_rfm (client_id, client_name)
// บันทึกผล  : customer_master_map (upsert on client_id)
// =====================================================
const MergeCustomer = (() => {

  let selectedCustomers = [];
  let candidateGroups = [];

  function escapeHtml(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ทำชื่อให้อยู่รูปแบบเดียวกันเพื่อจับกลุ่มชื่อซ้ำ
  function normalizeName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/^(ร้าน|บริษัท|บจก\.?|หจก\.?)\s*/g, '')
      .replace(/(จำกัด|\(มหาชน\)|co\.?,?\s*ltd\.?)/g, '')
      .replace(/[\s\-_.(),/]+/g, '');
  }

  async function fetchCustomers(keyword) {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    // ดึงแบบแบ่งหน้า (Supabase จำกัด 1000 แถวต่อครั้ง)
    while (true) {
      let q = supabaseClient
        .from('customer_rfm')
        .select('client_id, client_name')
        .order('client_name', { ascending: true })
        .range(from, from + pageSize - 1);
      if (keyword) q = q.ilike('client_name', `%${keyword}%`);
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  }

  async function fetchExistingMap(clientIds) {
    if (!clientIds.length) return {};
    const map = {};
    for (let i = 0; i < clientIds.length; i += 500) {
      const { data, error } = await supabaseClient
        .from('customer_master_map')
        .select('client_id, master_customer, master_name')
        .in('client_id', clientIds.slice(i, i + 500));
      if (error) { console.warn('customer_master_map:', error.message); break; }
      (data || []).forEach(r => { map[r.client_id] = r; });
    }
    return map;
  }

  async function loadCandidates() {
    const list = document.getElementById('candidateList');
    const keyword = (document.getElementById('searchInput')?.value || '').trim();
    list.innerHTML = '<div style="padding:16px;color:#888">กำลังโหลด...</div>';

    try {
      const rows = await fetchCustomers(keyword);

      // unique ตาม client_id
      const byId = new Map();
      rows.forEach(r => { if (r.client_id && !byId.has(r.client_id)) byId.set(r.client_id, r); });
      const customers = [...byId.values()];
      const existing = await fetchExistingMap(customers.map(c => c.client_id));

      // จัดกลุ่มตามชื่อที่ normalize แล้ว
      const groups = new Map();
      customers.forEach(c => {
        const key = normalizeName(c.client_name) || c.client_id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ ...c, master: existing[c.client_id] || null });
      });

      // ไม่ค้นหา → แสดงเฉพาะกลุ่มที่มีมากกว่า 1 รหัส, ค้นหา → แสดงทุกผลลัพธ์
      candidateGroups = [...groups.values()].filter(g => keyword ? true : g.length > 1);
      renderCandidates();
    } catch (err) {
      console.error(err);
      list.innerHTML = `<div style="padding:16px;color:#dc2626">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message || err)}</div>`;
    }
  }

  function renderCandidates() {
    const list = document.getElementById('candidateList');
    if (!candidateGroups.length) {
      list.innerHTML = '<div style="padding:16px;color:#888">ไม่พบลูกค้าที่อาจซ้ำกัน</div>';
      return;
    }
    const selectedIds = new Set(selectedCustomers.map(x => x.client_id));
    list.innerHTML = candidateGroups.map((group, gi) => `
      <div class="candidate-group">
        <div class="group-title">${escapeHtml(group[0].client_name)} <small style="color:#888;font-weight:400">(${group.length} รหัส)</small></div>
        ${group.map((item, ii) => `
          <label class="customer-row">
            <div class="customer-info">
              <span class="customer-id">${escapeHtml(item.client_id)}</span>
              <span class="customer-name">${escapeHtml(item.client_name)}${item.master ? ` · รวมแล้วเป็น ${escapeHtml(item.master.master_customer)}` : ''}</span>
            </div>
            <input type="checkbox" ${selectedIds.has(item.client_id) ? 'checked' : ''}
              onchange="MergeCustomer.toggleCustomer(${gi}, ${ii}, this.checked)">
          </label>`).join('')}
      </div>`).join('');
  }

  function toggleCustomer(groupIndex, itemIndex, checked) {
    const item = candidateGroups[groupIndex]?.[itemIndex];
    if (!item) return;

    if (checked) {
      if (!selectedCustomers.some(x => x.client_id === item.client_id)) {
        selectedCustomers.push(item);
      }
    } else {
      selectedCustomers = selectedCustomers.filter(x => x.client_id !== item.client_id);
    }

    autoFillMaster();
  }

  function autoFillMaster() {

    if (!selectedCustomers.length) return;

    const first = selectedCustomers[0];

    if (!document.getElementById('masterName').value) {
      document.getElementById('masterName').value = first.client_name;
    }

    if (!document.getElementById('masterCustomer').value) {
      document.getElementById('masterCustomer').value = 'CUST-' + Date.now();
    }
  }

  async function mergeSelected() {

    if (selectedCustomers.length < 2) {
      alert('เลือกลูกค้าอย่างน้อย 2 รายการ');
      return;
    }

    const masterCustomer = document.getElementById('masterCustomer').value.trim();
    const masterName = document.getElementById('masterName').value.trim();

    if (!masterCustomer || !masterName) {
      alert('กรอก master customer');
      return;
    }

    const payload = selectedCustomers.map((item, index) => ({
      client_id: item.client_id,
      client_name: item.client_name,
      master_customer: masterCustomer,
      master_name: masterName,
      is_primary: index === 0
    }));

    const { error } = await supabaseClient
      .from('customer_master_map')
      .upsert(payload, {
        onConflict: 'client_id'
      });

    if (error) {
      console.error(error);
      alert('Merge ไม่สำเร็จ');
      return;
    }

    alert('Merge สำเร็จ');

    selectedCustomers = [];

    document.getElementById('masterCustomer').value = '';
    document.getElementById('masterName').value = '';

    loadCandidates();
  }

  return {
    loadCandidates,
    toggleCustomer,
    mergeSelected
  };

})();

window.MergeCustomer = MergeCustomer;

window.addEventListener('DOMContentLoaded', async () => {
  if (typeof protectPage === 'function') await protectPage(['admin']);
  MergeCustomer.loadCandidates();
  document.getElementById('searchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') MergeCustomer.loadCandidates();
  });
});