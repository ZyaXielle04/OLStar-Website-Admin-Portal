// car-rental-self-drive.js - Self-Drive specific logic with CSRF support and Discounts
(function() {
    'use strict';
    
    if (window.selfDriveInitialized) return;
    
    let currentData = {
        transportUnits: [],
        durations: [],
        prices: {},           // Original prices from /prices
        discountedPrices: {}, // Discounted prices from /discountedPrices
        locations: []
    };
    
    let currentPage = 1;
    let itemsPerPage = 10;
    let currentPickupLocation = null;
    let currentDropoffLocation = null;
    let currentUnitTypeFilter = 'all';
    let availableUnitTypes = [];
    let sessionRole = null;
    let currentDiscountData = null;
    
    const API_BASE_URL = '/api/common/car-rental';
    
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
        
        const defaultHeaders = {
            'Content-Type': 'application/json',
        };
        
        if (method !== 'GET' && csrfToken) {
            defaultHeaders['X-CSRFToken'] = csrfToken;
        }
        
        const config = {
            ...options,
            method,
            headers: {
                ...defaultHeaders,
                ...options.headers
            },
            credentials: 'include'
        };
        
        return fetch(url, config);
    }
    
    function showNotification(message, type = 'success') {
        if (typeof window.showNotificationGlobal === 'function') {
            window.showNotificationGlobal(message, type);
            return;
        }
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    async function getSessionRole() {
        try {
            const response = await apiRequest('/api/v1/auth/session/check');
            const data = await response.json();
            if (data.authenticated && data.user && data.user.role) {
                return data.user.role;
            }
            return null;
        } catch (error) {
            console.error('Error getting session role:', error);
            return null;
        }
    }
    
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'flex';
    }
    
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    }
    
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function formatNumber(value) {
        if (!value || value === '0') return '0';
        return parseInt(value).toLocaleString();
    }
    
    function formatPriceWithDiscount(originalPrice, discountedPrice, hasDiscount) {
        if (hasDiscount && discountedPrice !== originalPrice && originalPrice > 0) {
            return `
                <div class="price-container">
                    <span class="original-price">₱${formatNumber(originalPrice)}</span>
                    <span class="discounted-price">₱${formatNumber(discountedPrice)}</span>
                </div>
            `;
        }
        return `<span class="price-display">₱${formatNumber(originalPrice)}</span>`;
    }

    // Custom confirmation modal
    function showConfirmModal(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            
            const uniqueId = 'confirm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.maxWidth = '400px';
            
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>${escapeHtml(title)}</h3>
                    <button class="modal-close" data-close="${uniqueId}">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 1.5rem;">${escapeHtml(message)}</p>
                </div>
                <div class="modal-buttons" style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <button class="btn btn-secondary" data-cancel="${uniqueId}">${escapeHtml(cancelText)}</button>
                    <button class="btn btn-danger" data-confirm="${uniqueId}" style="background-color: #DC2626; color: white;">${escapeHtml(confirmText)}</button>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            const complete = (result) => {
                if (overlay && overlay.remove) {
                    overlay.remove();
                }
                resolve(result);
            };
            
            const closeBtn = modal.querySelector(`[data-close="${uniqueId}"]`);
            const cancelBtn = modal.querySelector(`[data-cancel="${uniqueId}"]`);
            const confirmBtn = modal.querySelector(`[data-confirm="${uniqueId}"]`);
            
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    complete(false);
                });
            }
            
            if (cancelBtn) {
                cancelBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    complete(false);
                });
            }
            
            if (confirmBtn) {
                confirmBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    complete(true);
                });
            }
            
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    complete(false);
                }
            });
        });
    }
    
    // ========== LOCATIONS ==========
    
    async function loadLocations() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/locations`);
            if (!response.ok) throw new Error('Failed to load locations');
            const data = await response.json();
            currentData.locations = data.locations;
            displayLocations(data.locations);
            updateLocationSelects();
            
            if (currentPickupLocation) {
                updateDropoffSelect();
            }
        } catch (error) {
            console.error('Error loading locations:', error);
            showNotification('Failed to load locations', 'error');
        }
    }
    
    function displayLocations(locations) {
        const container = document.getElementById('locationsContainer');
        if (!container) return;
        
        if (!locations || locations.length === 0) {
            container.innerHTML = '<div class="empty-state">No locations found. Add your first location!</div>';
            return;
        }
        
        const isSuperadmin = sessionRole === 'superadmin';
        
        container.innerHTML = locations.map(location => `
            <div class="location-card">
                <div>
                    <span class="location-name">${escapeHtml(location.name)}</span>
                    <span class="delivery-fee-badge">🚚 Delivery: ₱${formatNumber(location.deliveryFeeFromPasay)} from Pasay</span>
                </div>
                <span class="location-status ${location.isActive ? 'active' : 'inactive'}">
                    ${location.isActive ? 'Active' : 'Inactive'}
                </span>
                <div class="location-actions">
                    ${isSuperadmin ? `
                        <button class="btn-icon-sm" onclick="window.selfDrive.editLocation('${location.key}')"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon-sm" onclick="window.selfDrive.toggleLocation('${location.key}')"><i class="fas ${location.isActive ? 'fa-ban' : 'fa-check-circle'}"></i></button>
                        <button class="btn-icon-sm" onclick="window.selfDrive.deleteLocation('${location.key}')"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }
    
    function updateLocationSelects() {
        const pickupSelect = document.getElementById('pickupLocationSelect');
        const dropoffSelect = document.getElementById('dropoffLocationSelect');
        
        if (pickupSelect && dropoffSelect && currentData.locations) {
            const activeLocations = currentData.locations.filter(l => {
                const isActive = l.isActive === true || l.isActive === 'true';
                return isActive;
            });
            
            let pickupOptions = '<option value="">-- Select Pickup Location --</option>';
            activeLocations.forEach(loc => {
                pickupOptions += `<option value="${loc.key}">${escapeHtml(loc.name)} (Delivery: ₱${formatNumber(loc.deliveryFeeFromPasay)})</option>`;
            });
            pickupSelect.innerHTML = pickupOptions;
            
            if (!currentPickupLocation) {
                dropoffSelect.innerHTML = '<option value="same">-- Same as Pickup Location --</option>';
            } else {
                updateDropoffSelect();
            }
        }
    }
    
    function updateDropoffSelect() {
        const dropoffSelect = document.getElementById('dropoffLocationSelect');
        if (!dropoffSelect || !currentData.locations || !currentPickupLocation) return;
        
        const otherLocations = currentData.locations.filter(l => {
            let isActive = true;
            if (l.isActive !== undefined) {
                if (typeof l.isActive === 'boolean') {
                    isActive = l.isActive;
                } else if (typeof l.isActive === 'string') {
                    isActive = l.isActive.toLowerCase() === 'true';
                }
            }
            return isActive && l.key !== currentPickupLocation;
        });
        
        let options = '<option value="same">-- Same as Pickup Location --</option>';
        
        otherLocations.forEach(loc => {
            options += `<option value="${loc.key}">${escapeHtml(loc.name)}</option>`;
        });
        
        if (otherLocations.length === 0) {
            options += '<option value="" disabled>-- No other locations available --</option>';
        }
        
        dropoffSelect.innerHTML = options;
    }
    
    async function addOrUpdateLocation() {
        const key = document.getElementById('locationKey').value;
        const name = document.getElementById('locationName').value.trim();
        const deliveryFeeFromPasay = parseInt(document.getElementById('deliveryFeeFromPasay').value) || 0;
        
        if (!name) {
            showNotification('Location name is required', 'error');
            return;
        }
        
        try {
            let response;
            if (key) {
                response = await apiRequest(`${API_BASE_URL}/locations/${key}`, {
                    method: 'PUT',
                    body: JSON.stringify({ name, deliveryFeeFromPasay })
                });
            } else {
                response = await apiRequest(`${API_BASE_URL}/locations`, {
                    method: 'POST',
                    body: JSON.stringify({ name, deliveryFeeFromPasay })
                });
            }
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save location');
            }
            
            showNotification(key ? 'Location updated' : 'Location added');
            closeModal('locationModal');
            resetLocationForm();
            await loadLocations();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }
    
    function resetLocationForm() {
        document.getElementById('locationKey').value = '';
        document.getElementById('locationName').value = '';
        document.getElementById('deliveryFeeFromPasay').value = '0';
        document.getElementById('locationModalTitle').textContent = 'Add Location';
    }
    
    function editLocation(locationKey) {
        const location = currentData.locations.find(l => l.key === locationKey);
        if (location) {
            document.getElementById('locationKey').value = location.key;
            document.getElementById('locationName').value = location.name;
            document.getElementById('deliveryFeeFromPasay').value = location.deliveryFeeFromPasay || 0;
            document.getElementById('locationModalTitle').textContent = 'Edit Location';
            openModal('locationModal');
        }
    }
    
    async function toggleLocation(locationKey) {
        try {
            const response = await apiRequest(`${API_BASE_URL}/locations/${locationKey}/toggle`, { method: 'PATCH' });
            if (!response.ok) throw new Error('Failed to toggle location');
            const data = await response.json();
            showNotification(data.message);
            await loadLocations();
        } catch (error) {
            showNotification('Failed to toggle location', 'error');
        }
    }
    
    async function deleteLocation(locationKey) {
        const confirmed = await showConfirmModal(
            'Delete Location',
            `Are you sure you want to delete this location? This action cannot be undone.`,
            'Delete',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/locations/${locationKey}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete location');
            showNotification('Location deleted successfully');
            await loadLocations();
        } catch (error) {
            showNotification('Failed to delete location', 'error');
        }
    }
    
    // ========== DURATIONS ==========
    
    async function loadDurations() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/durations`);
            if (!response.ok) throw new Error('Failed to load durations');
            const data = await response.json();
            currentData.durations = data.durations;
            displayDurations(data.durations);
        } catch (error) {
            console.error('Error loading durations:', error);
            showNotification('Failed to load durations', 'error');
        }
    }
    
    function displayDurations(durations) {
        const container = document.getElementById('durationsContainer');
        if (!container) return;
        
        if (!durations || durations.length === 0) {
            container.innerHTML = '<div class="empty-state">No durations found. Add your first duration!</div>';
            return;
        }
        
        const isSuperadmin = sessionRole === 'superadmin';
        const sortedDurations = [...durations].sort((a, b) => a.hours - b.hours);
        
        container.innerHTML = sortedDurations.map(duration => `
            <div class="duration-card">
                <div>
                    <span class="duration-name">${escapeHtml(duration.name)}</span>
                    <span class="location-hours">(${duration.hours} hours)</span>
                </div>
                <span class="duration-status ${duration.isActive ? 'active' : 'inactive'}">
                    ${duration.isActive ? 'Active' : 'Inactive'}
                </span>
                <div class="duration-actions">
                    ${isSuperadmin ? `
                        <button class="btn-icon-sm" onclick="window.selfDrive.toggleDuration('${duration.key}')"><i class="fas ${duration.isActive ? 'fa-ban' : 'fa-check-circle'}"></i></button>
                        <button class="btn-icon-sm" onclick="window.selfDrive.deleteDuration('${duration.key}')"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }
    
    async function addDuration() {
        const name = document.getElementById('durationName').value.trim();
        const hours = parseInt(document.getElementById('durationHours').value);
        
        if (!name || !hours || hours <= 0) {
            showNotification('Duration name and valid hours are required', 'error');
            return;
        }
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/durations`, {
                method: 'POST',
                body: JSON.stringify({ name, hours })
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add duration');
            }
            showNotification('Duration added');
            closeModal('durationModal');
            document.getElementById('durationName').value = '';
            document.getElementById('durationHours').value = '';
            await loadDurations();
            await loadRateTableData();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }
    
    async function toggleDuration(durationKey) {
        try {
            const response = await apiRequest(`${API_BASE_URL}/durations/${durationKey}/toggle`, { method: 'PATCH' });
            if (!response.ok) throw new Error('Failed to toggle duration');
            const data = await response.json();
            showNotification(data.message);
            await loadDurations();
            await loadRateTableData();
        } catch (error) {
            showNotification('Failed to toggle duration', 'error');
        }
    }
    
    async function deleteDuration(durationKey) {
        const confirmed = await showConfirmModal(
            'Delete Duration',
            `Are you sure you want to delete this duration? This action cannot be undone.`,
            'Delete',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/durations/${durationKey}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete duration');
            showNotification('Duration deleted successfully');
            await loadDurations();
            await loadRateTableData();
        } catch (error) {
            showNotification('Failed to delete duration', 'error');
        }
    }
    
    // ========== TRANSPORT UNITS ==========
    
    async function loadTransportUnits() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/transport-units`);
            if (!response.ok) throw new Error('Failed to load transport units');
            const data = await response.json();
            currentData.transportUnits = data.transportUnits;
        } catch (error) {
            console.error('Error loading transport units:', error);
            showNotification('Failed to load transport units', 'error');
        }
    }
    
    // ========== DISCOUNT MANAGEMENT ==========
    
    async function loadDiscountSettings() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/discount`);
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
                ${sessionRole === 'superadmin' ? `
                <div class="discount-actions" style="margin-top: 0.75rem;">
                    <button class="btn-icon-sm" onclick="window.selfDrive.openDiscountModal()">
                        <i class="fas fa-edit"></i> Edit Discount
                    </button>
                    <button class="btn-icon-sm btn-danger" onclick="window.selfDrive.removeGlobalDiscount()">
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
                <small>Click Manage Discount to add a global discount that will apply to all rates</small>
                ${sessionRole === 'superadmin' ? `
                <div class="discount-actions" style="margin-top: 0.75rem;">
                    <button class="btn-icon-sm" onclick="window.selfDrive.openDiscountModal()">
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
            const form = document.getElementById('discountForm');
            if (form) form.reset();
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
        const applyToAll = document.getElementById('applyToAll')?.checked || false;
        
        if (!discountValue) {
            showNotification('Discount value is required', 'error');
            return;
        }
        
        const valueNum = parseFloat(discountValue);
        if (discountType === 'percentage' && (valueNum < 0 || valueNum > 100)) {
            showNotification('Percentage must be between 0 and 100', 'error');
            return;
        }
        
        if (discountType === 'fixed' && valueNum < 0) {
            showNotification('Fixed discount cannot be negative', 'error');
            return;
        }
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/discount`, {
                method: 'POST',
                body: JSON.stringify({
                    discountType,
                    value: discountValue,
                    description,
                    validUntil,
                    applyToAll
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showNotification('Global discount applied successfully!', 'success');
                closeDiscountModal();
                await loadDiscountSettings();
                await loadRateTableData();
            } else {
                showNotification(data.error || 'Failed to save discount settings', 'error');
            }
        } catch (error) {
            console.error('Error saving discount:', error);
            showNotification('An unexpected error occurred', 'error');
        }
    }
    
    async function removeGlobalDiscount() {
        const confirmed = await showConfirmModal(
            'Remove Global Discount',
            'Are you sure you want to remove the global discount? This will remove discount from all rates.',
            'Remove',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/discount?removeFromRates=true`, {
                method: 'DELETE'
            });
            const data = await response.json();
            
            if (response.ok) {
                showNotification('Global discount removed successfully', 'success');
                await loadDiscountSettings();
                await loadRateTableData();
            } else {
                showNotification(data.error || 'Failed to remove discount', 'error');
            }
        } catch (error) {
            console.error('Error removing discount:', error);
            showNotification('An unexpected error occurred', 'error');
        }
    }
    
    // ========== UNIT TYPE FILTER ==========
    
    function extractUnitTypes() {
        const unitTypesSet = new Set();
        currentData.transportUnits.forEach(unit => {
            if (unit.unitType && unit.unitType.trim() !== '') {
                unitTypesSet.add(unit.unitType);
            }
        });
        availableUnitTypes = Array.from(unitTypesSet).sort();
        updateUnitTypeFilterSelect();
    }
    
    function updateUnitTypeFilterSelect() {
        const filterSelect = document.getElementById('unitTypeFilterSelect');
        if (!filterSelect) return;
        
        let options = '<option value="all">-- All Unit Types --</option>';
        availableUnitTypes.forEach(unitType => {
            options += `<option value="${escapeHtml(unitType)}">${escapeHtml(unitType)}</option>`;
        });
        filterSelect.innerHTML = options;
    }
    
    function getFilteredTransportUnits() {
        if (currentUnitTypeFilter === 'all') {
            return currentData.transportUnits;
        }
        return currentData.transportUnits.filter(unit => 
            unit.unitType === currentUnitTypeFilter
        );
    }
    
    function initializeUnitTypeFilter() {
        const filterSelect = document.getElementById('unitTypeFilterSelect');
        if (!filterSelect) return;
        
        filterSelect.addEventListener('change', (e) => {
            currentUnitTypeFilter = e.target.value;
            currentPage = 1;
            renderRateTable();
        });
    }
    
    // ========== RATES ==========
    
    async function loadRateTableData() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/table-data`);
            if (!response.ok) throw new Error('Failed to load table data');
            const data = await response.json();
            currentData.transportUnits = data.transportUnits;
            currentData.durations = data.durations;
            currentData.prices = data.prices || {};           // Original prices
            currentData.discountedPrices = data.discountedPrices || {}; // Discounted prices
            currentData.locations = data.locations;
            
            if (data.discount) {
                currentDiscountData = data.discount;
                renderDiscountInfo(currentDiscountData);
            }
            
            extractUnitTypes();
            
            currentPage = 1;
            renderRateTable();
        } catch (error) {
            console.error('Error loading table data:', error);
            showNotification('Failed to load rate table', 'error');
        }
    }
    
    function getDeliveryFee(locationKey) {
        const location = currentData.locations.find(l => l.key === locationKey);
        return location ? location.deliveryFeeFromPasay : 0;
    }
    
    // Get the display rate (prefer discounted price if available, otherwise original)
    function getDisplayRate(unitId, rateType, locationKey, durationKey) {
        // First try to get discounted price
        if (currentData.discountedPrices[unitId] && 
            currentData.discountedPrices[unitId][rateType] && 
            currentData.discountedPrices[unitId][rateType][locationKey] && 
            currentData.discountedPrices[unitId][rateType][locationKey][durationKey]) {
            return parseInt(currentData.discountedPrices[unitId][rateType][locationKey][durationKey]);
        }
        
        // Fall back to original price
        if (currentData.prices[unitId] && 
            currentData.prices[unitId][rateType] && 
            currentData.prices[unitId][rateType][locationKey] && 
            currentData.prices[unitId][rateType][locationKey][durationKey]) {
            return parseInt(currentData.prices[unitId][rateType][locationKey][durationKey]);
        }
        return 0;
    }
    
    // Get the original price for display (strikethrough)
    function getOriginalPrice(unitId, rateType, locationKey, durationKey) {
        if (currentData.prices[unitId] && 
            currentData.prices[unitId][rateType] && 
            currentData.prices[unitId][rateType][locationKey] && 
            currentData.prices[unitId][rateType][locationKey][durationKey]) {
            return parseInt(currentData.prices[unitId][rateType][locationKey][durationKey]);
        }
        return 0;
    }
    
    // Check if a discounted price exists for this rate
    function hasDiscountedPrice(unitId, rateType, locationKey, durationKey) {
        return currentData.discountedPrices[unitId] && 
               currentData.discountedPrices[unitId][rateType] && 
               currentData.discountedPrices[unitId][rateType][locationKey] && 
               currentData.discountedPrices[unitId][rateType][locationKey][durationKey];
    }
    
    function renderRateTable() {
        const tbody = document.getElementById('tableBody');
        const thead = document.getElementById('tableHeader');
        
        const filteredUnits = getFilteredTransportUnits();
        
        if (filteredUnits.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No transport units match the selected filter</td></tr>';
            return;
        }
        
        if (!currentData.durations || currentData.durations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No durations available</td></tr>';
            return;
        }
        
        if (!currentPickupLocation) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">Please select a pickup location to view rates</td></tr>';
            return;
        }
        
        const activeDurations = currentData.durations
            .filter(d => d.isActive !== false)
            .sort((a, b) => a.hours - b.hours);
        
        const isDifferentLocation = currentDropoffLocation && currentDropoffLocation !== 'same';
        const rateType = isDifferentLocation ? 'different_location' : 'same_location';
        
        let rateLocationKey;
        if (isDifferentLocation) {
            rateLocationKey = `${currentPickupLocation}_to_${currentDropoffLocation}`;
        } else {
            rateLocationKey = currentPickupLocation;
        }
        
        const deliveryFee = getDeliveryFee(currentPickupLocation);
        
        thead.innerHTML = `
            <tr>
                <th>Transport Unit</th>
                ${activeDurations.map(d => `<th>${escapeHtml(d.name)}<br><small>(${d.hours} hrs)</small></th>`).join('')}
            </tr>
        `;
        
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedUnits = filteredUnits.slice(startIndex, endIndex);
        const totalPages = Math.ceil(filteredUnits.length / itemsPerPage);
        
        const paginationInfo = document.getElementById('paginationInfo');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        
        if (paginationInfo) {
            paginationInfo.textContent = `Page ${currentPage} of ${totalPages || 1} (${filteredUnits.length} total units)`;
        }
        if (prevBtn) prevBtn.disabled = currentPage === 1;
        if (nextBtn) nextBtn.disabled = currentPage === totalPages || totalPages === 0;
        
        const calculationText = document.getElementById('calculationText');
        const pickupLocationObj = currentData.locations.find(l => l.key === currentPickupLocation);
        const pickupName = pickupLocationObj?.name || currentPickupLocation;
        
        if (isDifferentLocation) {
            const dropoffLocationObj = currentData.locations.find(l => l.key === currentDropoffLocation);
            const dropoffName = dropoffLocationObj?.name || currentDropoffLocation;
            calculationText.innerHTML = `🚗 ${pickupName} → ${dropoffName} (Different locations): Rental Rate + Delivery Fee (₱${formatNumber(deliveryFee)} from Pasay to ${pickupName})`;
        } else {
            calculationText.innerHTML = `📍 ${pickupName} (Same pickup/dropoff): Rental Rate + Delivery Fee (₱${formatNumber(deliveryFee)} from Pasay to ${pickupName})`;
        }
        
        let rowsHtml = '';
        
        for (const unit of paginatedUnits) {
            rowsHtml += '<tr>';
            rowsHtml += `<td>
                <div class="unit-name">${escapeHtml(unit.name)}</div>
                <div class="unit-details">${escapeHtml(unit.unitType)} | ${escapeHtml(unit.plateNumber)}</div>
             </div>`;
            
            for (const duration of activeDurations) {
                const hourKey = duration.key;
                const originalPrice = getOriginalPrice(unit.id, rateType, rateLocationKey, hourKey);
                const displayRate = getDisplayRate(unit.id, rateType, rateLocationKey, hourKey);
                const hasDiscount = hasDiscountedPrice(unit.id, rateType, rateLocationKey, hourKey);
                
                let discountBadge = '';
                if (hasDiscount && originalPrice > 0 && displayRate !== originalPrice) {
                    // Find discount info from currentDiscountData
                    if (currentDiscountData) {
                        const discountValue = currentDiscountData.discountType === 'percentage' 
                            ? `${currentDiscountData.value}% OFF`
                            : `₱${parseFloat(currentDiscountData.value).toLocaleString()} OFF`;
                        discountBadge = `<span class="discount-indicator" title="${discountValue}">${discountValue}</span>`;
                    }
                }
                
                const totalPrice = displayRate + deliveryFee;
                const priceHtml = formatPriceWithDiscount(originalPrice, displayRate, hasDiscount && displayRate !== originalPrice);
                
                rowsHtml += `<td class="rate-price ${hasDiscount ? 'has-discount' : ''}" 
                    data-unit-id="${unit.id}" 
                    data-rate-type="${rateType}" 
                    data-location-key="${rateLocationKey}" 
                    data-duration-key="${hourKey}" 
                    data-current-rate="${originalPrice}">
                    <div class="price-info">
                        ${priceHtml}
                        ${discountBadge}
                        <div class="total-price-info">
                            <strong>Total: ₱${formatNumber(totalPrice)}</strong>
                            <span class="price-breakdown">+ ₱${formatNumber(deliveryFee)} delivery</span>
                        </div>
                    </div>
                 </td>`;
            }
            
            rowsHtml += '</tr>';
        }
        
        tbody.innerHTML = rowsHtml;
    }
    
    async function makeEditable(cell, unitId, rateType, locationKey, durationKey, currentBaseRate) {
        let role = null;
        try {
            const response = await apiRequest('/api/v1/auth/session/check');
            const data = await response.json();
            role = data.authenticated && data.user ? data.user.role : null;
        } catch (error) {
            console.error('Error checking role:', error);
        }
        
        if (role !== 'superadmin') {
            showNotification(`Only superadmin can edit rates. Your role: ${role || 'unknown'}`, 'error');
            return;
        }
        
        const originalContent = cell.innerHTML;
        
        const input = document.createElement('input');
        input.type = 'number';
        input.value = currentBaseRate;
        input.className = 'price-input';
        input.min = '0';
        input.step = '50';
        input.style.width = '100%';
        input.style.padding = '0.5rem';
        input.style.fontSize = '14px';
        
        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        
        const savePrice = async () => {
            const newBaseRate = parseInt(input.value) || 0;
            
            try {
                const response = await apiRequest(`${API_BASE_URL}/rates`, {
                    method: 'PUT',
                    body: JSON.stringify({ 
                        transportUnitId: unitId, 
                        rateType: rateType,
                        locationKey: locationKey,
                        duration: durationKey, 
                        price: newBaseRate 
                    })
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to save rate');
                }
                
                // Update local data
                if (!currentData.prices[unitId]) currentData.prices[unitId] = {};
                if (!currentData.prices[unitId][rateType]) currentData.prices[unitId][rateType] = {};
                if (!currentData.prices[unitId][rateType][locationKey]) currentData.prices[unitId][rateType][locationKey] = {};
                currentData.prices[unitId][rateType][locationKey][durationKey] = newBaseRate;
                
                // If discount is active, the backend will handle updating discountedPrices
                // Just refresh the table data
                await loadRateTableData();
                
                cell.setAttribute('data-current-rate', newBaseRate);
                
                showNotification('Rate saved successfully', 'success');
            } catch (error) {
                console.error('Save error:', error);
                showNotification(error.message, 'error');
                cell.innerHTML = originalContent;
            }
        };
        
        const cancelEdit = () => {
            cell.innerHTML = originalContent;
        };
        
        input.addEventListener('blur', savePrice);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                savePrice();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        });
    }
    
    // ========== LOCATION SELECTION HANDLERS ==========
    
    function initializeLocationSelectors() {
        const pickupSelect = document.getElementById('pickupLocationSelect');
        const dropoffSelect = document.getElementById('dropoffLocationSelect');
        
        if (!pickupSelect || !dropoffSelect) return;
        
        pickupSelect.addEventListener('change', (e) => {
            currentPickupLocation = e.target.value;
            
            if (currentPickupLocation) {
                updateDropoffSelect();
                dropoffSelect.value = 'same';
                currentDropoffLocation = 'same';
                currentPage = 1;
                renderRateTable();
            } else {
                dropoffSelect.innerHTML = '<option value="same">-- Same as Pickup Location --</option>';
                currentDropoffLocation = null;
                renderRateTable();
            }
        });
        
        dropoffSelect.addEventListener('change', (e) => {
            currentDropoffLocation = e.target.value;
            currentPage = 1;
            renderRateTable();
        });
    }
    
    // ========== PAGINATION ==========
    
    function goToPrevPage() {
        if (currentPage > 1) {
            currentPage--;
            renderRateTable();
        }
    }
    
    function goToNextPage() {
        const filteredUnits = getFilteredTransportUnits();
        const totalPages = Math.ceil(filteredUnits.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderRateTable();
        }
    }
    
    // ========== MODALS ==========
    
    function initializeModals() {
        document.getElementById('addLocationBtn')?.addEventListener('click', () => { resetLocationForm(); openModal('locationModal'); });
        document.getElementById('closeLocationModal')?.addEventListener('click', () => closeModal('locationModal'));
        document.getElementById('cancelLocationBtn')?.addEventListener('click', () => closeModal('locationModal'));
        document.getElementById('locationForm')?.addEventListener('submit', (e) => { e.preventDefault(); addOrUpdateLocation(); });
        
        document.getElementById('addDurationBtn')?.addEventListener('click', () => openModal('durationModal'));
        document.getElementById('closeDurationModal')?.addEventListener('click', () => closeModal('durationModal'));
        document.getElementById('cancelDurationBtn')?.addEventListener('click', () => closeModal('durationModal'));
        document.getElementById('durationForm')?.addEventListener('submit', (e) => { e.preventDefault(); addDuration(); });
        
        document.getElementById('prevPageBtn')?.addEventListener('click', goToPrevPage);
        document.getElementById('nextPageBtn')?.addEventListener('click', goToNextPage);
        
        document.getElementById('editDiscountBtn')?.addEventListener('click', () => openDiscountModal());
        document.getElementById('closeDiscountModal')?.addEventListener('click', () => closeDiscountModal());
        document.getElementById('cancelDiscountBtn')?.addEventListener('click', () => closeDiscountModal());
        document.getElementById('discountForm')?.addEventListener('submit', saveGlobalDiscount);
        
        const tableBodyElement = document.getElementById('tableBody');
        if (tableBodyElement) {
            tableBodyElement.addEventListener('click', function(e) {
                const cell = e.target.closest('.rate-price');
                if (!cell) return;
                
                if (cell.querySelector('input')) return;
                
                const unitId = cell.getAttribute('data-unit-id');
                const rateType = cell.getAttribute('data-rate-type');
                const locationKey = cell.getAttribute('data-location-key');
                const durationKey = cell.getAttribute('data-duration-key');
                const currentRate = parseInt(cell.getAttribute('data-current-rate')) || 0;
                
                if (unitId && rateType && locationKey && durationKey) {
                    e.stopPropagation();
                    makeEditable(cell, unitId, rateType, locationKey, durationKey, currentRate);
                }
            });
        }
        
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        });
    }
    
    // ========== INITIALIZE SELF DRIVE ==========
    async function initializeSelfDrive() {
        if (window.selfDriveInitialized) return;
        
        console.log('Initializing Self Drive...');
        sessionRole = await getSessionRole();
        console.log('Session role:', sessionRole);
        
        await Promise.all([
            loadLocations(),
            loadDurations(),
            loadTransportUnits(),
            loadRateTableData()
        ]);
        
        initializeLocationSelectors();
        initializeUnitTypeFilter();
        initializeModals();
        
        window.selfDriveInitialized = true;
        console.log('Self Drive initialized successfully');
    }
    
    async function refreshSelfDriveData() {
        if (window.selfDriveInitialized) {
            await Promise.all([
                loadLocations(),
                loadDurations(),
                loadRateTableData()
            ]);
        }
    }
    
    // Expose Self-Drive module globally
    window.selfDrive = {
        initialize: initializeSelfDrive,
        refresh: refreshSelfDriveData,
        editLocation: editLocation,
        toggleLocation: toggleLocation,
        deleteLocation: deleteLocation,
        toggleDuration: toggleDuration,
        deleteDuration: deleteDuration,
        makeEditable: makeEditable,
        openDiscountModal: openDiscountModal,
        removeGlobalDiscount: removeGlobalDiscount
    };
    
    window.toggleLocation = toggleLocation;
    window.deleteLocation = deleteLocation;
    window.editLocation = editLocation;
    window.toggleDuration = toggleDuration;
    window.deleteDuration = deleteDuration;
    window.makeEditable = makeEditable;
    window.initializeSelfDrive = initializeSelfDrive;
    window.refreshSelfDriveData = refreshSelfDriveData;
})();