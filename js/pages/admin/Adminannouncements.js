/* =============================================
   EABaseHub: Admin Announcements Management
   File: /js/pages/admin/Adminannouncements.js
   
   Dependencies: supabaseClient.js, userService.js, auth.js
   ============================================= */

const AdminAnnouncements = (() => {
    'use strict';

    // ---- State ----
    let allAnnouncements = [];
    let currentFilter = 'all';
    let searchQuery = '';
    let editingId = null;
    let currentUser = null;
    let isSaving = false;

    // ---- Helpers ----
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '-';
            const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                            'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
            return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
        } catch {
            return '-';
        }
    }

    function getCategoryLabel(cat) {
        const map = { 
            general: 'ทั่วไป', 
            important: 'สำคัญ', 
            update: 'อัปเดต', 
            event: 'กิจกรรม' 
        };
        return map[cat] || 'ทั่วไป';
    }

    function getCategoryClass(cat) {
        const valid = ['general', 'important', 'update', 'event'];
        return valid.includes(cat) ? cat : 'general';
    }

    async function getSupabase() {
        if (window.supabaseClient) return window.supabaseClient;
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (window.supabaseClient) {
                    clearInterval(interval);
                    resolve(window.supabaseClient);
                } else if (attempts >= 50) {
                    clearInterval(interval);
                    reject(new Error('Supabase not available'));
                }
            }, 100);
        });
    }

    // ---- Toast System ----
    function showToast(message, type = 'success') {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            document.body.appendChild(container);
        }

        const icons = {
            success: 'check_circle',
            error: 'error',
            warning: 'warning'
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="material-symbols-outlined">${icons[type] || 'info'}</span>
            <span>${escapeHtml(message)}</span>
        `;
        container.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ---- Loading States ----
    function setPageLoading(loading) {
        const loadingEl = document.getElementById('announceLoading');
        const tableWrap = document.getElementById('announceTableWrap');
        if (loadingEl) loadingEl.style.display = loading ? 'flex' : 'none';
        if (tableWrap) tableWrap.style.display = loading ? 'none' : 'block';
    }

    function setSaveLoading(loading) {
        isSaving = loading;
        const btnDraft = document.getElementById('btnDraft');
        const btnPublish = document.getElementById('btnPublish');
        
        if (btnDraft) btnDraft.disabled = loading;
        if (btnPublish) btnPublish.disabled = loading;
        
        if (btnPublish) {
            btnPublish.innerHTML = loading 
                ? '<span class="loading-spinner-small"></span> กำลังบันทึก...'
                : 'เผยแพร่ประกาศ';
        }
    }

    // ---- Fetch & Render ----
    async function fetchAll() {
        setPageLoading(true);
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
            showToast('โหลดข้อมูลผิดพลาด: ' + (err.message || ''), 'error');
        } finally {
            setPageLoading(false);
        }
    }

    function getFiltered() {
        let filtered = [...allAnnouncements];
        if (currentFilter !== 'all') {
            filtered = filtered.filter(a => a.status === currentFilter);
        }
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

        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (empty) empty.style.display = 'none';
        
        tbody.innerHTML = filtered.map(item => {
            const safeId = escapeHtml(item.id);
            const safeTitle = escapeHtml(item.title || 'ไม่มีหัวข้อ');
            const safeContent = escapeHtml((item.content || '').substring(0, 60));
            const hasMore = (item.content || '').length > 60;
            const catClass = getCategoryClass(item.category);
            const catLabel = getCategoryLabel(item.category);
            const safeCreator = escapeHtml(item.created_by_name || '-');
            
            let statusHtml = '';
            const statusClass = item.status || 'unknown';
            switch (item.status) {
                case 'published':
                    statusHtml = '<span class="material-symbols-outlined">check_circle</span> เผยแพร่';
                    break;
                case 'draft':
                    statusHtml = '<span class="material-symbols-outlined">edit_note</span> แบบร่าง';
                    break;
                case 'archived':
                    statusHtml = '<span class="material-symbols-outlined">archive</span> เก็บถาวร';
                    break;
                default:
                    statusHtml = 'ไม่ระบุ';
            }

            return `
                <tr>
                    <td>
                        ${item.is_pinned ? '<span class="material-symbols-outlined pin-indicator">push_pin</span>' : ''}
                    </td>
                    <td class="td-title">
                        <span>${safeTitle}</span>
                        <small>${safeContent}${hasMore ? '...' : ''}</small>
                    </td>
                    <td>
                        <span class="announce-category category-${catClass}">${catLabel}</span>
                    </td>
                    <td>
                        <span class="status-badge status-${statusClass}">${statusHtml}</span>
                    </td>
                    <td>${formatDate(item.published_at || item.created_at)}</td>
                    <td>${safeCreator}</td>
                    <td>
                        <div class="admin-announce-actions">
                            <button class="btn-edit" title="แก้ไข" onclick="AdminAnnouncements.openForm('${safeId}')">
                                <span class="material-symbols-outlined">edit</span>
                            </button>
                            <button class="btn-pin" title="${item.is_pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}" 
                                    onclick="AdminAnnouncements.togglePin('${safeId}', ${!item.is_pinned})">
                                <span class="material-symbols-outlined">${item.is_pinned ? 'push_pin' : 'keep'}</span>
                            </button>
                            <button class="btn-delete" title="ลบ" onclick="AdminAnnouncements.confirmDelete('${safeId}')">
                                <span class="material-symbols-outlined">delete</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ---- Form Operations ----
    function openForm(id) {
        if (isSaving) return;
        
        editingId = id || null;
        const overlay = document.getElementById('announceFormOverlay');
        const titleEl = document.getElementById('formTitle');

        if (!overlay) return;

        if (id) {
            const item = allAnnouncements.find(a => a.id === id);
            if (!item) {
                showToast('ไม่พบประกาศ', 'error');
                return;
            }

            titleEl.textContent = 'แก้ไขประกาศ';
            document.getElementById('formId').value = item.id;
            document.getElementById('formAnnounceTitle').value = item.title || '';
            document.getElementById('formCategory').value = item.category || 'general';
            document.getElementById('formContent').value = item.content || '';
            document.getElementById('formLink').value = item.external_link || '';
            document.getElementById('formPinned').checked = item.is_pinned || false;

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
        document.body.style.overflow = 'hidden';
        
        // Focus on title
        setTimeout(() => {
            document.getElementById('formAnnounceTitle')?.focus();
        }, 300);
    }

    function closeForm() {
        if (isSaving) return;
        
        const overlay = document.getElementById('announceFormOverlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
        editingId = null;
    }

    function clearForm() {
        ['formId', 'formAnnounceTitle', 'formContent', 'formLink'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const cat = document.getElementById('formCategory');
        if (cat) cat.value = 'general';
        const pin = document.getElementById('formPinned');
        if (pin) pin.checked = false;
        const cover = document.getElementById('formCoverImage');
        if (cover) cover.value = '';
        const attach = document.getElementById('formAttachment');
        if (attach) attach.value = '';
        const preview = document.getElementById('coverPreview');
        if (preview) preview.classList.remove('visible');
    }

    function previewCover(input) {
        const preview = document.getElementById('coverPreview');
        if (input.files && input.files[0]) {
            const file = input.files[0];
            
            // Validate file size (5MB)
            if (file.size > 5 * 1024 * 1024) {
                showToast('ไฟล์ใหญ่เกินไป (สูงสุด 5MB)', 'warning');
                input.value = '';
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                preview.src = e.target.result;
                preview.classList.add('visible');
            };
            reader.readAsDataURL(file);
        }
    }

    // ---- Upload ----
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

    // ---- Save ----
    async function save(status) {
        if (isSaving) return;
        
        const title = document.getElementById('formAnnounceTitle')?.value.trim();
        if (!title) {
            showToast('กรุณาระบุหัวข้อประกาศ', 'warning');
            document.getElementById('formAnnounceTitle')?.focus();
            return;
        }

        setSaveLoading(true);

        try {
            const sb = await getSupabase();
            const coverFile = document.getElementById('formCoverImage')?.files[0];
            const attachFile = document.getElementById('formAttachment')?.files[0];

            const existing = editingId ? allAnnouncements.find(a => a.id === editingId) : null;

            let cover_image_url = existing?.cover_image_url || null;
            let attachment_url = existing?.attachment_url || null;
            let attachment_name = existing?.attachment_name || null;

            // Upload cover if new
            if (coverFile) {
                console.log('📤 Uploading cover image...');
                cover_image_url = await uploadFile(coverFile, 'covers');
                console.log('✅ Cover uploaded:', cover_image_url);
            }
            
            // Upload attachment if new
            if (attachFile) {
                console.log('📤 Uploading attachment...');
                attachment_url = await uploadFile(attachFile, 'attachments');
                attachment_name = attachFile.name;
                console.log('✅ Attachment uploaded:', attachment_url);
            }

            const payload = {
                title,
                category: document.getElementById('formCategory')?.value || 'general',
                content: document.getElementById('formContent')?.value.trim() || '',
                external_link: document.getElementById('formLink')?.value.trim() || null,
                is_pinned: document.getElementById('formPinned')?.checked || false,
                cover_image_url,
                attachment_url,
                attachment_name,
                status,
                updated_at: new Date().toISOString(),
            };

            console.log('📝 Saving payload:', payload);

            if (editingId) {
                // Update existing
                if (status === 'published' && existing?.status !== 'published') {
                    payload.published_at = new Date().toISOString();
                }
                const { error } = await sb.from('announcements').update(payload).eq('id', editingId);
                if (error) throw error;
                showToast('อัปเดตประกาศสำเร็จ');
            } else {
                // Create new
                if (status === 'published') {
                    payload.published_at = new Date().toISOString();
                }
                payload.created_by = currentUser?.id || null;
                payload.created_by_name = currentUser?.full_name || currentUser?.display_name || 'Admin';
                
                const { error } = await sb.from('announcements').insert(payload);
                if (error) throw error;
                showToast(status === 'published' ? 'เผยแพร่ประกาศสำเร็จ' : 'บันทึกแบบร่างสำเร็จ');
            }

            closeForm();
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Save error:', err);
            showToast('บันทึกผิดพลาด: ' + (err.message || ''), 'error');
        } finally {
            setSaveLoading(false);
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
            showToast(pinState ? 'ปักหมุดแล้ว' : 'เลิกปักหมุดแล้ว');
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Pin error:', err);
            showToast('เกิดข้อผิดพลาด', 'error');
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
                    <button class="btn-cancel">ยกเลิก</button>
                    <button class="btn-danger">ลบประกาศ</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Event listeners
        overlay.querySelector('.btn-cancel').onclick = () => overlay.remove();
        overlay.querySelector('.btn-danger').onclick = async () => {
            overlay.remove();
            await deleteAnnouncement(id);
        };
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };
    }

    async function deleteAnnouncement(id) {
        try {
            const sb = await getSupabase();
            const { error } = await sb.from('announcements').delete().eq('id', id);
            if (error) throw error;
            showToast('ลบประกาศสำเร็จ');
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Delete error:', err);
            showToast('ลบผิดพลาด: ' + (err.message || ''), 'error');
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
        try {
            console.log('🚀 AdminAnnouncements initializing...');
            
            // Get current user
            currentUser = window.currentUser || null;
            
            setupFilterButtons();
            setupSearch();
            
            // Keyboard: ESC to close
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !isSaving) closeForm();
            });

            // Click outside modal
            const overlay = document.getElementById('announceFormOverlay');
            if (overlay) {
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay && !isSaving) closeForm();
                });
            }

            await fetchAll();
            console.log('✅ AdminAnnouncements initialized');
        } catch (err) {
            console.error('[AdminAnnouncements] Init error:', err);
            showToast('เกิดข้อผิดพลาดในการโหลดหน้า', 'error');
        }
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
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