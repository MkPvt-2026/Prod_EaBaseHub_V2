/* =============================================
   EABaseHub: Admin Announcements Management
   File: /js/pages/Adminannouncements.js
   
   Dependencies: supabaseClient.js, userService.js, auth.js
   ============================================= */

const AdminAnnouncements = (() => {
    'use strict';

    // ---- Configuration ----
    const CONFIG = {
        MAX_COVER_SIZE: 5 * 1024 * 1024,      // 5MB
        MAX_ATTACHMENT_SIZE: 10 * 1024 * 1024, // 10MB
        ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
        DEBOUNCE_DELAY: 300,
        TOAST_DURATION: 3000,
    };

    // ---- State ----
    let allAnnouncements = [];
    let currentFilter = 'all';
    let searchQuery = '';
    let editingId = null;
    let currentUser = null;
    let isLoading = false;
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
        const validCategories = ['general', 'important', 'update', 'event'];
        return validCategories.includes(cat) ? cat : 'general';
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async function getSupabase() {
        if (window.supabaseClient) return window.supabaseClient;
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 50; // 5 seconds timeout
            const interval = setInterval(() => {
                attempts++;
                if (window.supabaseClient) {
                    clearInterval(interval);
                    resolve(window.supabaseClient);
                } else if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    reject(new Error('Supabase client not available'));
                }
            }, 100);
        });
    }

    // ---- Toast System ----
    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer') || createToastContainer();
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: 'check_circle',
            error: 'error',
            warning: 'warning',
        };

        toast.innerHTML = `
            <span class="material-symbols-outlined toast-icon">${icons[type] || 'info'}</span>
            <span class="toast-message">${escapeHtml(message)}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <span class="material-symbols-outlined">close</span>
            </button>
        `;
        
        container.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, CONFIG.TOAST_DURATION);
    }

    function createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
        return container;
    }

    // ---- Loading States ----
    function setPageLoading(loading) {
        isLoading = loading;
        const loadingEl = document.getElementById('announceLoading');
        const tableWrap = document.getElementById('announceTableWrap');
        
        if (loadingEl) loadingEl.style.display = loading ? 'flex' : 'none';
        if (tableWrap) tableWrap.style.display = loading ? 'none' : 'block';
    }

    function setSaveLoading(loading, buttonType = 'both') {
        isSaving = loading;
        const btnDraft = document.getElementById('btnDraft');
        const btnPublish = document.getElementById('btnPublish');
        
        const buttons = buttonType === 'both' ? [btnDraft, btnPublish] : 
                        buttonType === 'draft' ? [btnDraft] : [btnPublish];
        
        buttons.forEach(btn => {
            if (!btn) return;
            btn.disabled = loading;
            const textEl = btn.querySelector('.btn-text');
            const loadingEl = btn.querySelector('.btn-loading');
            if (textEl) textEl.style.display = loading ? 'none' : 'inline';
            if (loadingEl) loadingEl.style.display = loading ? 'inline-flex' : 'none';
        });

        // Disable other form elements
        const formElements = document.querySelectorAll('.announce-form-body input, .announce-form-body textarea, .announce-form-body select');
        formElements.forEach(el => el.disabled = loading);
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
            showToast('โหลดข้อมูลผิดพลาด: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setPageLoading(false);
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
                (a.content || '').toLowerCase().includes(q) ||
                (a.created_by_name || '').toLowerCase().includes(q)
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
            const hasMoreContent = (item.content || '').length > 60;
            const categoryClass = getCategoryClass(item.category);
            const categoryLabel = getCategoryLabel(item.category);
            const safeCreator = escapeHtml(item.created_by_name || '-');
            
            let statusHtml = '';
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
                    statusHtml = escapeHtml(item.status || 'ไม่ระบุ');
            }

            return `
                <tr data-id="${safeId}">
                    <td>
                        ${item.is_pinned
                            ? '<span class="material-symbols-outlined pin-indicator" title="ปักหมุด">push_pin</span>'
                            : ''}
                    </td>
                    <td class="td-title">
                        <span>${safeTitle}</span>
                        <small>${safeContent}${hasMoreContent ? '...' : ''}</small>
                    </td>
                    <td>
                        <span class="announce-category category-${categoryClass}">${categoryLabel}</span>
                    </td>
                    <td>
                        <span class="status-badge status-${escapeHtml(item.status || 'unknown')}">
                            ${statusHtml}
                        </span>
                    </td>
                    <td>${formatDate(item.published_at || item.created_at)}</td>
                    <td>${safeCreator}</td>
                    <td>
                        <div class="admin-announce-actions">
                            <button class="btn-edit" title="แก้ไข" onclick="AdminAnnouncements.openForm('${safeId}')" type="button">
                                <span class="material-symbols-outlined">edit</span>
                            </button>
                            <button class="btn-pin" title="${item.is_pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}" 
                                    onclick="AdminAnnouncements.togglePin('${safeId}', ${!item.is_pinned})" type="button">
                                <span class="material-symbols-outlined">${item.is_pinned ? 'push_pin' : 'keep'}</span>
                            </button>
                            <button class="btn-archive" title="${item.status === 'archived' ? 'ยกเลิกเก็บถาวร' : 'เก็บถาวร'}"
                                    onclick="AdminAnnouncements.toggleArchive('${safeId}')" type="button">
                                <span class="material-symbols-outlined">${item.status === 'archived' ? 'unarchive' : 'archive'}</span>
                            </button>
                            <button class="btn-delete" title="ลบ" onclick="AdminAnnouncements.confirmDelete('${safeId}')" type="button">
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
                showToast('ไม่พบประกาศที่ต้องการแก้ไข', 'error');
                return;
            }

            titleEl.textContent = 'แก้ไขประกาศ';
            document.getElementById('formId').value = item.id;
            document.getElementById('formAnnounceTitle').value = item.title || '';
            document.getElementById('formCategory').value = item.category || 'general';
            document.getElementById('formContent').value = item.content || '';
            document.getElementById('formLink').value = item.external_link || '';
            document.getElementById('formPinned').checked = item.is_pinned || false;

            // Update character counts
            updateCharCount('formAnnounceTitle', 'titleCharCount', 200);
            updateCharCount('formContent', 'contentCharCount', 5000);

            // Show existing cover
            const previewWrap = document.getElementById('coverPreviewWrap');
            const preview = document.getElementById('coverPreview');
            if (item.cover_image_url) {
                preview.src = item.cover_image_url;
                previewWrap.classList.add('visible');
            } else {
                previewWrap.classList.remove('visible');
            }

            // Show existing attachment info
            const attachmentInfo = document.getElementById('attachmentInfo');
            if (item.attachment_name) {
                attachmentInfo.innerHTML = `
                    <span class="material-symbols-outlined">attach_file</span>
                    <span>${escapeHtml(item.attachment_name)}</span>
                `;
                attachmentInfo.classList.add('visible');
            } else {
                attachmentInfo.classList.remove('visible');
            }
        } else {
            titleEl.textContent = 'สร้างประกาศใหม่';
            clearForm();
        }

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Focus on title input
        setTimeout(() => {
            document.getElementById('formAnnounceTitle')?.focus();
        }, 300);
    }

    function closeForm() {
        if (isSaving) return;
        
        const overlay = document.getElementById('announceFormOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
        document.body.style.overflow = '';
        editingId = null;
    }

    function clearForm() {
        const fields = ['formId', 'formAnnounceTitle', 'formContent', 'formLink'];
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const categoryEl = document.getElementById('formCategory');
        if (categoryEl) categoryEl.value = 'general';

        const pinnedEl = document.getElementById('formPinned');
        if (pinnedEl) pinnedEl.checked = false;

        const coverInput = document.getElementById('formCoverImage');
        if (coverInput) coverInput.value = '';

        const attachmentInput = document.getElementById('formAttachment');
        if (attachmentInput) attachmentInput.value = '';

        const previewWrap = document.getElementById('coverPreviewWrap');
        if (previewWrap) previewWrap.classList.remove('visible');

        const attachmentInfo = document.getElementById('attachmentInfo');
        if (attachmentInfo) attachmentInfo.classList.remove('visible');

        // Reset character counts
        updateCharCount('formAnnounceTitle', 'titleCharCount', 200);
        updateCharCount('formContent', 'contentCharCount', 5000);
    }

    function updateCharCount(inputId, counterId, max) {
        const input = document.getElementById(inputId);
        const counter = document.getElementById(counterId);
        if (input && counter) {
            const length = input.value.length;
            counter.textContent = length;
            counter.parentElement.classList.toggle('near-limit', length > max * 0.9);
            counter.parentElement.classList.toggle('at-limit', length >= max);
        }
    }

    // ---- File Handling ----
    function previewCover(input) {
        const previewWrap = document.getElementById('coverPreviewWrap');
        const preview = document.getElementById('coverPreview');
        
        if (!input.files || !input.files[0]) return;
        
        const file = input.files[0];

        // Validate file type
        if (!CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) {
            showToast('รองรับเฉพาะไฟล์ JPG, PNG, WebP เท่านั้น', 'warning');
            input.value = '';
            return;
        }

        // Validate file size
        if (file.size > CONFIG.MAX_COVER_SIZE) {
            showToast(`ไฟล์ใหญ่เกินไป (สูงสุด ${formatFileSize(CONFIG.MAX_COVER_SIZE)})`, 'warning');
            input.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            previewWrap.classList.add('visible');
        };
        reader.onerror = () => {
            showToast('ไม่สามารถอ่านไฟล์ได้', 'error');
        };
        reader.readAsDataURL(file);
    }

    function removeCover() {
        const input = document.getElementById('formCoverImage');
        const previewWrap = document.getElementById('coverPreviewWrap');
        
        if (input) input.value = '';
        if (previewWrap) previewWrap.classList.remove('visible');
    }

    function validateAttachment() {
        const input = document.getElementById('formAttachment');
        const attachmentInfo = document.getElementById('attachmentInfo');
        
        if (!input || !input.files || !input.files[0]) return true;

        const file = input.files[0];

        if (file.size > CONFIG.MAX_ATTACHMENT_SIZE) {
            showToast(`ไฟล์แนบใหญ่เกินไป (สูงสุด ${formatFileSize(CONFIG.MAX_ATTACHMENT_SIZE)})`, 'warning');
            input.value = '';
            return false;
        }

        // Show file info
        if (attachmentInfo) {
            attachmentInfo.innerHTML = `
                <span class="material-symbols-outlined">attach_file</span>
                <span>${escapeHtml(file.name)} (${formatFileSize(file.size)})</span>
            `;
            attachmentInfo.classList.add('visible');
        }

        return true;
    }

    // ---- Upload to Supabase Storage ----
    async function uploadFile(file, folder) {
        const sb = await getSupabase();
        const ext = file.name.split('.').pop().toLowerCase();
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).slice(2, 10);
        const fileName = `${folder}/${timestamp}_${randomStr}.${ext}`;

        const { data, error } = await sb.storage
            .from('announcements')
            .upload(fileName, file, { 
                cacheControl: '3600', 
                upsert: false 
            });

        if (error) throw error;

        const { data: urlData } = sb.storage
            .from('announcements')
            .getPublicUrl(fileName);

        return urlData.publicUrl;
    }

    // ---- Save (Create / Update) ----
    async function save(status) {
        if (isSaving) return;

        const title = document.getElementById('formAnnounceTitle')?.value.trim();
        if (!title) {
            showToast('กรุณาระบุหัวข้อประกาศ', 'warning');
            document.getElementById('formAnnounceTitle')?.focus();
            return;
        }

        // Validate URL if provided
        const linkValue = document.getElementById('formLink')?.value.trim();
        if (linkValue && !isValidUrl(linkValue)) {
            showToast('รูปแบบ URL ไม่ถูกต้อง', 'warning');
            document.getElementById('formLink')?.focus();
            return;
        }

        // Validate attachment
        if (!validateAttachment()) return;

        const buttonType = status === 'draft' ? 'draft' : 'publish';
        setSaveLoading(true, buttonType);

        try {
            const sb = await getSupabase();
            const coverFile = document.getElementById('formCoverImage')?.files[0];
            const attachFile = document.getElementById('formAttachment')?.files[0];

            // Get existing values if editing
            const existingItem = editingId 
                ? allAnnouncements.find(a => a.id === editingId) 
                : null;

            let cover_image_url = existingItem?.cover_image_url || null;
            let attachment_url = existingItem?.attachment_url || null;
            let attachment_name = existingItem?.attachment_name || null;

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
                category: document.getElementById('formCategory')?.value || 'general',
                content: document.getElementById('formContent')?.value.trim() || '',
                external_link: linkValue || null,
                is_pinned: document.getElementById('formPinned')?.checked || false,
                cover_image_url,
                attachment_url,
                attachment_name,
                status,
                updated_at: new Date().toISOString(),
            };

            if (editingId) {
                // Update existing
                if (status === 'published' && existingItem?.status !== 'published') {
                    payload.published_at = new Date().toISOString();
                }

                const { error } = await sb
                    .from('announcements')
                    .update(payload)
                    .eq('id', editingId);

                if (error) throw error;
                showToast('อัปเดตประกาศสำเร็จ');
            } else {
                // Create new
                if (status === 'published') {
                    payload.published_at = new Date().toISOString();
                }
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
            showToast('บันทึกผิดพลาด: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setSaveLoading(false, buttonType);
        }
    }

    function isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    }

    // ---- Toggle Pin ----
    async function togglePin(id, pinState) {
        try {
            const sb = await getSupabase();
            const { error } = await sb
                .from('announcements')
                .update({ 
                    is_pinned: pinState, 
                    updated_at: new Date().toISOString() 
                })
                .eq('id', id);

            if (error) throw error;
            showToast(pinState ? 'ปักหมุดประกาศแล้ว' : 'เลิกปักหมุดแล้ว');
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Pin toggle error:', err);
            showToast('เกิดข้อผิดพลาด', 'error');
        }
    }

    // ---- Toggle Archive ----
    async function toggleArchive(id) {
        const item = allAnnouncements.find(a => a.id === id);
        if (!item) return;

        const newStatus = item.status === 'archived' ? 'draft' : 'archived';

        try {
            const sb = await getSupabase();
            const { error } = await sb
                .from('announcements')
                .update({ 
                    status: newStatus, 
                    updated_at: new Date().toISOString() 
                })
                .eq('id', id);

            if (error) throw error;
            showToast(newStatus === 'archived' ? 'เก็บถาวรประกาศแล้ว' : 'ยกเลิกเก็บถาวรแล้ว');
            await fetchAll();
        } catch (err) {
            console.error('[AdminAnnouncements] Archive toggle error:', err);
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
                    <button class="btn-cancel" type="button">ยกเลิก</button>
                    <button class="btn-danger" type="button">ลบประกาศ</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Event listeners
        const cancelBtn = overlay.querySelector('.btn-cancel');
        const deleteBtn = overlay.querySelector('.btn-danger');

        cancelBtn.onclick = () => overlay.remove();
        deleteBtn.onclick = async () => {
            overlay.remove();
            await deleteAnnouncement(id);
        };

        // Click outside to close
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };

        // ESC to close
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
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

        const debouncedSearch = debounce((value) => {
            searchQuery = value.trim();
            render();
        }, CONFIG.DEBOUNCE_DELAY);

        input.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });
    }

    function setupFormEvents() {
        // Character count for title
        const titleInput = document.getElementById('formAnnounceTitle');
        if (titleInput) {
            titleInput.addEventListener('input', () => {
                updateCharCount('formAnnounceTitle', 'titleCharCount', 200);
            });
        }

        // Character count for content
        const contentInput = document.getElementById('formContent');
        if (contentInput) {
            contentInput.addEventListener('input', () => {
                updateCharCount('formContent', 'contentCharCount', 5000);
            });
        }

        // Attachment validation
        const attachmentInput = document.getElementById('formAttachment');
        if (attachmentInput) {
            attachmentInput.addEventListener('change', validateAttachment);
        }

        // URL validation hint
        const linkInput = document.getElementById('formLink');
        const linkHint = document.getElementById('linkHint');
        if (linkInput && linkHint) {
            linkInput.addEventListener('blur', () => {
                const value = linkInput.value.trim();
                if (value && !isValidUrl(value)) {
                    linkHint.textContent = 'รูปแบบ URL ไม่ถูกต้อง';
                    linkHint.classList.add('error');
                } else {
                    linkHint.textContent = '';
                    linkHint.classList.remove('error');
                }
            });
        }

        // Click outside modal to close
        const overlay = document.getElementById('announceFormOverlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay && !isSaving) {
                    closeForm();
                }
            });
        }
    }

    // ---- Init ----
    async function init() {
        try {
            // Wait for auth if available
            if (typeof protectPage === 'function') {
                await protectPage(['admin', 'adminQc', 'manager']);
            }

            currentUser = window.currentUser || null;
            
            setupFilterButtons();
            setupSearch();
            setupFormEvents();
            
            await fetchAll();

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !isSaving) {
                    closeForm();
                }
            });

            console.log('[AdminAnnouncements] Initialized successfully');
        } catch (err) {
            console.error('[AdminAnnouncements] Init error:', err);
            showToast('เกิดข้อผิดพลาดในการโหลดหน้า', 'error');
        }
    }

    // Auto-init when DOM ready
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
        toggleArchive,
        confirmDelete,
        previewCover,
        removeCover,
        refresh: fetchAll,
    };
})();