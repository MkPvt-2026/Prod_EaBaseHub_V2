const MergeCustomer = (() => {
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

window.addEventListener('DOMContentLoaded', () => {
  MergeCustomer.loadCandidates();
});