function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + page) || document.querySelector('.page');
    if (!target) return;
    target.classList.add('active');

    // Update flow steps in header
    const steps = document.querySelectorAll('.flow-step');
    const map = { sale: 0, manager: 1, executive: 2, tracking: 3, doc: 3 };
    steps.forEach((s, i) => {
      s.classList.remove('active', 'done');
      if (i < (map[page] ?? 0)) s.classList.add('done');
      else if (i === (map[page] ?? 0)) s.classList.add('active');
    });

    // Update sidebar active
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  }

  // Init
  showPage('sale');
