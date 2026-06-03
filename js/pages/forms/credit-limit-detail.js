// ─── PAGE NAVIGATION ───
const pageLinks = {
  'sale': 'credit-limit-sale.html',
  'a4': 'credit-limit-a4-document.html',
  'sign': 'credit-limit-signature.html',
  'detail': 'credit-limit-detail.html',
  'finance': 'credit-limit-finance.html',
  'approval': 'credit-limit-approval.html',
  'tracking': 'credit-limit-tracking.html'
};

function goPage(id) {
  const target = pageLinks[id];
  if (target) window.location.href = target;
}

function showPage(id) {
  goPage(id);
}

// ─── CHAR COUNT ───
function updateCount() {
  const t = document.getElementById('reasonText');
  const c = document.getElementById('charCount');
  if (t && c) c.textContent = t.value.length;
}

// ─── FINANCE TABS ───
function financeTab(n) {
  [1,2,3].forEach(i => {
    const tab = document.getElementById('ftab'+i); if (tab) tab.style.display = i === n ? '' : 'none';
    const btn = document.getElementById('ft'+i);
    if (!btn) return;
    if (i === n) {
      btn.style.background = 'var(--white)';
      btn.style.color = 'var(--gray-900)';
      btn.style.boxShadow = 'var(--shadow-sm)';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--gray-500)';
      btn.style.boxShadow = 'none';
    }
  });
}

// ─── SIGNATURE MODAL ───
let sigData = null;
let isDrawing = false;
let lastX = 0, lastY = 0;

function setupCanvas(canvasId, hintId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let drawing = false;

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    if (e.touches) {
      return [(e.touches[0].clientX - r.left) * scaleX, (e.touches[0].clientY - r.top) * scaleY];
    }
    return [(e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY];
  }

  canvas.addEventListener('mousedown', e => { drawing = true; const [x,y] = getPos(e); ctx.beginPath(); ctx.moveTo(x,y); if(hintId) document.getElementById(hintId).classList.add('hidden'); });
  canvas.addEventListener('mousemove', e => { if(!drawing) return; const [x,y] = getPos(e); ctx.lineTo(x,y); ctx.stroke(); });
  canvas.addEventListener('mouseup', () => drawing = false);
  canvas.addEventListener('mouseleave', () => drawing = false);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; const [x,y] = getPos(e); ctx.beginPath(); ctx.moveTo(x,y); if(hintId) document.getElementById(hintId).classList.add('hidden'); });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); if(!drawing) return; const [x,y] = getPos(e); ctx.lineTo(x,y); ctx.stroke(); });
  canvas.addEventListener('touchend', () => drawing = false);

  return { ctx, canvas };
}

// Init signature canvases
const sigModalCanvas = setupCanvas('sigCanvas', 'sigHint');
const sigPage2Canvas = setupCanvas('sigCanvas2', 'sigHint2');

function openSigModal() {
  document.getElementById('sigModal').classList.add('open');
}
function closeSigModal() {
  document.getElementById('sigModal').classList.remove('open');
}
function clearSig() {
  const c = document.getElementById('sigCanvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  document.getElementById('sigHint').classList.remove('hidden');
}
function saveSig() {
  const c = document.getElementById('sigCanvas');
  sigData = c.toDataURL();
  // Copy to display
  const disp = document.getElementById('sigDisplay');
  if (disp) {
    const dCtx = disp.getContext('2d');
    const img = new Image();
    img.onload = () => { dCtx.clearRect(0,0,disp.width,disp.height); dCtx.drawImage(img,0,0,disp.width,disp.height); };
    img.src = sigData;
    document.getElementById('sigPlaceholder').style.display = 'none';
    document.getElementById('sigDisplayWrap').style.display = 'block';
  }
  closeSigModal();
}
function clearDisplaySig() {
  const disp = document.getElementById('sigDisplay');
  if (disp) disp.getContext('2d').clearRect(0,0,disp.width,disp.height);
  document.getElementById('sigPlaceholder').style.display = 'block';
  document.getElementById('sigDisplayWrap').style.display = 'none';
  sigData = null;
}
function clearSig2() {
  const c = document.getElementById('sigCanvas2');
  c.getContext('2d').clearRect(0,0,c.width,c.height);
  document.getElementById('sigHint2').classList.remove('hidden');
}
