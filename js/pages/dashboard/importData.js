// importData.js — v2 แก้ regex ให้จับเซลล์ได้ทุกรูปแบบ

// Global Variables
let transformedData = null;
let filteredData = null;
let fileName = null;
let reportDate = null;
let visibleColumns = new Set();

// ========================================
// Initialization
// ========================================

(async function init() {
    try {
        console.log('🚀 Starting initialization...');
        
        if (typeof window.supabaseClient === 'undefined') {
            let attempts = 0;
            while (typeof window.supabaseClient === 'undefined' && attempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }
        }
        
        if (window.supabaseClient) {
            console.log('✅ Supabase client ready');
        }
        
        if (typeof protectPage === 'function') {
            await protectPage(['admin', 'manager']);
            let userAttempts = 0;
            while (!window.currentUser && userAttempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                userAttempts++;
            }
        }
        
        initUpload();
        console.log('✅ System ready!');
        
    } catch (error) {
        console.error('❌ Init error:', error);
        initUpload();
    }
})();

// ========================================
// Event Listeners Setup
// ========================================

function initUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    if (!uploadArea || !fileInput) {
        showAlert('ไม่พบองค์ประกอบสำหรับอัพโหลด กรุณารีเฟรชหน้า', 'error');
        return;
    }

    uploadArea.addEventListener('click', () => fileInput.click());
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    const exportBtn = document.getElementById('exportBtn');
    const clearBtn = document.getElementById('clearBtn');
    const clearFilterBtn = document.getElementById('clearFilterBtn');
    const importToSupabaseBtn = document.getElementById('importToSupabaseBtn');

    if (exportBtn) exportBtn.addEventListener('click', exportCSV);
    if (clearBtn) clearBtn.addEventListener('click', clearData);
    if (clearFilterBtn) clearFilterBtn.addEventListener('click', clearFilters);
    if (importToSupabaseBtn) importToSupabaseBtn.addEventListener('click', importToSupabase);

    const filterSales = document.getElementById('filterSales');
    const filterCustomer = document.getElementById('filterCustomer');
    const searchProduct = document.getElementById('searchProduct');

    if (filterSales) filterSales.addEventListener('change', applyFilters);
    if (filterCustomer) filterCustomer.addEventListener('change', applyFilters);
    if (searchProduct) searchProduct.addEventListener('input', applyFilters);
}

// ========================================
// File Handling
// ========================================

async function handleFile(file) {
    if (!file) {
        showAlert('ไม่ได้เลือกไฟล์', 'error');
        return;
    }

    fileName = file.name;
    showAlert('กำลังอ่านไฟล์...', 'info');
    showProcessLog('info', '📂 เปิดไฟล์: ' + fileName);

    try {
        let rawData = null;

        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            rawData = await readExcel(file);
        } else if (file.name.endsWith('.csv')) {
            rawData = await readCSV(file);
        } else {
            throw new Error('รองรับเฉพาะไฟล์ .xlsx, .xls หรือ .csv');
        }

        showProcessLog('success', '✅ อ่านไฟล์สำเร็จ: ' + rawData.length + ' แถว');

        reportDate = extractReportDate(rawData);

        transformedData = transformSalesReport(rawData);

        if (transformedData.length === 0) {
            throw new Error('ไม่พบข้อมูลที่สามารถแปลงได้');
        }

        showProcessLog('success', '✅ แปลงข้อมูลสำเร็จ: ' + transformedData.length + ' รายการ');

        visibleColumns = new Set(Object.keys(transformedData[0]));

        initFilters();
        filteredData = [...transformedData];
        
        showPreview();
        showAlert('✅ ประมวลผลสำเร็จ!', 'success');

    } catch (error) {
        console.error('❌ Process error:', error);
        showProcessLog('error', '❌ ข้อผิดพลาด: ' + error.message);
        showAlert('❌ เกิดข้อผิดพลาด: ' + error.message, 'error');
    }
}

// ========================================
// File Readers
// ========================================

async function readExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
                resolve(rows);
            } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

async function readCSV(file) {
    return new Promise(async (resolve, reject) => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let text = null;

            for (const encoding of ['utf-8', 'iso-8859-11', 'tis-620', 'windows-874']) {
                try {
                    const decoder = new TextDecoder(encoding);
                    text = decoder.decode(uint8Array);
                    text = text.replace(/^\ufeff/, '').replace(/^\uFEFF/, '');
                    if (!text.includes('�') && text.length > 50) break;
                } catch (e) { /* try next */ }
            }

            if (!text) throw new Error('ไม่สามารถอ่านไฟล์ได้');

            Papa.parse(text, {
                complete: (results) => resolve(results.data),
                error: reject
            });
        } catch (err) { reject(err); }
    });
}

// ========================================
// Data Transformation
// ========================================

function extractReportDate(rows) {
    for (let i = 0; i < Math.min(10, rows.length); i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        
        for (let colIndex = 0; colIndex < Math.min(5, row.length); colIndex++) {
            const cellValue = String(row[colIndex] || '').trim();
            
            if (cellValue.includes('วันที่:') || cellValue.includes('วันที่ :')) continue;
            
            const dateMatch = cellValue.match(/(\d{1,2})\s*([ก-ฮ]\s*\.?\s*[ก-ฮ]\s*\.?)\s*(\d{4})/);
            
            if (dateMatch) {
                const day = dateMatch[1].padStart(2, '0');
                const thaiMonth = dateMatch[2].replace(/\s/g, '').replace(/\./g, '');
                const buddhistYear = dateMatch[3];
                const yearInt = parseInt(buddhistYear);
                if (yearInt < 2500 || yearInt > 2600) continue;
                
                const monthMap = {
                    'มค': '01', 'กพ': '02', 'มีค': '03', 'เมย': '04',
                    'พค': '05', 'มิย': '06', 'กค': '07', 'สค': '08',
                    'กย': '09', 'ตค': '10', 'พย': '11', 'ธค': '12',
                    'มกราคม': '01', 'กุมภาพันธ์': '02', 'มีนาคม': '03',
                    'เมษายน': '04', 'พฤษภาคม': '05', 'มิถุนายน': '06',
                    'กรกฎาคม': '07', 'สิงหาคม': '08', 'กันยายน': '09',
                    'ตุลาคม': '10', 'พฤศจิกายน': '11', 'ธันวาคม': '12'
                };
                
                const month = monthMap[thaiMonth];
                if (!month) continue;
                
                const year = String(yearInt - 543);
                const reportDate = `${year}-${month}-${day}`;
                showProcessLog('success', `📅 วันที่ของข้อมูล: ${day}/${month}/${year}`);
                return reportDate;
            }
        }
    }
    
    const today = new Date().toISOString().split('T')[0];
    showProcessLog('warning', `⚠️ ไม่พบวันที่ในไฟล์ ใช้วันที่ปัจจุบัน: ${today}`);
    return today;
}

function cleanCellName(name) {
    if (!name) return name;
    return name
        .replace(/^รวมยอดของ\s+/g, '')
        .replace(/^ยอดรวมของ\s+/g, '')
        .replace(/^รวมของ\s+/g, '')
        .replace(/^ของ\s+/g, '')
        .trim();
}

/**
 * ✅ ฟังก์ชัน normalize — แปลง non-breaking space, ZWSP, และ special chars เป็นช่องว่างปกติ
 * ⚠️ ไม่ trim เพื่อเก็บ leading spaces สำหรับแยกเซลล์/ลูกค้า
 */
function normalizeStr(str) {
    return str
        .replace(/[\u00A0\uFFFD\u200B\u200C\u200D\uFEFF]/g, ' ')  // non-breaking space, replacement char, zero-width
        .replace(/\s+/g, ' ');  // collapse multiple spaces (ไม่ trim)
}

/**
 * ✅ ดึงเบอร์โทรจาก string — รองรับทุกรูปแบบ
 * - 0818093946 (10 หลักติด)
 * - 081-376-3265 (มีขีด)
 * - 02-4497756-8 (เบอร์บ้าน)
 * - 089-408-4599 (มี 2 ขีด)
 */
function extractPhone(str) {
    // หาเบอร์ที่มีตัวเลข+ขีด 9-12 ตัวอักษร
    const m = str.match(/(\d[\d\-]{8,12}\d)/);
    if (m) {
        return m[1].replace(/-/g, ''); // เก็บเฉพาะตัวเลข
    }
    return '';
}

function transformSalesReport(rows) {
    const transformed = [];
    let currentSales = { name: null, phone: null, code: null };
    let currentCustomer = { name: null, code: null };

    showProcessLog('info', '🔄 กำลังแปลงข้อมูล...');

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        // ✅ Normalize — ไม่ trim เพื่อเก็บ leading spaces
        const rawFirstCol = String(row[0] || '');
        const normCol = normalizeStr(rawFirstCol);     // มี leading space
        const firstCol = normCol.trim();                // ไม่มี leading space (สำหรับ content check)

        // ข้าม header และ separator
        if (firstCol.includes('---') || firstCol.includes('===') ||
            firstCol.includes('รายการสินค้า') || firstCol === '' ||
            firstCol.includes('Ea') || firstCol.includes('หน้า') ||
            firstCol.includes('รายงาน') || firstCol.includes('วันที่') ||
            firstCol.includes('รหัส') || firstCol.includes('เขตการขาย') ||
            firstCol.includes('หมวดสินค้า')) {
            continue;
        }

        // ข้ามแถวรวม
        if (firstCol.includes('รวมลูกค้า') || firstCol.includes('รวมพนักงาน') ||
            firstCol.includes('รวมทั้งหมด') || firstCol.includes('รวมยอดของ')) {
            continue;
        }

        // ═══════════════════════════════════════════════
        // ✅ ตรวจจับ พนักงานขาย — ใช้ content-based detection
        // เซลล์ = มีเบอร์โทร (ตัวเลข+ขีด 9+ หลัก) + /รหัส
        // Pattern หลัง trim: "(คุณ|บริษัท)ชื่อ เบอร์ /รหัส"
        // ═══════════════════════════════════════════════
        const salesMatch = firstCol.match(/^((?:คุณ|บริษัท).+?)\s*(\d[\d\-]{7,12}\d)\s*\/([A-Z0-9ก-ฮ][\w\-]*)$/);
        
        if (salesMatch) {
            let rawName = salesMatch[1].trim()
                .replace(/^บริษัท\s*/, '');
            
            rawName = cleanCellName(rawName);
            
            const rawPhone = salesMatch[2];
            const cleanPhone = rawPhone.replace(/-/g, '');
            
            currentSales = {
                name: rawName || 'บริษัท',
                phone: cleanPhone,
                code: salesMatch[3]
            };
            currentCustomer = { name: null, code: null };
            showProcessLog('info', `  👤 พนักงาน: ${currentSales.name} (${currentSales.phone}) [${currentSales.code}]`);
            continue;
        }

        // ✅ ตรวจจับ ลูกค้า — ชื่อ/รหัส ไม่มีเบอร์โทร ไม่มีตัวเลข product
        // Pattern: "ชื่อลูกค้า /รหัส" (ไม่มีเบอร์โทร)
        const customerMatch = firstCol.match(/^(.+?)\/([ก-ฮA-Z\w][\w]*)$/);
        if (customerMatch && !firstCol.match(/\d[\d\-]{7,12}\d/) && row.length <= 5) {
            // ถ้ามี row.length <= 5 แปลว่าไม่ใช่แถวสินค้า (สินค้ามี column เยอะ)
            let rawCustomerName = customerMatch[1].trim();
            rawCustomerName = cleanCellName(rawCustomerName);
            
            currentCustomer = {
                name: rawCustomerName,
                code: customerMatch[2]
            };
            showProcessLog('info', `    🏪 ลูกค้า: ${currentCustomer.name} [${currentCustomer.code}]`);
            continue;
        }

        // แถวข้อมูลสินค้า
        if (currentSales.code && row.length > 5) {
            const hasNumeric = row.slice(1).some(cell => {
                const val = String(cell || '').replace(/,/g, '').replace(/\s/g, '');
                return !isNaN(val) && val !== '';
            });

            if (hasNumeric) {
                const product = firstCol.replace(/^\s+/, '');
                const productMatch = product.match(/^(.+?)\/([^\s\/]+)$/);

                transformed.push({
                    sales_name: currentSales.name || '',
                    sales_phone: currentSales.phone || '',
                    sales_code: currentSales.code || '',
                    customer_name: currentCustomer.name || '',
                    customer_code: currentCustomer.code || '',
                    product_name: productMatch ? productMatch[1].trim() : product,
                    product_code: productMatch ? productMatch[2] : '',
                    qty_cash: parseFloat(String(row[4] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    qty_credit: parseFloat(String(row[5] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    qty_free: parseFloat(String(row[6] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    qty_return: parseFloat(String(row[7] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    qty_net: parseFloat(String(row[9] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    unit: normalizeStr(String(row[10] || '')).trim(),
                    amount_cash: parseFloat(String(row[11] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    amount_credit: parseFloat(String(row[12] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    amount_net: parseFloat(String(row[14] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    cost: parseFloat(String(row[15] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    profit: parseFloat(String(row[17] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0,
                    profit_percent: parseFloat(String(row[18] || '0').replace(/,/g, '').replace(/\s/g, '')) || 0
                });
            }
        }
    }

    // ✅ สรุปเซลล์ที่จับได้
    const salesCodes = new Set(transformed.map(r => r.sales_code));
    const customerCodes = new Set(transformed.map(r => r.customer_code).filter(Boolean));
    showProcessLog('success', `📊 จับเซลล์ได้ ${salesCodes.size} คน: ${[...salesCodes].join(', ')}`);
    showProcessLog('success', `🏪 จับลูกค้าได้ ${customerCodes.size} ราย`);

    return transformed;
}

// ========================================
// Filters
// ========================================

function initFilters() {
    const salesSet = new Set(transformedData.map(r => r.sales_code).filter(Boolean));
    const customerSet = new Set(transformedData.map(r => r.customer_code).filter(Boolean));

    const salesSelect = document.getElementById('filterSales');
    const customerSelect = document.getElementById('filterCustomer');

    salesSelect.innerHTML = '<option value="">-- ทุกพนักงาน --</option>';
    customerSelect.innerHTML = '<option value="">-- ทุกลูกค้า --</option>';

    [...salesSet].sort().forEach(code => {
        const name = transformedData.find(r => r.sales_code === code)?.sales_name || '';
        salesSelect.innerHTML += `<option value="${code}">${name} [${code}]</option>`;
    });

    [...customerSet].sort().forEach(code => {
        const name = transformedData.find(r => r.customer_code === code)?.customer_name || '';
        customerSelect.innerHTML += `<option value="${code}">${name} [${code}]</option>`;
    });

    const columns = Object.keys(transformedData[0]);
    const columnCheckboxes = document.getElementById('columnCheckboxes');
    columnCheckboxes.innerHTML = columns.map(col => `
        <label>
            <input type="checkbox" value="${col}" ${visibleColumns.has(col) ? 'checked' : ''}>
            ${col}
        </label>
    `).join('');

    columnCheckboxes.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) visibleColumns.add(e.target.value);
            else visibleColumns.delete(e.target.value);
            showPreview();
        });
    });
}

function applyFilters() {
    const salesFilter = document.getElementById('filterSales').value;
    const customerFilter = document.getElementById('filterCustomer').value;
    const productSearch = document.getElementById('searchProduct').value.toLowerCase();

    filteredData = transformedData.filter(row => {
        if (salesFilter && row.sales_code !== salesFilter) return false;
        if (customerFilter && row.customer_code !== customerFilter) return false;
        if (productSearch && !row.product_name.toLowerCase().includes(productSearch)) return false;
        return true;
    });

    showPreview();
}

function clearFilters() {
    document.getElementById('filterSales').value = '';
    document.getElementById('filterCustomer').value = '';
    document.getElementById('searchProduct').value = '';
    filteredData = [...transformedData];
    showPreview();
}

// ========================================
// Display
// ========================================

function showPreview() {
    if (!filteredData || filteredData.length === 0) {
        showAlert('❌ ไม่มีข้อมูลที่ตรงกับ filter', 'error');
        return;
    }

    document.getElementById('previewCard').classList.remove('hidden');

    const stats = [
        { label: 'รายการทั้งหมด', value: transformedData.length, icon: 'summarize' },
        { label: 'รายการที่แสดง', value: filteredData.length, icon: 'filter_list' },
        { label: 'พนักงาน', value: new Set(filteredData.map(r => r.sales_code)).size, icon: 'person' },
        { label: 'ลูกค้า', value: new Set(filteredData.map(r => r.customer_code).filter(Boolean)).size, icon: 'store' },
        {
            label: 'ยอดรวม',
            value: filteredData.reduce((sum, r) => sum + r.amount_net, 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }),
            icon: 'attach_money'
        },
        {
            label: 'กำไรรวม',
            value: filteredData.reduce((sum, r) => sum + r.profit, 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }),
            icon: 'trending_up'
        }
    ];

    document.getElementById('statsGrid').innerHTML = stats.map(s => `
        <div class="stat-card">
            <div class="stat-label">
                <span class="material-icons" style="font-size: 0.9rem; margin-right: 0.2rem;">${s.icon}</span>
                ${s.label}
            </div>
            <div class="stat-value">${s.value}</div>
        </div>
    `).join('');

    document.getElementById('displayCount').textContent = filteredData.length.toLocaleString();
    document.getElementById('totalCount').textContent = transformedData.length.toLocaleString();

    const columns = [...visibleColumns];
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');

    thead.innerHTML = '<tr>' + columns.map(c => `<th>${c}</th>`).join('') + '</tr>';
    
    tbody.innerHTML = filteredData.slice(0, 100).map(row =>
        '<tr>' + columns.map(c => {
            let val = row[c];
            if (typeof val === 'number' && !c.includes('code')) {
                val = val.toLocaleString('th-TH', { maximumFractionDigits: 2 });
            }
            return `<td>${val !== null && val !== undefined ? val : '-'}</td>`;
        }).join('') + '</tr>'
    ).join('');

    if (filteredData.length > 100) {
        tbody.innerHTML += `<tr><td colspan="${columns.length}" style="text-align:center; color:#666; padding:1rem;">แสดง 100 รายการแรก จาก ${filteredData.length} รายการ</td></tr>`;
    }

    document.getElementById('previewCard').scrollIntoView({ behavior: 'smooth' });
}

// ========================================
// Import to Supabase
// ========================================

async function checkDuplicateData(date) {
    try {
        const { data, error, count } = await window.supabaseClient
            .from('sales_data')
            .select('id', { count: 'exact', head: true })
            .eq('report_date', date);
        if (error) throw error;
        return count || 0;
    } catch (error) {
        console.error('Error checking duplicates:', error);
        return 0;
    }
}

async function showImportOptionsDialog() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;font-family:'Kanit',sans-serif;`;

        modal.innerHTML = `
            <div style="background:white;padding:2rem;border-radius:12px;max-width:500px;width:90%;">
                <h2 style="margin:0 0 1rem 0;color:#3a7d44;display:flex;align-items:center;gap:0.5rem;">
                    <span class="material-icons">help_outline</span>
                    เลือกวิธีการนำเข้าข้อมูล
                </h2>
                <p style="color:#666;margin-bottom:1.5rem;">พบข้อมูลในฐานข้อมูลแล้ว กรุณาเลือกวิธีการที่ต้องการ:</p>
                <div style="display:flex;flex-direction:column;gap:1rem;">
                    <button id="optionAdd" style="padding:1rem;border:2px solid #3a7d44;background:white;border-radius:8px;cursor:pointer;text-align:left;">
                        <div style="font-weight:600;color:#3a7d44;margin-bottom:0.3rem;">➕ เพิ่มข้อมูลใหม่</div>
                        <div style="font-size:0.9rem;color:#666;">เก็บข้อมูลเก่าไว้ทั้งหมด + เพิ่มข้อมูลใหม่เข้าไป</div>
                    </button>
                    <button id="optionReplace" style="padding:1rem;border:2px solid #ff9800;background:white;border-radius:8px;cursor:pointer;text-align:left;">
                        <div style="font-weight:600;color:#ff9800;margin-bottom:0.3rem;">🔄 แทนที่ข้อมูลวันนี้</div>
                        <div style="font-size:0.9rem;color:#666;">ลบข้อมูลเก่าวันที่ "<b>${reportDate || 'ไม่ระบุ'}</b>" + เพิ่มข้อมูลใหม่</div>
                    </button>
                    <button id="optionDeleteAll" style="padding:1rem;border:2px solid #f44336;background:white;border-radius:8px;cursor:pointer;text-align:left;">
                        <div style="font-weight:600;color:#f44336;margin-bottom:0.3rem;">🗑️ ลบทั้งหมดแล้วเริ่มใหม่</div>
                        <div style="font-size:0.9rem;color:#666;">ลบข้อมูลทั้งหมดในตาราง sales_data + เพิ่มข้อมูลใหม่ (ระวัง!)</div>
                    </button>
                    <button id="optionCancel" style="padding:0.8rem;border:1px solid #ccc;background:white;border-radius:8px;cursor:pointer;color:#666;margin-top:0.5rem;">❌ ยกเลิก</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        document.getElementById('optionAdd').onclick = () => { document.body.removeChild(modal); resolve('add'); };
        document.getElementById('optionReplace').onclick = () => { document.body.removeChild(modal); resolve('replace'); };
        document.getElementById('optionDeleteAll').onclick = () => {
            if (confirm('⚠️ คุณแน่ใจหรือไม่? การลบข้อมูลทั้งหมดไม่สามารถกู้คืนได้!')) {
                document.body.removeChild(modal); resolve('deleteAll');
            }
        };
        document.getElementById('optionCancel').onclick = () => { document.body.removeChild(modal); resolve('cancel'); };
    });
}

async function importToSupabase() {
    if (!transformedData || transformedData.length === 0) {
        showAlert('❌ ไม่มีข้อมูลให้บันทึก กรุณาอัพโหลดไฟล์ก่อน', 'error');
        return;
    }

    if (!window.supabaseClient) {
        showAlert('❌ ไม่สามารถเชื่อมต่อ Supabase ได้ กรุณารีเฟรชหน้า', 'error');
        return;
    }

    let finalFileName = fileName;
    if (reportDate) {
        const ext = fileName.split('.').pop();
        const nameWithoutExt = fileName.replace(`.${ext}`, '');
        finalFileName = `${nameWithoutExt}_${reportDate}.${ext}`;
    }

    showAlert('🔍 กำลังตรวจสอบข้อมูลซ้ำ...', 'info');
    const existingCount = await checkDuplicateData(reportDate);
    
    let importMode = 'add';
    
    if (existingCount > 0) {
        showAlert(`⚠️ พบข้อมูลเดิมวันที่ ${reportDate} จำนวน ${existingCount} รายการ กรุณาเลือกวิธีการ`, 'warning');
        importMode = await showImportOptionsDialog();
        if (importMode === 'cancel') {
            showAlert('ยกเลิกการนำเข้าข้อมูล', 'info');
            return;
        }
    }

    const importBtn = document.getElementById('importToSupabaseBtn');
    if (!importBtn) return;

    importBtn.disabled = true;
    importBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> กำลังบันทึก...';

    showProcessLog('info', '🔄 เริ่มบันทึกข้อมูลลง Supabase...');

    try {
        if (importMode === 'replace') {
            showProcessLog('info', `🗑️ กำลังลบข้อมูลเก่าวันที่ "${reportDate}"...`);
            const { error: deleteError } = await window.supabaseClient
                .from('sales_data').delete().eq('report_date', reportDate);
            if (deleteError) throw new Error(`ลบข้อมูลเก่าล้มเหลว: ${deleteError.message}`);
            showProcessLog('success', '✅ ลบข้อมูลเก่าสำเร็จ');
        } else if (importMode === 'deleteAll') {
            showProcessLog('info', '🗑️ กำลังลบข้อมูลทั้งหมดในตาราง...');
            const { error: deleteError } = await window.supabaseClient
                .from('sales_data').delete().neq('id', 0);
            if (deleteError) throw new Error(`ลบข้อมูลทั้งหมดล้มเหลว: ${deleteError.message}`);
            showProcessLog('success', '✅ ลบข้อมูลทั้งหมดสำเร็จ');
        }

        const dataToInsert = transformedData.map(row => ({
            sales_name: row.sales_name || '',
            sales_phone: row.sales_phone || '',
            sales_code: row.sales_code || '',
            customer_name: row.customer_name || '',
            customer_code: row.customer_code || '',
            product_name: row.product_name || '',
            product_code: row.product_code || '',
            qty_cash: row.qty_cash || 0,
            qty_credit: row.qty_credit || 0,
            qty_free: row.qty_free || 0,
            qty_return: row.qty_return || 0,
            qty_net: row.qty_net || 0,
            unit: row.unit || '',
            amount_cash: row.amount_cash || 0,
            amount_credit: row.amount_credit || 0,
            amount_net: row.amount_net || 0,
            cost: row.cost || 0,
            profit: row.profit || 0,
            profit_percent: row.profit_percent || 0,
            report_date: reportDate || new Date().toISOString().split('T')[0],
            import_by: window.currentUser?.display_name || window.currentUser?.email || 'Unknown',
            import_filename: finalFileName
        }));

        // กรองข้อมูลซ้ำภายในไฟล์
        showProcessLog('info', '🔍 กำลังตรวจสอบข้อมูลซ้ำภายในไฟล์...');
        const uniqueDataMap = new Map();
        dataToInsert.forEach((record) => {
            const key = `${record.sales_code}|${record.customer_code}|${record.product_code}|${record.report_date}`;
            if (!uniqueDataMap.has(key)) uniqueDataMap.set(key, record);
        });

        const uniqueData = Array.from(uniqueDataMap.values());
        const duplicateCount = dataToInsert.length - uniqueData.length;
        
        if (duplicateCount > 0) {
            showProcessLog('warning', `⚠️ กรองข้อมูลซ้ำออก ${duplicateCount} รายการ`);
        }
        showProcessLog('success', `✅ เตรียมข้อมูลพร้อมส่ง ${uniqueData.length} รายการ`);

        const batchSize = 100;
        let totalInserted = 0;

        for (let i = 0; i < uniqueData.length; i += batchSize) {
            const batch = uniqueData.slice(i, i + batchSize);
            showProcessLog('info', `📤 กำลังบันทึก ${i + 1}-${Math.min(i + batchSize, uniqueData.length)} จาก ${uniqueData.length}...`);

            const { error } = await window.supabaseClient
                .from('sales_data')
                .upsert(batch, {
                    onConflict: 'sales_code,customer_code,product_code,report_date',
                    ignoreDuplicates: false,
                    count: 'exact'
                });

            if (error) {
                let errorMsg = error.message;
                if (error.message.includes('ON CONFLICT')) {
                    errorMsg = '⚠️ ยังไม่ได้สร้าง Unique Constraint\nแนะนำ: รัน SQL setup_sales_data_constraints.sql ก่อน\n\n' + error.message;
                }
                throw new Error(errorMsg);
            }

            totalInserted += batch.length;
            showProcessLog('success', `✅ บันทึกสำเร็จ ${totalInserted} รายการ`);
        }

        showProcessLog('success', `🎉 บันทึกข้อมูลทั้งหมดสำเร็จ! (${totalInserted} รายการ)`);
        showAlert(`✅ บันทึกข้อมูลลง Supabase สำเร็จ! (${totalInserted} รายการ)`, 'success');

    } catch (error) {
        console.error('💥 Import error:', error);
        showProcessLog('error', '❌ เกิดข้อผิดพลาด: ' + error.message);
        showAlert('❌ เกิดข้อผิดพลาด: ' + error.message, 'error');
    }

    importBtn.disabled = false;
    importBtn.innerHTML = '<span class="material-icons">cloud_upload</span> บันทึกลง Supabase';
}

// ========================================
// Export & Clear
// ========================================

function exportCSV() {
    if (!filteredData) return;
    const columns = [...visibleColumns];
    const dataToExport = filteredData.map(row => {
        const obj = {};
        columns.forEach(col => obj[col] = row[col]);
        return obj;
    });
    const csv = Papa.unparse(dataToExport);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName.replace(/\.[^.]+$/, '_transformed.csv');
    link.click();
    showAlert('✅ Export สำเร็จ! (' + filteredData.length + ' รายการ)', 'success');
}

function clearData() {
    if (confirm('ต้องการล้างข้อมูลใช่หรือไม่?')) {
        transformedData = null;
        filteredData = null;
        fileName = null;
        visibleColumns = new Set();
        document.getElementById('fileInput').value = '';
        document.getElementById('previewCard').classList.add('hidden');
        document.getElementById('processCard').classList.add('hidden');
        document.getElementById('processLog').innerHTML = '';
        document.getElementById('alert').className = 'alert';
    }
}

// ========================================
// UI Helpers
// ========================================

function showAlert(msg, type) {
    const alert = document.getElementById('alert');
    alert.textContent = msg;
    alert.className = `alert show ${type}`;
}

function showProcessLog(type, msg) {
    document.getElementById('processCard').classList.remove('hidden');
    const log = document.getElementById('processLog');
    const div = document.createElement('div');
    div.className = type;
    div.textContent = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}