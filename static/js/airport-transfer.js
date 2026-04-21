// ============================================
// Airport Transfer Rates Management
// ============================================

let allPackages = [];
let allCategories = [];
let currentCategoryFilter = 'all';
let activeEditCell = null;
let isSaving = false;

const userRole = document.querySelector('.user-role')?.innerText?.toLowerCase() || 'admin';

document.addEventListener('DOMContentLoaded', function() {
    loadPackages();
    loadCategories();
    setupEventListeners();
});

async function loadPackages() {
    try {
        const response = await fetch('/api/common/airport-transfer/packages');
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
        const response = await fetch('/api/common/airport-transfer/categories');
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
        const response = await fetch('/api/common/airport-transfer/matrix');
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
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">No fare data available<\/td></tr>';
            return;
        }
        
        let bodyHtml = '';
        matrix.forEach(category => {
            const areas = category.areas || {};
            Object.entries(areas).forEach(([areaKey, areaData]) => {
                const areaDisplayName = areaData.name || areaKey;
                const prices = areaData.prices || {};
                bodyHtml += '<tr>';
                bodyHtml += `<td class="area-cell"><strong>${escapeHtml(areaDisplayName)}</strong><br><small>${escapeHtml(category.name)}</small><\/td>`;
                packages.forEach(pkg => {
                    const price = prices[pkg.name] || "0";
                    const priceDisplay = price !== "0" ? `₱${parseInt(price).toLocaleString()}` : '₱0';
                    bodyHtml += `
                        <td class="price-cell ${userRole === 'superadmin' ? 'editable' : ''}" 
                            data-category="${category.key}"
                            data-area="${areaKey}"
                            data-package="${escapeHtml(pkg.name)}"
                            data-price="${price}">
                            <span class="price-display">${priceDisplay}</span>
                        <\/td>
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
            tbody.innerHTML = '<tr><td colspan="10" class="text-center error-state">Failed to load fare matrix<\/td></tr>';
        }
    }
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
        const getResponse = await fetch(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/prices`, {
            credentials: 'include'
        });
        const currentData = await getResponse.json();
        const currentPrices = currentData.prices || {};
        
        // Update the specific package price
        currentPrices[packageName] = price.toString();  // Send as string
        
        // Save all prices back
        const response = await fetch(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/prices`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ prices: currentPrices })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update the cell's data attribute
            cell.setAttribute('data-price', price);
            const priceDisplay = price ? `₱${price.toLocaleString()}` : '₱0';
            cell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
            toastSuccess(`Updated price for ${packageName}`, 'Success');
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
    
    document.getElementById('closeCategoryModal')?.addEventListener('click', closeCategoryModal);
    document.getElementById('cancelCategoryBtn')?.addEventListener('click', closeCategoryModal);
    document.getElementById('categoryForm')?.addEventListener('submit', saveCategory);
    
    document.getElementById('closeAreaModal')?.addEventListener('click', closeAreaModal);
    document.getElementById('cancelAreaBtn')?.addEventListener('click', closeAreaModal);
    document.getElementById('areaForm')?.addEventListener('submit', saveArea);
    
    document.getElementById('closePricesModal')?.addEventListener('click', closePricesModal);
    document.getElementById('cancelPricesBtn')?.addEventListener('click', closePricesModal);
    document.getElementById('pricesForm')?.addEventListener('submit', savePrices);
    
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('categoryModal')) closeCategoryModal();
        if (e.target === document.getElementById('areaModal')) closeAreaModal();
        if (e.target === document.getElementById('pricesModal')) closePricesModal();
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
        const response = await fetch('/api/common/airport-transfer/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
                const response = await fetch(`/api/common/airport-transfer/categories/${categoryKey}`, {
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
        const response = await fetch(`/api/common/airport-transfer/categories/${categoryKey}/toggle`, {
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
        const response = await fetch(`/api/common/airport-transfer/categories/${categoryKey}/areas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

async function deleteArea(categoryKey, areaName) {
    showConfirmModal({
        title: 'Delete Area',
        message: `Are you sure you want to delete "${areaName}"? All fare prices for this area will also be deleted.`,
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await fetch(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaName}`, {
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

async function editAreaPrices(categoryKey, areaName) {
    try {
        const response = await fetch(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaName}/prices`);
        const data = await response.json();
        const currentPrices = data.prices || {};
        
        document.getElementById('pricesModalTitle').textContent = `Fare Prices: ${areaName}`;
        document.getElementById('pricesCategoryKey').value = categoryKey;
        document.getElementById('pricesAreaKey').value = areaName;
        
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
        }
    });
    
    try {
        const response = await fetch(`/api/common/airport-transfer/categories/${categoryKey}/areas/${areaKey}/prices`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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