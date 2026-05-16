// ============================================
// Airport Transfer Rates Management WITH CSRF SUPPORT
// ============================================

let allPackages = [];
let allCategories = [];
let currentCategoryFilter = 'all';
let activeEditCell = null;
let isSaving = false;
let currentDiscountData = null;
let currentCategoryDiscountKey = null;
let currentCategoryDiscountName = null;

const userRole = document.querySelector('.user-role')?.innerText?.toLowerCase() || 'admin';

// Helper function to get CSRF token from cookie
function getCsrfToken() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'XSRF-TOKEN') {
            return decodeURIComponent(value);
        }
    }
    return null;
}

// Helper function for API requests with CSRF token
async function apiRequest(url, options = {}) {
    const method = options.method || 'GET';
    const csrfToken = getCsrfToken();
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    // Add CSRF token for non-GET requests
    if (method !== 'GET' && csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
    }
    
    const config = {
        ...options,
        method,
        headers,
        credentials: 'include'  // Important for cookies
    };
    
    // Don't set body for GET requests
    if (method === 'GET' && config.body) {
        delete config.body;
    }
    
    return fetch(url, config);
}

document.addEventListener('DOMContentLoaded', function() {
    loadPackages();
    loadCategories();
    loadDiscountSettings();
    setupEventListeners();
});

async function loadPackages() {
    try {
        const response = await apiRequest('/api/common/airport-transfer/packages');
        const data = await response.json();
        let packages = data.packages || [];
        
        // Sort packages: Economy first, then Comfort, then Bus, then by number within each group
        packages.sort((a, b) => {
            // Extract package type and number
            const getTypeAndNumber = (name) => {
                const match = name.match(/^([A-Za-z]+)\s+(\d+)$/);
                if (match) {
                    return { type: match[1], number: parseInt(match[2]) };
                }
                return { type: name, number: 0 };
            };
            
            const typeOrder = { 'Economy': 0, 'Comfort': 1, 'Bus': 2 };
            
            const aInfo = getTypeAndNumber(a.name);
            const bInfo = getTypeAndNumber(b.name);
            
            // First compare by type
            const aTypeOrder = typeOrder[aInfo.type] !== undefined ? typeOrder[aInfo.type] : 999;
            const bTypeOrder = typeOrder[bInfo.type] !== undefined ? typeOrder[bInfo.type] : 999;
            
            if (aTypeOrder !== bTypeOrder) {
                return aTypeOrder - bTypeOrder;
            }
            
            // Then compare by number within the same type
            return aInfo.number - bInfo.number;
        });
        
        allPackages = packages;
    } catch (error) {
        console.error('Error loading packages:', error);
        toastError('Failed to load packages', 'Error');
    }
}

async function loadCategories() {
    try {
        const response = await apiRequest('/api/common/airport-transfer/categories');
        const data = await response.json();
        allCategories = data.categories || [];
        renderCategories();
        updateCategoryFilter();
        renderFareMatrix();
    } catch (error) {
        console.error('Error loading categories:', error);
        toastError('Failed to load categories', 'Error');
    }
}

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    
    if (!container) return;
    
    if (allCategories.length === 0) {
        container.innerHTML = '<div class="empty-state">No categories found. Click "Add Category" to create one.</div>';
        return;
    }
    
    container.innerHTML = '';
    
    allCategories.forEach(category => {
        const areas = category.areas || {};
        const areasArray = Object.entries(areas);
        const isActive = category.isActive !== false;
        
        let areasHtml = '';
        if (areasArray.length > 0) {
            areasHtml = '<div class="areas-list">';
            areasArray.forEach(([areaKey, areaData]) => {
                const areaDisplayName = areaData.name || areaKey;
                areasHtml += `
                    <div class="area-item">
                        <span class="area-name" onclick="editAreaPrices('${category.key}', '${areaKey}')">${escapeHtml(areaDisplayName)}</span>
                        <div class="area-actions">
                            <button class="btn-area-edit" onclick="editAreaPrices('${category.key}', '${areaKey}')" title="Edit Prices">
                                <i class="fas fa-tag"></i>
                            </button>
                            ${userRole === 'superadmin' ? `
                            <button class="btn-area-discount" onclick="editAreaDiscount('${category.key}', '${areaKey}', '${escapeHtml(areaDisplayName)}')" title="Set Area Discount">
                                <i class="fas fa-percent"></i>
                            </button>
                            <button class="btn-area-delete" onclick="deleteArea('${category.key}', '${areaKey}')" title="Delete Area">
                                <i class="fas fa-trash"></i>
                            </button>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
            areasHtml += '</div>';
        } else {
            areasHtml = '<div class="empty-state" style="padding: 0.5rem;">No areas yet</div>';
        }
        
        const categoryCard = document.createElement('div');
        categoryCard.className = 'category-card';
        categoryCard.innerHTML = `
            <div class="category-header">
                <span class="category-name">${escapeHtml(category.name)}</span>
                <span class="category-status ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span>
            </div>
            ${areasHtml}
            ${userRole === 'superadmin' ? `
            <div class="category-actions">
                <button class="btn-icon-sm" onclick="openAreaModal('${category.key}', '${escapeHtml(category.name)}')">
                    <i class="fas fa-plus"></i> Add Area
                </button>
                <button class="btn-icon-sm" onclick="editCategoryDiscount('${category.key}', '${escapeHtml(category.name)}')">
                    <i class="fas fa-percent"></i> Set Category Discount
                </button>
                <button class="btn-icon-sm" onclick="toggleCategoryStatus('${category.key}', ${isActive})">
                    <i class="fas fa-power-off"></i> ${isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button class="btn-icon-sm" onclick="deleteCategory('${category.key}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            ` : ''}
        `;
        container.appendChild(categoryCard);
    });
}

function updateCategoryFilter() {
    const filterSelect = document.getElementById('categoryFilter');
    if (!filterSelect) return;
    
    filterSelect.innerHTML = '<option value="all">All Categories</option>';
    allCategories.forEach(category => {
        filterSelect.innerHTML += `<option value="${category.key}">${escapeHtml(category.name)}</option>`;
    });
    filterSelect.value = currentCategoryFilter;
}

async function renderFareMatrix() {
    try {
        const response = await apiRequest('/api/common/airport-transfer/matrix');
        const data = await response.json();
        
        let packages = data.packages || [];
        let matrix = data.matrix || [];
        
        // Sort packages: Economy first, then Comfort, then Bus, then by number within each group
        const getTypeAndNumber = (name) => {
            const match = name.match(/^([A-Za-z]+)\s+(\d+)$/);
            if (match) {
                return { type: match[1], number: parseInt(match[2]) };
            }
            return { type: name, number: 0 };
        };
        
        const typeOrder = { 'Economy': 0, 'Comfort': 1, 'Bus': 2 };
        
        packages.sort((a, b) => {
            const aInfo = getTypeAndNumber(a.name);
            const bInfo = getTypeAndNumber(b.name);
            
            const aTypeOrder = typeOrder[aInfo.type] !== undefined ? typeOrder[aInfo.type] : 999;
            const bTypeOrder = typeOrder[bInfo.type] !== undefined ? typeOrder[bInfo.type] : 999;
            
            if (aTypeOrder !== bTypeOrder) {
                return aTypeOrder - bTypeOrder;
            }
            return aInfo.number - bInfo.number;
        });
        
        if (currentCategoryFilter !== 'all') {
            matrix = matrix.filter(cat => cat.key === currentCategoryFilter);
        }
        
        // Build header
        const headerRow = document.getElementById('matrixHeader');
        if (headerRow) {
            let headerHtml = '<th>Area / Package</th>';
            packages.forEach(pkg => {
                headerHtml += `<th>${escapeHtml(pkg.name)}</th>`;
            });
            headerRow.innerHTML = headerHtml;
        }
        
        // Build body
        const tbody = document.getElementById('matrixBody');
        if (!tbody) return;
        
        if (matrix.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">No fare data available</td></tr>';
            return;
        }
        
        let bodyHtml = '';
        matrix.forEach(category => {
            const areas = category.areas || {};
            Object.entries(areas).forEach(([areaKey, areaData]) => {
                const areaDisplayName = areaData.name || areaKey;
                const prices = areaData.prices || {};
                const discountedPrices = areaData.discountedPrices || null;
                const hasDiscount = discountedPrices && discountedPrices.discountedPrice;
                
                // Build discount badge text
                let discountBadgeText = '';
                if (hasDiscount) {
                    const discountType = discountedPrices.discountType;
                    const discountValue = discountedPrices.value;
                    
                    if (discountType === 'percentage') {
                        discountBadgeText = `${discountValue}% OFF`;
                    } else if (discountType === 'fixed') {
                        discountBadgeText = `₱${parseFloat(discountValue).toLocaleString()} OFF`;
                    }
                }
                
                bodyHtml += '<tr>';
                bodyHtml += `<td class="area-cell">
                    <strong>${escapeHtml(areaDisplayName)}</strong>
                    <br><small>${escapeHtml(category.name)}</small>
                    ${hasDiscount ? `<span class="discount-badge"><i class="fas fa-tag"></i> ${discountBadgeText ? `(${discountBadgeText})` : ''}</span>` : ''}
                  </td>`;
                
                packages.forEach(pkg => {
                    let originalPrice = prices[pkg.name] || "0";
                    let displayHtml = '';
                    let discountBadge = '';
                    let dataPrice = originalPrice;
                    
                    // Check if there's a discounted price
                    if (hasDiscount && discountedPrices.discountedPrice && discountedPrices.discountedPrice[pkg.name]) {
                        const discountedPrice = discountedPrices.discountedPrice[pkg.name];
                        const originalPriceNum = parseFloat(originalPrice);
                        const discountedPriceNum = parseFloat(discountedPrice);
                        
                        if (originalPriceNum > 0 && discountedPriceNum > 0 && originalPriceNum !== discountedPriceNum) {
                            // Show both original (strikethrough, 50% opacity) and discounted price
                            displayHtml = `
                                <div class="price-container">
                                    <span class="original-price">₱${originalPriceNum.toLocaleString()}</span>
                                    <span class="discounted-price">₱${discountedPriceNum.toLocaleString()}</span>
                                </div>
                            `;
                            discountBadge = `<span class="discount-indicator" title="Discounted: ${discountedPrices.discountType === 'percentage' ? discountedPrices.value + '% OFF' : '₱' + parseFloat(discountedPrices.value).toLocaleString() + ' OFF'}">
                                <i class="fas fa-percent"></i>
                            </span>`;
                            dataPrice = discountedPrice; // Store discounted price for editing
                        } else {
                            // Just show discounted price if original is 0 or same
                            displayHtml = `<span class="price-display">₱${discountedPriceNum.toLocaleString()}</span>`;
                            discountBadge = `<span class="discount-indicator" title="Discounted: ${discountedPrices.discountType === 'percentage' ? discountedPrices.value + '% OFF' : '₱' + parseFloat(discountedPrices.value).toLocaleString() + ' OFF'}">
                                <i class="fas fa-percent"></i>
                            </span>`;
                            dataPrice = discountedPrice;
                        }
                    } else {
                        // No discount, show original price
                        const priceNum = parseFloat(originalPrice);
                        displayHtml = `<span class="price-display">${priceNum !== 0 ? `₱${priceNum.toLocaleString()}` : '₱0'}</span>`;
                        dataPrice = originalPrice;
                    }
                    
                    bodyHtml += `
                        <td class="price-cell ${userRole === 'superadmin' ? 'editable' : ''} ${hasDiscount ? 'has-discount' : ''}" 
                            data-category="${category.key}"
                            data-area="${areaKey}"
                            data-package="${escapeHtml(pkg.name)}"
                            data-price="${dataPrice}">
                            ${displayHtml}
                            ${discountBadge}
                          </td>
                    `;
                });
                bodyHtml += '</tr>';
            });
        });
        
        tbody.innerHTML = bodyHtml;
        
        // Add click handlers after rendering
        if (userRole === 'superadmin') {
            document.querySelectorAll('.price-cell.editable').forEach(cell => {
                cell.addEventListener('click', (e) => {
                    e.stopPropagation();
                    makeEditable(cell);
                });
            });
        }
        
    } catch (error) {
        console.error('Error rendering fare matrix:', error);
        const tbody = document.getElementById('matrixBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center error-state">Failed to load fare matrix</td></tr>';
        }
    }
}

// ========== Global Discount Management Functions ==========

async function loadDiscountSettings() {
    try {
        const response = await apiRequest('/api/common/airport-transfer/global-discount');
        const data = await response.json();
        
        if (data.hasDiscount) {
            currentDiscountData = data.discount;
            renderDiscountInfo(currentDiscountData);
        } else {
            renderNoDiscount();
        }
    } catch (error) {
        console.error('Error loading discount settings:', error);
        renderNoDiscount();
    }
}

function renderDiscountInfo(discount) {
    const container = document.getElementById('discountContainer');
    if (!container) return;
    
    if (!discount) {
        renderNoDiscount();
        return;
    }
    
    const discountValue = discount.discountType === 'percentage' 
        ? `${discount.value}% OFF` 
        : `₱${parseFloat(discount.value).toLocaleString()} OFF`;
    
    const discountClass = discount.discountType === 'percentage' ? 'percentage' : 'fixed';
    
    let validityHtml = '';
    if (discount.validUntil) {
        const validUntil = new Date(discount.validUntil);
        const today = new Date();
        const isExpired = validUntil < today;
        validityHtml = `
            <div class="discount-validity">
                <i class="fas ${isExpired ? 'fa-exclamation-triangle' : 'fa-calendar-alt'}"></i>
                Valid until: ${validUntil.toLocaleDateString()}
                ${isExpired ? '<span style="color: #ef4444;"> (Expired)</span>' : ''}
            </div>
        `;
    }
    
    container.innerHTML = `
        <div class="discount-info">
            <div class="discount-info-item">
                <span class="discount-label">Current Discount:</span>
                <span class="discount-value ${discountClass}">${discountValue}</span>
            </div>
            ${discount.description ? `
            <div class="discount-info-item">
                <span class="discount-label">Description:</span>
                <span class="discount-description">${escapeHtml(discount.description)}</span>
            </div>
            ` : ''}
            ${validityHtml}
            <div class="discount-info-item">
                <span class="discount-label">Created:</span>
                <span class="discount-date">${new Date(discount.createdAt).toLocaleDateString()}</span>
            </div>
            ${userRole === 'superadmin' ? `
            <div class="discount-actions" style="margin-top: 0.75rem;">
                <button class="btn-icon-sm" onclick="openDiscountModal()">
                    <i class="fas fa-edit"></i> Edit Discount
                </button>
                <button class="btn-icon-sm btn-danger" onclick="removeGlobalDiscount()">
                    <i class="fas fa-trash"></i> Remove Discount
                </button>
            </div>
            ` : ''}
        </div>
    `;
}

function renderNoDiscount() {
    const container = document.getElementById('discountContainer');
    if (!container) return;
    
    container.innerHTML = `
        <div class="no-discount">
            <i class="fas fa-tag" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
            <p>No active global discount</p>
            <small>Click Edit to add a global discount that will apply to all areas</small>
            ${userRole === 'superadmin' ? `
            <div class="discount-actions" style="margin-top: 0.75rem;">
                <button class="btn-icon-sm" onclick="openDiscountModal()">
                    <i class="fas fa-plus"></i> Add Global Discount
                </button>
            </div>
            ` : ''}
        </div>
    `;
}

function openDiscountModal() {
    const modal = document.getElementById('discountModal');
    if (!modal) return;
    
    if (currentDiscountData) {
        document.getElementById('discountType').value = currentDiscountData.discountType || 'percentage';
        document.getElementById('discountValue').value = currentDiscountData.value || '';
        document.getElementById('discountDescription').value = currentDiscountData.description || '';
        document.getElementById('discountValidUntil').value = currentDiscountData.validUntil || '';
    } else {
        document.getElementById('discountForm').reset();
        document.getElementById('discountType').value = 'percentage';
    }
    
    modal.style.display = 'flex';
}

function closeDiscountModal() {
    const modal = document.getElementById('discountModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function saveGlobalDiscount(e) {
    e.preventDefault();
    
    const discountType = document.getElementById('discountType').value;
    const discountValue = document.getElementById('discountValue').value;
    const description = document.getElementById('discountDescription').value;
    const validUntil = document.getElementById('discountValidUntil').value;
    
    if (!discountValue) {
        toastError('Discount value is required', 'Validation Error');
        return;
    }
    
    const valueNum = parseFloat(discountValue);
    if (discountType === 'percentage' && (valueNum < 0 || valueNum > 100)) {
        toastError('Percentage must be between 0 and 100', 'Validation Error');
        return;
    }
    
    if (discountType === 'fixed' && valueNum < 0) {
        toastError('Fixed discount cannot be negative', 'Validation Error');
        return;
    }
    
    try {
        const response = await apiRequest('/api/common/airport-transfer/global-discount', {
            method: 'POST',
            body: JSON.stringify({
                discountType,
                value: discountValue,
                description,
                validUntil,
                applyToAll: true
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess('Global discount applied to all areas successfully!', 'Success');
            closeDiscountModal();
            loadDiscountSettings();
            loadCategories();
            renderFareMatrix();
        } else {
            toastError(data.error || 'Failed to save discount settings', 'Error');
        }
    } catch (error) {
        console.error('Error saving discount:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

async function removeGlobalDiscount() {
    showConfirmModal({
        title: 'Remove Global Discount',
        message: 'Are you sure you want to remove the global discount? This will remove discount from all areas.',
        confirmText: 'Remove',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest('/api/common/airport-transfer/global-discount?removeFromAreas=true', {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess('Global discount removed successfully', 'Success');
                    loadDiscountSettings();
                    loadCategories();
                    renderFareMatrix();
                } else {
                    toastError(data.error || 'Failed to remove discount', 'Error');
                }
            } catch (error) {
                console.error('Error removing discount:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

// ========== Category Discount Functions ==========

async function editCategoryDiscount(categoryKey, categoryName) {
    currentCategoryDiscountKey = categoryKey;
    currentCategoryDiscountName = categoryName;
    
    const modal = document.getElementById('categoryDiscountModal');
    if (!modal) return;
    
    document.getElementById('categoryDiscountModalTitle').textContent = `Set Discount for Category: ${categoryName}`;
    document.getElementById('categoryDiscountKey').value = categoryKey;
    
    // Check if category already has a discount
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/discount`);
        const data = await response.json();
        
        if (data.hasDiscount) {
            document.getElementById('categoryDiscountType').value = data.discount.discountType || 'percentage';
            document.getElementById('categoryDiscountValue').value = data.discount.value || '';
            document.getElementById('categoryDiscountDescription').value = data.discount.description || '';
            document.getElementById('categoryDiscountValidUntil').value = data.discount.validUntil || '';
        } else {
            document.getElementById('categoryDiscountForm').reset();
            document.getElementById('categoryDiscountType').value = 'percentage';
            document.getElementById('categoryDiscountValue').value = '';
            document.getElementById('categoryDiscountDescription').value = '';
            document.getElementById('categoryDiscountValidUntil').value = '';
        }
        document.getElementById('overrideAreaDiscounts').checked = false;
    } catch (error) {
        // No existing discount
        document.getElementById('categoryDiscountForm').reset();
        document.getElementById('categoryDiscountType').value = 'percentage';
        document.getElementById('categoryDiscountValue').value = '';
        document.getElementById('categoryDiscountDescription').value = '';
        document.getElementById('categoryDiscountValidUntil').value = '';
        document.getElementById('overrideAreaDiscounts').checked = false;
    }
    
    modal.style.display = 'flex';
}

function closeCategoryDiscountModal() {
    const modal = document.getElementById('categoryDiscountModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentCategoryDiscountKey = null;
    currentCategoryDiscountName = null;
}

async function saveCategoryDiscount(e) {
    e.preventDefault();
    
    const categoryKey = document.getElementById('categoryDiscountKey').value;
    const discountType = document.getElementById('categoryDiscountType').value;
    const discountValue = document.getElementById('categoryDiscountValue').value;
    const description = document.getElementById('categoryDiscountDescription').value;
    const validUntil = document.getElementById('categoryDiscountValidUntil').value;
    const overrideAreaDiscounts = document.getElementById('overrideAreaDiscounts')?.checked || false;
    
    if (!discountValue) {
        toastError('Discount value is required', 'Validation Error');
        return;
    }
    
    const valueNum = parseFloat(discountValue);
    if (discountType === 'percentage' && (valueNum < 0 || valueNum > 100)) {
        toastError('Percentage must be between 0 and 100', 'Validation Error');
        return;
    }
    
    if (discountType === 'fixed' && valueNum < 0) {
        toastError('Fixed discount cannot be negative', 'Validation Error');
        return;
    }
    
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/discount`, {
            method: 'POST',
            body: JSON.stringify({
                discountType,
                value: discountValue,
                description,
                validUntil,
                overrideAreaDiscounts
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(`Category discount applied to all areas under ${currentCategoryDiscountName}!`, 'Success');
            closeCategoryDiscountModal();
            loadCategories();
            renderFareMatrix();
        } else {
            toastError(data.error || 'Failed to apply category discount', 'Error');
        }
    } catch (error) {
        console.error('Error saving category discount:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

async function removeCategoryDiscount() {
    if (!currentCategoryDiscountKey) return;
    
    showConfirmModal({
        title: 'Remove Category Discount',
        message: `Are you sure you want to remove the discount for category "${currentCategoryDiscountName}"? This will remove discounts from all areas in this category.`,
        confirmText: 'Remove',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/airport-transfer/categories/${currentCategoryDiscountKey}/discount`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess('Category discount removed successfully', 'Success');
                    closeCategoryDiscountModal();
                    loadCategories();
                    renderFareMatrix();
                } else {
                    toastError(data.error || 'Failed to remove category discount', 'Error');
                }
            } catch (error) {
                console.error('Error removing category discount:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

// ========== Area Discount Functions ==========

async function editAreaDiscount(categoryKey, areaKey, areaName) {
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/discounted-prices`);
        const data = await response.json();
        const discountData = data.discountedPrices || {};
        
        const modal = document.getElementById('areaDiscountModal');
        if (!modal) return;
        
        document.getElementById('areaDiscountModalTitle').textContent = `Set Discount for ${areaName}`;
        document.getElementById('areaDiscountCategoryKey').value = categoryKey;
        document.getElementById('areaDiscountAreaKey').value = areaKey;
        
        if (discountData && discountData.discountType) {
            document.getElementById('areaDiscountType').value = discountData.discountType;
            document.getElementById('areaDiscountValue').value = discountData.value;
            document.getElementById('areaDiscountDescription').value = discountData.description || '';
            document.getElementById('areaDiscountValidUntil').value = discountData.validUntil || '';
        } else {
            document.getElementById('areaDiscountForm').reset();
            document.getElementById('areaDiscountType').value = 'percentage';
        }
        
        modal.style.display = 'flex';
    } catch (error) {
        console.error('Error loading area discount:', error);
        toastError('Failed to load discount data', 'Error');
    }
}

function closeAreaDiscountModal() {
    const modal = document.getElementById('areaDiscountModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function saveAreaDiscount(e) {
    e.preventDefault();
    
    const categoryKey = document.getElementById('areaDiscountCategoryKey').value;
    const areaKey = document.getElementById('areaDiscountAreaKey').value;
    const discountType = document.getElementById('areaDiscountType').value;
    const discountValue = document.getElementById('areaDiscountValue').value;
    const description = document.getElementById('areaDiscountDescription').value;
    const validUntil = document.getElementById('areaDiscountValidUntil').value;
    
    if (!discountValue) {
        toastError('Discount value is required', 'Validation Error');
        return;
    }
    
    const valueNum = parseFloat(discountValue);
    if (discountType === 'percentage' && (valueNum < 0 || valueNum > 100)) {
        toastError('Percentage must be between 0 and 100', 'Validation Error');
        return;
    }
    
    if (discountType === 'fixed' && valueNum < 0) {
        toastError('Fixed discount cannot be negative', 'Validation Error');
        return;
    }
    
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/discounted-prices`, {
            method: 'POST',
            body: JSON.stringify({
                discountType,
                value: discountValue,
                description,
                validUntil
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess('Discount applied successfully!', 'Success');
            closeAreaDiscountModal();
            loadCategories();
            renderFareMatrix();
        } else {
            toastError(data.error || 'Failed to apply discount', 'Error');
        }
    } catch (error) {
        console.error('Error saving area discount:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

async function removeAreaDiscount(categoryKey, areaKey, areaName) {
    showConfirmModal({
        title: 'Remove Discount',
        message: `Are you sure you want to remove the discount for "${areaName}"?`,
        confirmText: 'Remove',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/discounted-prices`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess('Discount removed successfully', 'Success');
                    loadCategories();
                    renderFareMatrix();
                } else {
                    toastError(data.error || 'Failed to remove discount', 'Error');
                }
            } catch (error) {
                console.error('Error removing discount:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

// ========== Inline Editing Functions ==========

function makeEditable(cell) {
    if (activeEditCell === cell) return;
    if (activeEditCell) {
        cancelEdit(activeEditCell);
    }
    
    const currentPrice = parseInt(cell.getAttribute('data-price')) || 0;
    const categoryKey = cell.getAttribute('data-category');
    const areaKey = cell.getAttribute('data-area');
    const packageName = cell.getAttribute('data-package');
    
    // Create input element
    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentPrice;
    input.className = 'price-input-inline';
    input.min = 0;
    input.step = 1;
    input.setAttribute('data-category', categoryKey);
    input.setAttribute('data-area', areaKey);
    input.setAttribute('data-package', packageName);
    
    // Clear cell and add input
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    
    activeEditCell = cell;
    
    // Handle Enter key
    const handleKeydown = async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('blur', handleBlur);
            await savePriceEdit(cell, input.value, categoryKey, areaKey, packageName);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('blur', handleBlur);
            cancelEdit(cell);
        }
    };
    
    // Handle blur
    const handleBlur = () => {
        if (!isSaving && activeEditCell === cell) {
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('blur', handleBlur);
            cancelEdit(cell);
        }
    };
    
    input.addEventListener('keydown', handleKeydown);
    input.addEventListener('blur', handleBlur);
}

function cancelEdit(cell) {
    if (activeEditCell !== cell) return;
    
    const currentPrice = cell.getAttribute('data-price') || 0;
    const priceDisplay = currentPrice ? `₱${Number(currentPrice).toLocaleString()}` : '₱0';
    
    cell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
    activeEditCell = null;
}

async function savePriceEdit(cell, newValue, categoryKey, areaKey, packageName) {
    if (isSaving) return;
    isSaving = true;
    
    const price = parseInt(newValue);
    
    if (isNaN(price) || price < 0) {
        toastError('Please enter a valid price (0 or greater)', 'Invalid Input');
        cancelEdit(cell);
        isSaving = false;
        return;
    }
    
    // Show loading state
    cell.innerHTML = '<div class="price-loading"><i class="fas fa-spinner fa-spin"></i></div>';
    activeEditCell = null;
    
    try {
        // Get current prices for this area
        const getResponse = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/prices`);
        const currentData = await getResponse.json();
        const currentPrices = currentData.prices || {};
        
        // Update the specific package price
        currentPrices[packageName] = price.toString();
        
        // Save all prices back
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/prices`, {
            method: 'PUT',
            body: JSON.stringify({ prices: currentPrices })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update the cell's data attribute
            cell.setAttribute('data-price', price);
            const priceDisplay = price ? `₱${price.toLocaleString()}` : '₱0';
            cell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
            toastSuccess(`Updated price for ${packageName}`, 'Success');
            // Refresh matrix to show updated discount calculations if any
            renderFareMatrix();
        } else {
            toastError(data.error || 'Failed to update price', 'Error');
            cancelEdit(cell);
        }
    } catch (error) {
        console.error('Error saving price:', error);
        toastError('An unexpected error occurred', 'Error');
        cancelEdit(cell);
    } finally {
        isSaving = false;
    }
}

// ========== Event Listeners ==========

function setupEventListeners() {
    document.getElementById('addCategoryBtn')?.addEventListener('click', () => openCategoryModal());
    document.getElementById('categoryFilter')?.addEventListener('change', function() {
        currentCategoryFilter = this.value;
        renderFareMatrix();
    });
    document.getElementById('editDiscountBtn')?.addEventListener('click', () => openDiscountModal());
    
    // Category Modal
    document.getElementById('closeCategoryModal')?.addEventListener('click', closeCategoryModal);
    document.getElementById('cancelCategoryBtn')?.addEventListener('click', closeCategoryModal);
    document.getElementById('categoryForm')?.addEventListener('submit', saveCategory);
    
    // Area Modal
    document.getElementById('closeAreaModal')?.addEventListener('click', closeAreaModal);
    document.getElementById('cancelAreaBtn')?.addEventListener('click', closeAreaModal);
    document.getElementById('areaForm')?.addEventListener('submit', saveArea);
    
    // Prices Modal
    document.getElementById('closePricesModal')?.addEventListener('click', closePricesModal);
    document.getElementById('cancelPricesBtn')?.addEventListener('click', closePricesModal);
    document.getElementById('pricesForm')?.addEventListener('submit', savePrices);
    
    // Global Discount Modal
    document.getElementById('closeDiscountModal')?.addEventListener('click', closeDiscountModal);
    document.getElementById('cancelDiscountBtn')?.addEventListener('click', closeDiscountModal);
    document.getElementById('discountForm')?.addEventListener('submit', saveGlobalDiscount);
    
    // Area Discount Modal
    document.getElementById('closeAreaDiscountModal')?.addEventListener('click', closeAreaDiscountModal);
    document.getElementById('cancelAreaDiscountBtn')?.addEventListener('click', closeAreaDiscountModal);
    document.getElementById('areaDiscountForm')?.addEventListener('submit', saveAreaDiscount);
    
    // Category Discount Modal
    document.getElementById('closeCategoryDiscountModal')?.addEventListener('click', closeCategoryDiscountModal);
    document.getElementById('cancelCategoryDiscountBtn')?.addEventListener('click', closeCategoryDiscountModal);
    document.getElementById('categoryDiscountForm')?.addEventListener('submit', saveCategoryDiscount);
    
    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('categoryModal')) closeCategoryModal();
        if (e.target === document.getElementById('areaModal')) closeAreaModal();
        if (e.target === document.getElementById('pricesModal')) closePricesModal();
        if (e.target === document.getElementById('discountModal')) closeDiscountModal();
        if (e.target === document.getElementById('areaDiscountModal')) closeAreaDiscountModal();
        if (e.target === document.getElementById('categoryDiscountModal')) closeCategoryDiscountModal();
    });
}

// ========== Category Functions ==========

function openCategoryModal() {
    document.getElementById('categoryModal').style.display = 'flex';
    document.getElementById('categoryName').value = '';
    document.getElementById('initialAreaName').value = '';
}

function closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
    document.getElementById('categoryForm').reset();
}

async function saveCategory(e) {
    e.preventDefault();
    const categoryName = document.getElementById('categoryName').value.trim();
    const initialAreaName = document.getElementById('initialAreaName').value.trim();
    
    if (!categoryName) {
        toastError('Category name is required', 'Validation Error');
        return;
    }
    
    if (!initialAreaName) {
        toastError('Initial area name is required', 'Validation Error');
        return;
    }
    
    try {
        const response = await apiRequest('/api/common/airport-transfer/categories', {
            method: 'POST',
            body: JSON.stringify({ 
                name: categoryName,
                area: initialAreaName
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(data.message, 'Success');
            closeCategoryModal();
            loadCategories();
        } else {
            toastError(data.error || 'Failed to save category', 'Error');
        }
    } catch (error) {
        console.error('Error saving category:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

async function deleteCategory(categoryKey) {
    showConfirmModal({
        title: 'Delete Category',
        message: 'Are you sure you want to delete this category? All areas under it will also be deleted.',
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess(data.message, 'Deleted');
                    loadCategories();
                } else {
                    toastError(data.error || 'Failed to delete category', 'Error');
                }
            } catch (error) {
                console.error('Error deleting category:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

async function toggleCategoryStatus(categoryKey, currentStatus) {
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/toggle`, {
            method: 'PATCH'
        });
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(data.message, 'Status Updated');
            loadCategories();
        } else {
            toastError(data.error || 'Failed to toggle status', 'Error');
        }
    } catch (error) {
        console.error('Error toggling category status:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

// ========== Area Functions ==========

function openAreaModal(categoryKey, categoryName) {
    document.getElementById('areaModalTitle').textContent = `Add Area to ${categoryName}`;
    document.getElementById('areaCategoryKey').value = categoryKey;
    document.getElementById('areaName').value = '';
    document.getElementById('areaModal').style.display = 'flex';
}

function closeAreaModal() {
    document.getElementById('areaModal').style.display = 'none';
    document.getElementById('areaForm').reset();
}

async function saveArea(e) {
    e.preventDefault();
    
    const categoryKey = document.getElementById('areaCategoryKey').value;
    const name = document.getElementById('areaName').value.trim();
    
    if (!name) {
        toastError('Area name is required', 'Validation Error');
        return;
    }
    
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(data.message, 'Success');
            closeAreaModal();
            loadCategories();
            renderFareMatrix();
        } else {
            toastError(data.error || 'Failed to add area', 'Error');
        }
    } catch (error) {
        console.error('Error saving area:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

async function deleteArea(categoryKey, areaKey) {
    showConfirmModal({
        title: 'Delete Area',
        message: `Are you sure you want to delete this area? All fare prices for this area will also be deleted.`,
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess(data.message, 'Deleted');
                    loadCategories();
                    renderFareMatrix();
                } else {
                    toastError(data.error || 'Failed to delete area', 'Error');
                }
            } catch (error) {
                console.error('Error deleting area:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

// ========== Price Functions (Legacy - kept for compatibility) ==========

async function editAreaPrices(categoryKey, areaKey) {
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/prices`);
        const data = await response.json();
        const currentPrices = data.prices || {};
        
        // Get area name from categories data
        let areaName = areaKey;
        for (const category of allCategories) {
            if (category.key === categoryKey && category.areas && category.areas[areaKey]) {
                areaName = category.areas[areaKey].name || areaKey;
                break;
            }
        }
        
        document.getElementById('pricesModalTitle').textContent = `Fare Prices: ${areaName}`;
        document.getElementById('pricesCategoryKey').value = categoryKey;
        document.getElementById('pricesAreaKey').value = areaKey;
        
        // Sort packages: Economy first, then Comfort, then Bus, then by number within each group
        const getTypeAndNumber = (name) => {
            const match = name.match(/^([A-Za-z]+)\s+(\d+)$/);
            if (match) {
                return { type: match[1], number: parseInt(match[2]) };
            }
            return { type: name, number: 0 };
        };
        
        const typeOrder = { 'Economy': 0, 'Comfort': 1, 'Bus': 2 };
        
        const sortedPackages = [...allPackages];
        sortedPackages.sort((a, b) => {
            const aInfo = getTypeAndNumber(a.name);
            const bInfo = getTypeAndNumber(b.name);
            
            const aTypeOrder = typeOrder[aInfo.type] !== undefined ? typeOrder[aInfo.type] : 999;
            const bTypeOrder = typeOrder[bInfo.type] !== undefined ? typeOrder[bInfo.type] : 999;
            
            if (aTypeOrder !== bTypeOrder) {
                return aTypeOrder - bTypeOrder;
            }
            return aInfo.number - bInfo.number;
        });
        
        const container = document.getElementById('packagePricesContainer');
        let pricesHtml = '';
        sortedPackages.forEach(pkg => {
            const currentPrice = currentPrices[pkg.name] || '';
            pricesHtml += `
                <div class="price-row">
                    <span class="price-package-name">${escapeHtml(pkg.name)}</span>
                    <input type="number" class="price-input" data-package="${pkg.name}" value="${currentPrice}" placeholder="Enter price" step="1" min="0">
                </div>
            `;
        });
        
        container.innerHTML = pricesHtml;
        document.getElementById('pricesModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading prices:', error);
        toastError('Failed to load prices', 'Error');
    }
}

function closePricesModal() {
    document.getElementById('pricesModal').style.display = 'none';
    document.getElementById('pricesForm').reset();
}

async function savePrices(e) {
    e.preventDefault();
    
    const categoryKey = document.getElementById('pricesCategoryKey').value;
    const areaKey = document.getElementById('pricesAreaKey').value;
    
    const prices = {};
    document.querySelectorAll('.price-input').forEach(input => {
        const packageName = input.getAttribute('data-package');
        const value = parseInt(input.value);
        if (!isNaN(value) && value > 0) {
            prices[packageName] = value;
        } else {
            prices[packageName] = 0;
        }
    });
    
    try {
        const response = await apiRequest(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/prices`, {
            method: 'PUT',
            body: JSON.stringify({ prices })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(data.message, 'Success');
            closePricesModal();
            loadCategories();
            renderFareMatrix();
        } else {
            toastError(data.error || 'Failed to save prices', 'Error');
        }
    } catch (error) {
        console.error('Error saving prices:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}