/* ── looker-dashboard.js ── */

'use strict';

// ── state ──
let currentUrl  = '';
let currentName = '';

// ── init ──
document.addEventListener('DOMContentLoaded', () => {
  // แสดงวันที่ปัจจุบัน (ภาษาไทย)
  const d = new Date();
  document.getElementById('dateLabel').textContent =
    d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
});

// ── modal ──
function openModal() {
  document.getElementById('modalUrlInput').value  = currentUrl;
  document.getElementById('modalNameInput').value = currentName;
  document.getElementById('modalBackdrop').classList.add('open');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('modalBackdrop')) closeModal();
}

function applyUrl() {
  const url  = document.getElementById('modalUrlInput').value.trim();
  const name = document.getElementById('modalNameInput').value.trim();
  if (!url) {
    document.getElementById('modalUrlInput').focus();
    return;
  }
  closeModal();
  loadDashboard(url, name || 'Looker Dashboard');
}

// ── inline load (จาก placeholder) ──
function loadFromInline() {
  const url = document.getElementById('inlineUrlInput').value.trim();
  if (!url) {
    document.getElementById('inlineUrlInput').focus();
    return;
  }
  loadDashboard(url, 'Looker Dashboard');
}

// ── โหลด dashboard หลัก ──
function loadDashboard(url, name) {
  currentUrl  = url;
  currentName = name;

  // ซ่อน placeholder, แสดง loading
  document.getElementById('placeholder').style.display = 'none';
  document.getElementById('loadingOverlay').classList.remove('hidden');

  // อัปเดต header ของ frame
  document.getElementById('frameTitle').textContent = name;
  document.getElementById('subLabel').textContent   = url;

  // ตั้ง iframe src
  const frame   = document.getElementById('lookerFrame');
  frame.src     = url;
  frame.style.display = 'block';

  // dot — สีโหลด
  setStatus('loading');
}

// ── callback เมื่อ iframe โหลดเสร็จ ──
function onFrameLoad() {
  document.getElementById('loadingOverlay').classList.add('hidden');
  setStatus('connected');

  const now = new Date();
  document.getElementById('lastUpdate').textContent =
    'อัปเดต ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── helper: อัปเดตสี status dot ──
function setStatus(state) {
  const map = {
    idle:      'var(--muted)',
    loading:   'var(--accent2)',
    connected: 'var(--success)',
  };
  const color = map[state] || map.idle;
  document.getElementById('statusDot').style.background = color;
  document.getElementById('connDot').style.background   = color;
  document.getElementById('connStatus').textContent =
    state === 'connected' ? 'เชื่อมต่อแล้ว' :
    state === 'loading'   ? 'กำลังโหลด...'  : 'ไม่ได้เชื่อมต่อ';
}

// ── reload ──
function reloadEmbed() {
  if (!currentUrl) { openModal(); return; }
  loadDashboard(currentUrl, currentName || 'Looker Dashboard');
}

// ── fullscreen ──
function toggleFullscreen() {
  const el = document.querySelector('.frame-wrapper');
  if (!document.fullscreenElement) {
    el.requestFullscreen && el.requestFullscreen();
  } else {
    document.exitFullscreen && document.exitFullscreen();
  }
}

// ── คัดลอก URL ──
function copyUrl() {
  if (!currentUrl) return;
  navigator.clipboard.writeText(currentUrl);
  const btn  = event.currentTarget;
  const icon = btn.querySelector('.material-icons-round');
  icon.textContent = 'check';
  setTimeout(() => { icon.textContent = 'content_copy'; }, 1500);
}

// ── เปิดใน Looker tab ใหม่ ──
function openInLooker() {
  if (currentUrl) window.open(currentUrl, '_blank');
}