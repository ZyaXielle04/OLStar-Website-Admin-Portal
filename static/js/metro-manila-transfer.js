// ============================================
// Metro Manila Transfer Rates Management - WITH DISCOUNTS AND CSRF SUPPORT
// ============================================

let allPackages = [];
let allCities = [];
let allRates = {};
let currentOriginFilter = 'all';
let currentPackage = null;
let cachedData = null;
let lastFetchTime = null;
let isLoading = false;
let pendingRequest = null;
let currentDiscountData = null;
let currentCityDiscountKey = null;
let currentCityDiscountName = null;

const CACHE_DURATION = 30000; // 30 seconds cache
const DEBOUNCE_DELAY = 300;
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
    // Check for prefetched data
    if (window.prefetchedMetroData) {
        console.log('Using prefetched data');
        cachedData = window.prefetchedMetroData;
        lastFetchTime = Date.now();
        applyCachedData();
        showSkeleton(false);
    } else {
        loadData();
    }
    setupEventListeners();
    prefetchData();
});

async function loadData(forceRefresh = false) {
    if (isLoading) return;
    
    // Check cache
    if (!forceRefresh && cachedData && lastFetchTime && 
        (Date.now() - lastFetchTime) < CACHE_DURATION) {
        console.log('Using cached data');
        applyCachedData();
        return;
    }
    
    isLoading = true;
    showSkeleton(true);
    
    try {
        // Abort previous request
        if (pendingRequest) {
            pendingRequest.abort();
        }
        
        const controller = new AbortController();
        pendingRequest = controller;
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await apiRequest('/api/common/metro-manila-transfer/matrix', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        pendingRequest = null;
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Store in cache
        cachedData = data;
        lastFetchTime = Date.now();
        
        // Prefetch next data
        prefetchData();
        
        applyCachedData();
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request aborted');
        } else {
            console.error('Error loading data:', error);
            showError('Failed to load data');
            toastError('Failed to load data', 'Error');
            
            // Use cached data if available
            if (cachedData) {
                applyCachedData();
                toastWarning('Using cached data', 'Offline Mode');
            }
        }
    } finally {
        isLoading = false;
        showSkeleton(false);
    }
}

function prefetchData() {
    if (!cachedData && !isLoading) {
        setTimeout(() => {
            apiRequest('/api/common/metro-manila-transfer/matrix')
                .then(res => res.json())
                .then(data => {
                    cachedData = data;
                    lastFetchTime = Date.now();
                    console.log('Prefetched metro data');
                })
                .catch(err => console.log('Prefetch failed:', err));
        }, 3000);
    }
}

function showSkeleton(show) {
    const citiesContainer = document.getElementById('citiesContainer');
    const matrixBody = document.getElementById('matrixBody');
    
    if (show) {
        if (citiesContainer) {
            citiesContainer.innerHTML = `
                <div class="skeleton-card" style="width: 150px; height: 60px;"></div>
                <div class="skeleton-card" style="width: 150px; height: 60px;"></div>
                <div class="skeleton-card" style="width: 150px; height: 60px;"></div>
                <div class="skeleton-card" style="width: 150px; height: 60px;"></div>
            `;
        }
        
        if (matrixBody) {
            matrixBody.innerHTML = `
                <tr class="skeleton-row"><td colspan="10"><div class="skeleton-line" style="height: 30px;"></div>--</tr>
                <tr class="skeleton-row"><td colspan="10"><div class="skeleton-line" style="height: 30px;"></div>--</tr>
                <tr class="skeleton-row"><td colspan="10"><div class="skeleton-line" style="height: 30px;"></div>--</tr>
                <tr class="skeleton-row"><td colspan="10"><div class="skeleton-line" style="height: 30px;"></div>--</tr>
                <tr class="skeleton-row"><td colspan="10"><div class="skeleton-line" style="height: 30px;"></div>--</tr>
            `;
        }
    }
}

function showError(message) {
    const citiesContainer = document.getElementById('citiesContainer');
    const matrixBody = document.getElementById('matrixBody');
    
    if (citiesContainer) {
        citiesContainer.innerHTML = `<div class="error-state">${message}</div>`;
    }
    
    if (matrixBody) {
        matrixBody.innerHTML = `<tr><td colspan="10" class="error-state">${message}<\/td></tr>`;
    }
}

function applyCachedData() {
    if (cachedData) {
        // Sort packages: Economy first, then Comfort, then Bus
        const getPackageOrder = (name) => {
            if (name.startsWith('Economy')) return 0;
            if (name.startsWith('Comfort')) return 1;
            if (name.startsWith('Bus')) return 2;
            return 3;
        };
        
        allPackages = (cachedData.packages || []).sort((a, b) => {
            const orderA = getPackageOrder(a);
            const orderB = getPackageOrder(b);
            if (orderA !== orderB) return orderA - orderB;
            return a.localeCompare(b);
        });
        
        allCities = cachedData.cities || [];
        allRates = cachedData.rates || {};
        
        // Set default package if none selected
        if (!currentPackage && allPackages.length > 0) {
            currentPackage = allPackages[0];
        }
        
        renderCities();
        updateOriginFilter();
        updatePackageSelector();
        renderFareMatrix();
    }
}

// ========== Rendering Functions ==========

function renderCities() {
    const container = document.getElementById('citiesContainer');
    if (!container) return;
    
    if (allCities.length === 0) {
        container.innerHTML = '<div class="empty-state">No cities found. Click "Add City" to create one.</div>';
        return;
    }
    
    // Use DocumentFragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    
    allCities.forEach(city => {
        const isActive = city.isActive !== false;
        
        const cityCard = document.createElement('div');
        cityCard.className = 'city-card';
        cityCard.innerHTML = `
            <div class="city-info">
                <span class="city-name">${escapeHtml(city.name)}</span>
                <span class="city-status ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span>
            </div>
            ${userRole === 'superadmin' ? `
            <div class="city-actions">
                <button class="btn-icon-sm" onclick="editCityDiscount('${city.key}', '${escapeHtml(city.name)}')" title="Set City Discount">
                    <i class="fas fa-percent"></i>
                </button>
                <button class="btn-icon-sm" onclick="toggleCityStatus('${city.key}', ${isActive})" title="Toggle Status">
                    <i class="fas fa-power-off"></i>
                </button>
                <button class="btn-icon-sm" onclick="deleteCity('${city.key}')" title="Delete City">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            ` : ''}
        `;
        fragment.appendChild(cityCard);
    });
    
    container.innerHTML = '';
    container.appendChild(fragment);
}

function updateOriginFilter() {
    const filterSelect = document.getElementById('originFilter');
    if (!filterSelect) return;
    
    filterSelect.innerHTML = '<option value="all">All Cities</option>';
    allCities.forEach(city => {
        filterSelect.innerHTML += `<option value="${city.key}">${escapeHtml(city.name)}</option>`;
    });
    filterSelect.value = currentOriginFilter;
}

function updatePackageSelector() {
    const packageSelect = document.getElementById('packageSelector');
    if (!packageSelect) return;
    
    if (allPackages.length === 0) {
        packageSelect.innerHTML = '<option value="">No packages available</option>';
        return;
    }
    
    packageSelect.innerHTML = '';
    allPackages.forEach(pkg => {
        const option = document.createElement('option');
        option.value = pkg;
        option.textContent = pkg;
        if (pkg === currentPackage) {
            option.selected = true;
        }
        packageSelect.appendChild(option);
    });
}

function renderFareMatrix() {
    const tbody = document.getElementById('matrixBody');
    if (!tbody) return;
    
    if (allCities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">No cities available. Please add cities first.<\/td></tr>';
        return;
    }
    
    if (!currentPackage) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading packages...<\/td></tr>';
        return;
    }
    
    // Filter cities if needed
    let displayOrigins = allCities;
    if (currentOriginFilter !== 'all') {
        displayOrigins = allCities.filter(c => c.key === currentOriginFilter);
    }
    
    // Build header
    const headerRow = document.getElementById('matrixHeader');
    if (headerRow) {
        let headerHtml = '<th>Origin \\ Destination</th>';
        allCities.forEach(dest => {
            headerHtml += `<th>${escapeHtml(dest.name)}</th>`;
        });
        headerRow.innerHTML = headerHtml;
    }
    
    let bodyHtml = '';
    displayOrigins.forEach(origin => {
        bodyHtml += '<tr>';
        bodyHtml += `<td class="origin-cell"><strong>${escapeHtml(origin.name)}</strong><table>`;
        
        allCities.forEach(dest => {
            if (origin.key === dest.key) {
                bodyHtml += `<td class="price-cell disabled">—<\/td>`;
            } else {
                const routeKey = `${origin.key}_${dest.key}`;
                const routePrices = allRates[routeKey] || {};
                const originalPrice = routePrices[currentPackage] || "0";
                const originalPriceNum = parseFloat(originalPrice);
                
                // Check for city discount
                let displayHtml = '';
                let discountBadge = '';
                let hasDiscount = false;
                let discountedPriceNum = originalPriceNum;
                
                // Get discount for origin or destination city
                const originCity = allCities.find(c => c.key === origin.key);
                const destCity = allCities.find(c => c.key === dest.key);
                
                let discount = null;
                let discountSource = null;
                
                if (originCity?.discount && originCity.discount.active) {
                    discount = originCity.discount;
                    discountSource = 'origin';
                } else if (destCity?.discount && destCity.discount.active) {
                    discount = destCity.discount;
                    discountSource = 'destination';
                }
                
                if (discount && originalPriceNum > 0) {
                    hasDiscount = true;
                    if (discount.type === 'percentage') {
                        const discountAmount = originalPriceNum * (discount.value / 100);
                        discountedPriceNum = originalPriceNum - discountAmount;
                        discountBadge = `<span class="discount-indicator" title="${discount.value}% OFF">${discount.value}% OFF</span>`;
                    } else if (discount.type === 'fixed') {
                        discountedPriceNum = Math.max(0, originalPriceNum - discount.value);
                        discountBadge = `<span class="discount-indicator" title="₱${discount.value.toLocaleString()} OFF">₱${discount.value.toLocaleString()} OFF</span>`;
                    }
                }
                
                if (hasDiscount && discountedPriceNum !== originalPriceNum && originalPriceNum > 0) {
                    displayHtml = `
                        <div class="price-container">
                            <span class="original-price">₱${originalPriceNum.toLocaleString()}</span>
                            <span class="discounted-price">₱${Math.round(discountedPriceNum).toLocaleString()}</span>
                        </div>
                    `;
                } else {
                    displayHtml = `<span class="price-display">${originalPriceNum !== 0 ? `₱${originalPriceNum.toLocaleString()}` : '₱0'}</span>`;
                }
                
                bodyHtml += `
                    <td class="price-cell ${userRole === 'superadmin' ? 'editable' : ''} ${hasDiscount ? 'has-discount' : ''}" 
                        data-origin="${origin.key}"
                        data-dest="${dest.key}"
                        data-package="${currentPackage}"
                        data-price="${originalPrice}">
                        ${displayHtml}
                        ${discountBadge}
                      </td>
                `;
            }
        });
        bodyHtml += '</tr>';
    });
    
    tbody.innerHTML = bodyHtml;
    
    // Add click handlers after rendering
    if (userRole === 'superadmin') {
        document.querySelectorAll('.price-cell.editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                const origin = cell.getAttribute('data-origin');
                const dest = cell.getAttribute('data-dest');
                const packageName = cell.getAttribute('data-package');
                const currentPrice = cell.getAttribute('data-price');
                makeEditable(cell, origin, dest, packageName, currentPrice);
            });
        });
    }
}

// ========== Inline Editing Functions ==========

function makeEditable(cell, origin, dest, packageName, currentPrice) {
    if (activeEditCell === cell) return;
    if (activeEditCell) {
        cancelEdit(activeEditCell);
    }
    
    const price = parseInt(currentPrice) || 0;
    
    // Create input element
    const input = document.createElement('input');
    input.type = 'number';
    input.value = price;
    input.className = 'price-input-inline';
    input.min = 0;
    input.step = 1;
    
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
            await savePriceEdit(cell, input.value, origin, dest, packageName);
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

let activeEditCell = null;
let isSaving = false;

function cancelEdit(cell) {
    if (activeEditCell !== cell) return;
    
    const currentPrice = cell.getAttribute('data-price') || 0;
    const priceNum = parseFloat(currentPrice);
    const priceDisplay = priceNum !== 0 ? `₱${priceNum.toLocaleString()}` : '₱0';
    
    cell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
    activeEditCell = null;
}

async function savePriceEdit(cell, newValue, origin, dest, packageName) {
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
        // Update forward route
        const getForwardResponse = await apiRequest(`/api/common/metro-manila-transfer/rates/${origin}/${dest}`);
        const forwardRouteData = await getForwardResponse.json();
        const forwardPrices = forwardRouteData.prices || {};
        forwardPrices[packageName] = price.toString();
        
        await apiRequest(`/api/common/metro-manila-transfer/rates/${origin}/${dest}`, {
            method: 'PUT',
            body: JSON.stringify({ prices: forwardPrices })
        });
        
        // Update reverse route
        const getReverseResponse = await apiRequest(`/api/common/metro-manila-transfer/rates/${dest}/${origin}`);
        const reverseRouteData = await getReverseResponse.json();
        const reversePrices = reverseRouteData.prices || {};
        reversePrices[packageName] = price.toString();
        
        await apiRequest(`/api/common/metro-manila-transfer/rates/${dest}/${origin}`, {
            method: 'PUT',
            body: JSON.stringify({ prices: reversePrices })
        });
        
        // Update UI
        const priceDisplay = price !== 0 ? `₱${price.toLocaleString()}` : '₱0';
        cell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
        cell.setAttribute('data-price', price);
        
        // Update reverse cell
        const reverseCell = document.querySelector(`.price-cell[data-origin="${dest}"][data-dest="${origin}"][data-package="${packageName}"]`);
        if (reverseCell) {
            reverseCell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
            reverseCell.setAttribute('data-price', price);
        }
        
        toastSuccess(`Updated price for ${packageName} (both directions)`, 'Success');
        
        // Update cache
        if (cachedData && cachedData.rates) {
            const forwardKey = `${origin}_${dest}`;
            const reverseKey = `${dest}_${origin}`;
            if (!cachedData.rates[forwardKey]) cachedData.rates[forwardKey] = {};
            if (!cachedData.rates[reverseKey]) cachedData.rates[reverseKey] = {};
            cachedData.rates[forwardKey][packageName] = price.toString();
            cachedData.rates[reverseKey][packageName] = price.toString();
        }
        
        // Refresh matrix to show updated discounts
        renderFareMatrix();
        
    } catch (error) {
        console.error('Error saving price:', error);
        toastError('An unexpected error occurred', 'Error');
        cancelEdit(cell);
    } finally {
        isSaving = false;
    }
}

// ========== City Discount Functions ==========

async function editCityDiscount(cityKey, cityName) {
    currentCityDiscountKey = cityKey;
    currentCityDiscountName = cityName;
    
    const modal = document.getElementById('cityDiscountModal');
    if (!modal) return;
    
    document.getElementById('cityDiscountModalTitle').textContent = `Set Discount for City: ${cityName}`;
    document.getElementById('cityDiscountKey').value = cityKey;
    
    // Check if city already has a discount
    try {
        const response = await apiRequest(`/api/common/metro-manila-transfer/cities/${cityKey}/discount`);
        const data = await response.json();
        
        if (data.hasDiscount) {
            document.getElementById('cityDiscountType').value = data.discount.type || 'percentage';
            document.getElementById('cityDiscountValue').value = data.discount.value || '';
            document.getElementById('cityDiscountDescription').value = data.discount.description || '';
            document.getElementById('cityDiscountValidUntil').value = data.discount.validUntil || '';
        } else {
            document.getElementById('cityDiscountForm').reset();
            document.getElementById('cityDiscountType').value = 'percentage';
        }
    } catch (error) {
        document.getElementById('cityDiscountForm').reset();
        document.getElementById('cityDiscountType').value = 'percentage';
    }
    
    modal.style.display = 'flex';
}

function closeCityDiscountModal() {
    const modal = document.getElementById('cityDiscountModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentCityDiscountKey = null;
    currentCityDiscountName = null;
}

async function saveCityDiscount(e) {
    e.preventDefault();
    
    const cityKey = document.getElementById('cityDiscountKey').value;
    const discountType = document.getElementById('cityDiscountType').value;
    const discountValue = document.getElementById('cityDiscountValue').value;
    const description = document.getElementById('cityDiscountDescription').value;
    const validUntil = document.getElementById('cityDiscountValidUntil').value;
    
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
        const response = await apiRequest(`/api/common/metro-manila-transfer/cities/${cityKey}/discount`, {
            method: 'POST',
            body: JSON.stringify({
                type: discountType,
                value: discountValue,
                description,
                validUntil
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(`Discount applied to all routes ${discountType === 'percentage' ? `(${discountValue}% OFF)` : `(₱${parseFloat(discountValue).toLocaleString()} OFF)`} for ${currentCityDiscountName}!`, 'Success');
            closeCityDiscountModal();
            cachedData = null;
            loadData(true);
        } else {
            toastError(data.error || 'Failed to apply discount', 'Error');
        }
    } catch (error) {
        console.error('Error saving city discount:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

async function removeCityDiscount() {
    if (!currentCityDiscountKey) return;
    
    showConfirmModal({
        title: 'Remove City Discount',
        message: `Are you sure you want to remove the discount for city "${currentCityDiscountName}"? This will remove discounts from all routes involving this city.`,
        confirmText: 'Remove',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/metro-manila-transfer/cities/${currentCityDiscountKey}/discount`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess('City discount removed successfully', 'Success');
                    closeCityDiscountModal();
                    cachedData = null;
                    loadData(true);
                } else {
                    toastError(data.error || 'Failed to remove city discount', 'Error');
                }
            } catch (error) {
                console.error('Error removing city discount:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

// ========== Event Listeners ==========

function setupEventListeners() {
    // Add City button
    document.getElementById('addCityBtn')?.addEventListener('click', () => openCityModal());
    
    // Origin filter
    const originFilter = document.getElementById('originFilter');
    if (originFilter) {
        originFilter.addEventListener('change', function() {
            currentOriginFilter = this.value;
            renderFareMatrix();
        });
    }
    
    // Package selector
    const packageSelector = document.getElementById('packageSelector');
    if (packageSelector) {
        packageSelector.addEventListener('change', function() {
            currentPackage = this.value;
            renderFareMatrix();
        });
    }
    
    // Modal close buttons
    document.getElementById('closeCityModal')?.addEventListener('click', closeCityModal);
    document.getElementById('cancelCityBtn')?.addEventListener('click', closeCityModal);
    document.getElementById('cityForm')?.addEventListener('submit', saveCity);
    
    document.getElementById('closePricesModal')?.addEventListener('click', closePricesModal);
    document.getElementById('cancelPricesBtn')?.addEventListener('click', closePricesModal);
    document.getElementById('pricesForm')?.addEventListener('submit', saveRoutePrice);
    
    // City Discount Modal
    document.getElementById('closeCityDiscountModal')?.addEventListener('click', closeCityDiscountModal);
    document.getElementById('cancelCityDiscountBtn')?.addEventListener('click', closeCityDiscountModal);
    document.getElementById('cityDiscountForm')?.addEventListener('submit', saveCityDiscount);
    
    // Close modals on outside click
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('cityModal')) closeCityModal();
        if (e.target === document.getElementById('pricesModal')) closePricesModal();
        if (e.target === document.getElementById('cityDiscountModal')) closeCityDiscountModal();
    });
}

// ========== City Functions ==========

function openCityModal() {
    document.getElementById('cityModal').style.display = 'flex';
    document.getElementById('cityName').value = '';
}

function closeCityModal() {
    document.getElementById('cityModal').style.display = 'none';
    document.getElementById('cityForm').reset();
}

async function saveCity(e) {
    e.preventDefault();
    const cityName = document.getElementById('cityName').value.trim();
    
    if (!cityName) {
        toastError('City name is required', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    try {
        const response = await apiRequest('/api/common/metro-manila-transfer/cities', {
            method: 'POST',
            body: JSON.stringify({ name: cityName })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(data.message, 'Success');
            closeCityModal();
            cachedData = null;
            loadData(true);
        } else {
            toastError(data.error || 'Failed to save city', 'Error');
        }
    } catch (error) {
        console.error('Error saving city:', error);
        toastError('An unexpected error occurred', 'Error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

async function deleteCity(cityKey) {
    showConfirmModal({
        title: 'Delete City',
        message: 'Are you sure you want to delete this city? All routes involving this city will also be deleted.',
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/metro-manila-transfer/cities/${cityKey}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess(data.message, 'Deleted');
                    cachedData = null;
                    loadData(true);
                } else {
                    toastError(data.error || 'Failed to delete city', 'Error');
                }
            } catch (error) {
                console.error('Error deleting city:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

async function toggleCityStatus(cityKey, currentStatus) {
    try {
        const response = await apiRequest(`/api/common/metro-manila-transfer/cities/${cityKey}/toggle`, {
            method: 'PATCH'
        });
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(data.message, 'Status Updated');
            cachedData = null;
            loadData(true);
        } else {
            toastError(data.error || 'Failed to toggle status', 'Error');
        }
    } catch (error) {
        console.error('Error toggling city status:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

// ========== Route Price Functions (Legacy) ==========

function closePricesModal() {
    document.getElementById('pricesModal').style.display = 'none';
    document.getElementById('pricesForm').reset();
}

async function saveRoutePrice(e) {
    e.preventDefault();
    
    const origin = document.getElementById('pricesOrigin').value;
    const destination = document.getElementById('pricesDestination').value;
    const price = parseInt(document.getElementById('singlePriceInput').value);
    
    if (isNaN(price) || price < 0) {
        toastError('Please enter a valid price (0 or greater)', 'Invalid Input');
        return;
    }
    
    try {
        const response = await apiRequest(`/api/common/metro-manila-transfer/rates/${origin}/${destination}`, {
            method: 'PUT',
            body: JSON.stringify({ 
                prices: { [currentPackage]: price.toString() }
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            toastSuccess(data.message, 'Success');
            closePricesModal();
            cachedData = null;
            loadData(true);
        } else {
            toastError(data.error || 'Failed to save price', 'Error');
        }
    } catch (error) {
        console.error('Error saving price:', error);
        toastError('An unexpected error occurred', 'Error');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}