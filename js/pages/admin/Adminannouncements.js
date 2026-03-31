/* =============================================
   EABaseHub: Admin Announcements Management
   File: /js/pages/adminAnnouncements.js
   
   Dependencies: supabaseClient.js, userService.js, auth.js
   ============================================= */

const AdminAnnouncements = (() => {
    // ---- State ----
    let allAnnouncements = [];
    let currentFilter = 'all';
    let searchQuery = '';
    let editingId = null;
    let currentUser = null;

    // ---- Helpers ----
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
    }

    function getCategoryLabel(cat) {
        const map = { general: 'ทั่วไป', important: 'สำคัญ', update: 'อัปเดต', event: 'กิจกรรม' };
        return map[cat] || 'ทั่วไป';
    }

    async function getSupabase() {
        if (window.supabaseClient) return window.supabaseClient;
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                if (window.supabaseClient) {
                    clearInterval(interval);
                    resolve(window.supabaseClient);
                }
            }, 100);
        });
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px; z-index: 99999;
            padding: 12px 20px; border-radius: 10px;
            font-family: 'Kanit', sans-serif; font-size: 14px;
            color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
            animation: slideInRight 0.3s ease;
            background: ${type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#f59e0b'};
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ---- Fetch & Render ----
    async function fetchAll() {
        try {
            const sb = await getSupabase();
            const { data, error } = await sb
                .from('announcements')
                .select('*')
                .order('is_pinned', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            allAnnouncements = data || [];
            render();
        } catch (err) {
            console.error('[AdminAnnouncements] Fetch error:', err);
            showToast('โหลดข้อมูลผิดพลาด', 'error');
        }
    }

    function getFiltered() {
        let filtered = [...allAnnouncements];

        // Filter by status
        if (currentFilter !== 'all') {
            filtered = filtered.filter(a => a.status === currentFilter);
        }

        // Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(a =>
                (a.title || '').toLowerCase().includes(q) ||
                (a.content || '').toLowerCase().includes(q)
            );
        }

        return filtered;
    }

    function render() {
        const tbody = document.getElementById('announceTableBody');
        const empty = document.getElementById('announceEmpty');
        const filtered = getFiltered();

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        tbody.innerHTML = filtered.map(item => `
            <tr>
                <td>
                    ${item.is_pinned
                        ? '<span class="material-symbols-outlined pin-indicator">push_pin</span>'
                        : ''}
                </td>
                <td class="td-title">
                    <span>${escapeHtml(item.title)}</span>
                    <small>${escapeHtml((item.content || '').substring(0, 60))}${(item.content || '').length > 60 ? '...' : ''}</small>
                </td>
                <td>
                    <span class="announce-category ${escapeHtml(item.category)}">${getCategoryLabel(item.category)}</span>
                </td>
                <td>
                    <span class="status-badge ${escapeHtml(item.status)}">
                        ${item.status === 'published' ? '<span class="material-symbols-outlined">check_circle</span> เผยแพร่'
                            : item.status === 'draft' ? '<span class="material-symbols-outlined">edit_note</span> แบบร่าง'
                            : '<span class="material-symbols-outlined">archive</span> เก็บถาวร'}
                    </span>
                </td>
                <td>${formatDate(item.published_at || item.created_at)}</td>
                <td>${escapeHtml(item.created_by_name || '-')}</td>
                <td>
                    <div class="admin-announce-actions">
                        <button class="btn-edit" title="แก้ไข" onclick="AdminAnnouncements.openForm('${item.id}')">
                            <span class="material-symbols-outlined">edit</span>
                        </button>
                        <button class="btn-pin" title="${item.is_pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}" 
                                onclick="AdminAnnouncements.togglePin('${item.id}', ${!item.is_pinned})">
                            <span class="material-symbols-outlined">${item.is_pinned ? 'push_pin' : 'keep'}</span>
                        </button>
                        <button class="btn-delete" title="ลบ" onclick="AdminAnnouncements.confirmDelete('${item.id}')">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // ---- Form Operations ----
    function openForm(id) {
        editingId = id || null;
        const overlay = document.getElementById('announceFormOverlay');
        const titleEl = document.getElementById('formTitle');

        if (id) {
            const item = allAnnouncements.find(a => a.id === id);
            if (!item) return;

            titleEl.textContent = 'แก้ไขประกาศ';
            document.getElementById('formId').value = item.id;
            document.getElementById('formAnnounceTitle').value = item.title || '';
            document.getElementById('formCategory').value = item.category || 'general';
            document.getElementById('formContent').value = item.content || '';
            document.getElementById('formLink').value = item.external_link || '';
            document.getElementById('formPinned').checked = item.is_pinned || false;

            // Show existing cover
            const preview = document.getElementById('coverPreview');
            if (item.cover_image_url) {
                preview.src = item.cover_image_url;
                preview.classList.add('visible');
            } else {
                preview.classList.remove('visible');
            }
        } else {
            titleEl.textContent = 'สร้างประกาศใหม่';
            clearForm();
        }

        overlay.classList.add('active');
        overlay.onclick = (e) => {
            if (e.target === overlay) closeForm();
        };
        document.body.style.overflow = 'hidden';
    }

    function closeForm() {
        const overlay = document.getElementById('announceFormOverlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        editingId = null;
    }

    function clearForm() {
        document.getElementById('formId').value = '';
        document.getElementById('formAnnounceTitle').value = '';
        document.getElementById('formCategory').value = 'general';
        document.getElementById('formContent').value = '';
        document.getElementById('formLink').value = '';
        document.getElementById('formPinned').checked = false;
        document.getElementById('formCoverImage').value = '';
        document.getElementById('formAttachment').value = '';
        document.getElementById('coverPreview').classList.remove('visible');
    }

    function previewCover(input) {
        const preview = document.getElementById('coverPreview');
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                preview.src = e.target.result;
                preview.classList.add('visible');
            };
            reader.readAsDataURL(input.files[0]);
        }
    }

    // ---- Upload to Supabase Storage ----
    async function uploadFile(file, folder) {
        const sb = await getSupabase();
        const ext = file.name.split('.').pop();
        const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { data, error } = await sb.storage
            .from('announcements')
            .upload(fileName, file, { cacheControl: '3600', upsert: false });

        if (error) throw error;

        const { data: urlData } = sb.storage
            .from('announcements')
            .getPublicUrl(fileName);

        return urlData.publicUrl;
    }

    // ---- Save (Create / Update) ----
    async function save(status) {
        const title = document.getElementById('formAnnounceTitle').value.trim();
        if (!title) {
            showToast('กรุณาระบุหัวข้อประกาศ', 'warning');
            return;
        }

        try {
            const sb = await getSupabase();
            const coverFile = document.getElementById('formCoverImage').files[0];
            const attachFile = document.getElementById('formAttachment').files[0];

            let cover_image_url = editingId
                ? (allAnnouncements.find(a => a.id === editingId)?.cover_image_url || null)
                : null;
            let attachment_url = editingId
                ? (allAnnouncements.find(a => a.id === editingId)?.attachment_url || null)
                : null;
            let attachment_name = editingId
                ? (allAnnouncements.find(a => a.id === editingId)?.attachment_name || null)
                : null;

            // Upload cover if new
            if (coverFile) {
                cover_image_url = await uploadFile(coverFile, 'covers');
            }

            // Upload attachment if new
            if (attachFile) {
                attachment_url = await uploadFile(attachFile, 'attachments');
                attachment_name = attachFile.name;
            }

            const payload = {
                title,
                category: document.getElementById('formCategory').value,
                content: document.getElementById('formContent').value.trim(),
                external_link: document.getElementById('formLink').value.trim() || null,
                is_pinned: document.getElementById('formPinned').checked,
                cover_image_url,
                attachment_url,
                attachment_name,
                status,
                updated_at: new Date().toISOString(),
            };

            if (status === 'published' && !editingId) {
                payload.published_at = new Date().toISOString();
            }

            if (editingId) {
                // Update
                const existing = allAnnouncements.find(a => a.id === editingId);
                if (status === 'published' && existing?.status !== 'published') {
                    payload.published_at = new Date().toISOString();
                }

                const { error } = await sb
                    .from('announcements')
                    .update(payload)
                    .eq('id', editingId);

                if (error) throw error;
                showToast('อัปเดตประกาศสำเร็จ');
            } else {
                // Insert
                payload.created_by = currentUser?.id || null;
                payload.created_by_name = currentUser?.full_name || currentUser?.display_name || 'Admin';

                const { error } = await sb
                    .from('announcements')
                    .insert(payload);

                if (error) throw error;
                showToast(status === 'published' ? 'เผยแพร่ประกาศสำเร็จ' : 'บันทึกแบบร่างสำเร็จ');
            }

            closeForm();
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Save error:', err);
            showToast('บันทึกผิดพลาด: ' + (err.message || ''), 'error');
        }
    }

    // ---- Toggle Pin ----
    async function togglePin(id, pinState) {
        try {
            const sb = await getSupabase();
            const { error } = await sb
                .from('announcements')
                .update({ is_pinned: pinState, updated_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            showToast(pinState ? 'ปักหมุดประกาศแล้ว' : 'เลิกปักหมุดแล้ว');
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Pin toggle error:', err);
            showToast('ผิดพลาด', 'error');
        }
    }

    // ---- Delete ----
    function confirmDelete(id) {
        const item = allAnnouncements.find(a => a.id === id);
        if (!item) return;

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-box">
                <span class="material-symbols-outlined">warning</span>
                <h3>ลบประกาศนี้?</h3>
                <p>"${escapeHtml(item.title)}"<br>การลบจะไม่สามารถกู้คืนได้</p>
                <div class="confirm-buttons">
                    <button class="btn-cancel" onclick="this.closest('.confirm-overlay').remove()">ยกเลิก</button>
                    <button class="btn-danger" id="confirmDeleteBtn">ลบประกาศ</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('confirmDeleteBtn').onclick = async () => {
            overlay.remove();
            await deleteAnnouncement(id);
        };
    }

    async function deleteAnnouncement(id) {
        try {
            const sb = await getSupabase();
            const { error } = await sb
                .from('announcements')
                .delete()
                .eq('id', id);

            if (error) throw error;
            showToast('ลบประกาศสำเร็จ');
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Delete error:', err);
            showToast('ลบผิดพลาด', 'error');
        }
    }

    // ---- Filter & Search ----
    function setupFilterButtons() {
        document.querySelectorAll('.admin-announce-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.admin-announce-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                render();
            });
        });
    }

    function setupSearch() {
        const input = document.getElementById('searchInput');
        if (!input) return;

        let timeout;
        input.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                searchQuery = input.value.trim();
                render();
            }, 300);
        });
    }

    // ---- Init ----
    async function init() {
        currentUser = window.currentUser;
        setupFilterButtons();
        setupSearch();
        await fetchAll();

        // Keyboard: ESC to close form
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeForm();
        });
    }

    // Auto-init when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Wait for auth to finish, then init
            // protectPage(['admin', 'adminQc', 'manager']).then(() => init());
            init(); // or call after auth
        });
    } else {
        init();
    }

    // ---- Public API ----
    return {
        openForm,
        closeForm,
        save,
        togglePin,
        confirmDelete,
        previewCover,
        refresh: fetchAll,
    };
})();