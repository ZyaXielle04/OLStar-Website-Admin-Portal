// ============================================
// Metro Manila Transfer Rates Management - FULLY OPTIMIZED
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

const CACHE_DURATION = 30000; // 30 seconds cache
const DEBOUNCE_DELAY = 300;
const userRole = document.querySelector('.user-role')?.innerText?.toLowerCase() || 'admin';

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
        
        const response = await fetch('/api/common/metro-manila-transfer/matrix', {
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
            fetch('/api/common/metro-manila-transfer/matrix')
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
            <span class="city-name">${escapeHtml(city.name)}</span>
            <span class="city-status ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span>
            ${userRole === 'superadmin' ? `
            <div class="city-actions">
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
    
    // Use DocumentFragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('tbody');
    
    let bodyHtml = '';
    displayOrigins.forEach(origin => {
        bodyHtml += '<tr>';
        bodyHtml += `<td class="origin-cell"><strong>${escapeHtml(origin.name)}</strong></td>`;
        
        allCities.forEach(dest => {
            if (origin.key === dest.key) {
                bodyHtml += `<td class="price-cell disabled">—<\/td>`;
            } else {
                const routeKey = `${origin.key}_${dest.key}`;
                const routePrices = allRates[routeKey] || {};
                const price = routePrices[currentPackage] || "0";
                const priceDisplay = price !== "0" ? `₱${parseInt(price).toLocaleString()}` : '₱0';
                
                bodyHtml += `
                    <td class="price-cell ${userRole === 'superadmin' ? 'editable' : ''}" 
                        data-origin="${origin.key}"
                        data-dest="${dest.key}"
                        data-package="${currentPackage}"
                        data-price="${price}"
                        onclick="${userRole === 'superadmin' ? `editRoutePrice('${origin.key}', '${dest.key}', '${currentPackage}', ${price})` : ''}">
                        <span class="price-display">${priceDisplay}</span>
                     <\/td>
                `;
            }
        });
        bodyHtml += '</tr>';
    });
    
    tbody.innerHTML = bodyHtml;
}

// ========== Event Listeners ==========

function setupEventListeners() {
    // Add City button
    document.getElementById('addCityBtn')?.addEventListener('click', () => openCityModal());
    
    // Origin filter with debounce (though change doesn't need debounce)
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
    
    // Close modals on outside click
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('cityModal')) closeCityModal();
        if (e.target === document.getElementById('pricesModal')) closePricesModal();
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
    
    // Disable submit button
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    try {
        const response = await fetch('/api/common/metro-manila-transfer/cities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
                const response = await fetch(`/api/common/metro-manila-transfer/cities/${cityKey}`, {
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
        const response = await fetch(`/api/common/metro-manila-transfer/cities/${cityKey}/toggle`, {
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

// ========== Route Price Functions ==========

async function editRoutePrice(originKey, destKey, packageName, currentPrice) {
    const cell = event.currentTarget;
    const originalContent = cell.innerHTML;
    
    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentPrice;
    input.className = 'price-input-inline';
    input.min = 0;
    input.step = 1;
    
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    
    const savePrice = async () => {
        const newPrice = parseInt(input.value);
        
        if (isNaN(newPrice) || newPrice < 0) {
            toastError('Please enter a valid price (0 or greater)', 'Invalid Input');
            cell.innerHTML = originalContent;
            return;
        }
        
        cell.innerHTML = '<div class="price-loading"><i class="fas fa-spinner fa-spin"></i></div>';
        
        try {
            // Update forward route
            const getForwardResponse = await fetch(`/api/common/metro-manila-transfer/rates/${originKey}/${destKey}`, {
                credentials: 'include'
            });
            const forwardRouteData = await getForwardResponse.json();
            const forwardPrices = forwardRouteData.prices || {};
            forwardPrices[packageName] = newPrice.toString();
            
            await fetch(`/api/common/metro-manila-transfer/rates/${originKey}/${destKey}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prices: forwardPrices })
            });
            
            // Update reverse route
            const getReverseResponse = await fetch(`/api/common/metro-manila-transfer/rates/${destKey}/${originKey}`, {
                credentials: 'include'
            });
            const reverseRouteData = await getReverseResponse.json();
            const reversePrices = reverseRouteData.prices || {};
            reversePrices[packageName] = newPrice.toString();
            
            await fetch(`/api/common/metro-manila-transfer/rates/${destKey}/${originKey}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prices: reversePrices })
            });
            
            // Update UI
            const priceDisplay = newPrice !== 0 ? `₱${newPrice.toLocaleString()}` : '₱0';
            cell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
            cell.setAttribute('data-price', newPrice);
            
            // Update reverse cell
            const reverseCell = document.querySelector(`.price-cell[data-origin="${destKey}"][data-dest="${originKey}"][data-package="${packageName}"]`);
            if (reverseCell) {
                reverseCell.innerHTML = `<span class="price-display">${priceDisplay}</span>`;
                reverseCell.setAttribute('data-price', newPrice);
            }
            
            toastSuccess(`Updated price for ${packageName} (both directions)`, 'Success');
            
            // Update cache
            if (cachedData && cachedData.rates) {
                const forwardKey = `${originKey}_${destKey}`;
                const reverseKey = `${destKey}_${originKey}`;
                if (!cachedData.rates[forwardKey]) cachedData.rates[forwardKey] = {};
                if (!cachedData.rates[reverseKey]) cachedData.rates[reverseKey] = {};
                cachedData.rates[forwardKey][packageName] = newPrice.toString();
                cachedData.rates[reverseKey][packageName] = newPrice.toString();
            }
            
        } catch (error) {
            console.error('Error saving price:', error);
            toastError('An unexpected error occurred', 'Error');
            cell.innerHTML = originalContent;
        }
    };
    
    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('blur', handleBlur);
            savePrice();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('blur', handleBlur);
            cell.innerHTML = originalContent;
        }
    };
    
    const handleBlur = () => {
        input.removeEventListener('keydown', handleKeydown);
        input.removeEventListener('blur', handleBlur);
        savePrice();
    };
    
    input.addEventListener('keydown', handleKeydown);
    input.addEventListener('blur', handleBlur);
}

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
        const response = await fetch(`/api/common/metro-manila-transfer/rates/${origin}/${destination}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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