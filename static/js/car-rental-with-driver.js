// car-rental-with-driver.js - With Driver specific logic with CSRF support and Discounts
(function() {
    'use strict';
    
    if (window.withDriverInitialized) return;
    
    let sessionRole = null;
    let currentServiceType = 'metro_manila'; // 'metro_manila' or 'provincial'
    let currentRateType = 'regular'; // 'regular' or 'all_in' (for metro manila)
    let currentPackageType = 'one_way'; // 'one_way', 'roundtrip', 'tour' (for provincial)
    let currentDiscountData = null;
    
    let withDriverData = {
        vehicleTypes: ['Sedan', 'SUV/MPV', 'Van'],
        durations: [],
        metroManilaRates: {},
        provincialRates: {},
        discountedMetroManilaRates: {},
        discountedProvincialRates: {},
        provincialDestinations: []
    };
    
    const API_BASE_URL = '/api/common/car-rental/with-driver';
    
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
            return data.authenticated && data.user ? data.user.role : null;
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
    
    // Helper function to calculate discounted price
    function calculateDiscountedPrice(originalPrice, discount) {
        if (!discount || !discount.active) return originalPrice;
        
        const priceNum = parseFloat(originalPrice);
        if (isNaN(priceNum) || priceNum <= 0) return originalPrice;
        
        let discountedPrice;
        if (discount.discountType === 'percentage') {
            const discountAmount = priceNum * (parseFloat(discount.value) / 100);
            discountedPrice = priceNum - discountAmount;
        } else {
            discountedPrice = priceNum - parseFloat(discount.value);
        }
        
        return Math.max(0, Math.round(discountedPrice));
    }
    
    // Helper function to format price with discount display
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
    
    // Confirmation modal
    let confirmResolver = null;
    
    function showConfirmModal(title, message) {
        return new Promise((resolve) => {
            confirmResolver = resolve;
            document.getElementById('confirmModalTitleWD').textContent = title;
            document.getElementById('confirmModalMessageWD').textContent = message;
            openModal('confirmModalWD');
        });
    }
    
    function initConfirmModal() {
        const confirmModal = document.getElementById('confirmModalWD');
        if (!confirmModal) return;
        
        document.getElementById('confirmActionBtnWD')?.addEventListener('click', () => {
            if (confirmResolver) {
                confirmResolver(true);
                confirmResolver = null;
            }
            closeModal('confirmModalWD');
        });
        
        document.getElementById('cancelConfirmBtnWD')?.addEventListener('click', () => {
            if (confirmResolver) {
                confirmResolver(false);
                confirmResolver = null;
            }
            closeModal('confirmModalWD');
        });
        
        document.getElementById('closeConfirmModalBtnWD')?.addEventListener('click', () => {
            if (confirmResolver) {
                confirmResolver(false);
                confirmResolver = null;
            }
            closeModal('confirmModalWD');
        });
        
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) {
                if (confirmResolver) {
                    confirmResolver(false);
                    confirmResolver = null;
                }
                closeModal('confirmModalWD');
            }
        });
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

    function formatDateTime(dateTimeString) {
        if (!dateTimeString) return null;
        const date = new Date(dateTimeString);
        return date.toLocaleString();
    }
    
    function renderDiscountInfo(discount) {
        const container = document.getElementById('discountContainerWD');
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
        const now = new Date();
        
        // Check valid from
        let isValid = true;
        let validFromHtml = '';
        if (discount.validFrom) {
            const validFrom = new Date(discount.validFrom);
            const isNotStartedYet = validFrom > now;
            validFromHtml = `
                <div class="discount-validity">
                    <i class="fas fa-calendar-alt"></i>
                    Starts: ${validFrom.toLocaleString()}
                    ${isNotStartedYet ? '<span style="color: #f59e0b;"> (Not yet active)</span>' : ''}
                </div>
            `;
            if (isNotStartedYet) isValid = false;
        }
        
        // Check valid until
        let validUntilHtml = '';
        if (discount.validUntil) {
            const validUntil = new Date(discount.validUntil);
            const isExpired = validUntil < now;
            validUntilHtml = `
                <div class="discount-validity">
                    <i class="fas fa-calendar-alt"></i>
                    Expires: ${validUntil.toLocaleString()}
                    ${isExpired ? '<span style="color: #ef4444;"> (Expired)</span>' : ''}
                </div>
            `;
            if (isExpired) isValid = false;
        }
        
        const statusBadge = isValid ? 
            '<span class="discount-status active">Active</span>' : 
            '<span class="discount-status inactive">Inactive</span>';
        
        container.innerHTML = `
            <div class="discount-info">
                <div class="discount-info-item">
                    <span class="discount-label">Current Discount:</span>
                    <span class="discount-value ${discountClass}">${discountValue}</span>
                    ${statusBadge}
                </div>
                ${discount.description ? `
                <div class="discount-info-item">
                    <span class="discount-label">Description:</span>
                    <span class="discount-description">${escapeHtml(discount.description)}</span>
                </div>
                ` : ''}
                ${validFromHtml}
                ${validUntilHtml}
                <div class="discount-info-item">
                    <span class="discount-label">Created:</span>
                    <span class="discount-date">${new Date(discount.createdAt).toLocaleString()}</span>
                </div>
                ${sessionRole === 'superadmin' ? `
                <div class="discount-actions" style="margin-top: 0.75rem;">
                    <button class="btn-icon-sm" onclick="window.withDriver.openDiscountModal()">
                        <i class="fas fa-edit"></i> Edit Discount
                    </button>
                    <button class="btn-icon-sm btn-danger" onclick="window.withDriver.removeGlobalDiscount()">
                        <i class="fas fa-trash"></i> Remove Discount
                    </button>
                </div>
                ` : ''}
            </div>
        `;
    }
    
    function renderNoDiscount() {
        const container = document.getElementById('discountContainerWD');
        if (!container) return;
        
        container.innerHTML = `
            <div class="no-discount">
                <i class="fas fa-tag" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
                <p>No active global discount</p>
                <small>Click Manage Discount to add a global discount that will apply to all rates</small>
                ${sessionRole === 'superadmin' ? `
                <div class="discount-actions" style="margin-top: 0.75rem;">
                    <button class="btn-icon-sm" onclick="window.withDriver.openDiscountModal()">
                        <i class="fas fa-plus"></i> Add Global Discount
                    </button>
                </div>
                ` : ''}
            </div>
        `;
    }
    
    function openDiscountModal() {
        const modal = document.getElementById('discountModalWD');
        if (!modal) return;
        
        if (currentDiscountData) {
            document.getElementById('discountTypeWD').value = currentDiscountData.discountType || 'percentage';
            document.getElementById('discountValueWD').value = currentDiscountData.value || '';
            document.getElementById('discountDescriptionWD').value = currentDiscountData.description || '';
            
            // Handle validFrom - convert to datetime-local format
            if (currentDiscountData.validFrom) {
                const fromDate = new Date(currentDiscountData.validFrom);
                const fromValue = fromDate.toISOString().slice(0, 16);
                document.getElementById('discountValidFromWD').value = fromValue;
            } else {
                document.getElementById('discountValidFromWD').value = '';
            }
            
            // Handle validUntil - convert to datetime-local format
            if (currentDiscountData.validUntil) {
                const untilDate = new Date(currentDiscountData.validUntil);
                const untilValue = untilDate.toISOString().slice(0, 16);
                document.getElementById('discountValidUntilWD').value = untilValue;
            } else {
                document.getElementById('discountValidUntilWD').value = '';
            }
        } else {
            const form = document.getElementById('discountFormWD');
            if (form) form.reset();
            document.getElementById('discountTypeWD').value = 'percentage';
            document.getElementById('discountValidFromWD').value = '';
            document.getElementById('discountValidUntilWD').value = '';
        }
        
        modal.style.display = 'flex';
    }
    
    function closeDiscountModal() {
        const modal = document.getElementById('discountModalWD');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    async function saveGlobalDiscount(e) {
        e.preventDefault();
        
        const discountType = document.getElementById('discountTypeWD').value;
        const discountValue = document.getElementById('discountValueWD').value;
        const description = document.getElementById('discountDescriptionWD').value;
        const validFrom = document.getElementById('discountValidFromWD').value;
        const validUntil = document.getElementById('discountValidUntilWD').value;
        const applyToAll = document.getElementById('applyToAllWD')?.checked || false;
        
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
        
        // Validate that validFrom is before validUntil if both are provided
        if (validFrom && validUntil) {
            const fromDate = new Date(validFrom);
            const untilDate = new Date(validUntil);
            if (fromDate >= untilDate) {
                showNotification('Valid From date must be before Valid Until date', 'error');
                return;
            }
        }
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/discount`, {
                method: 'POST',
                body: JSON.stringify({
                    discountType,
                    value: discountValue,
                    description,
                    validFrom: validFrom || '',
                    validUntil: validUntil || '',
                    applyToAll
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showNotification('Global discount applied successfully!', 'success');
                closeDiscountModal();
                await loadDiscountSettings();
                await loadRateData();
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
                await loadRateData();
            } else {
                showNotification(data.error || 'Failed to remove discount', 'error');
            }
        } catch (error) {
            console.error('Error removing discount:', error);
            showNotification('An unexpected error occurred', 'error');
        }
    }
    
    // ========== SERVICE TYPE TOGGLE ==========
    
    function initializeServiceTypeToggle() {
        const metroBtn = document.getElementById('metroManilaBtnWD');
        const provincialBtn = document.getElementById('provincialBtnWD');
        const metroCard = document.getElementById('metroManilaCardWD');
        const provincialCard = document.getElementById('provincialCardWD');
        const durationsCard = document.getElementById('durationsCardWD');
        const destinationsManagementCard = document.getElementById('destinationsManagementCardWD');
        const serviceDesc = document.getElementById('serviceDescWD');
        
        if (metroBtn && provincialBtn) {
            metroBtn.addEventListener('click', () => {
                metroBtn.classList.add('active');
                provincialBtn.classList.remove('active');
                metroCard.style.display = 'block';
                provincialCard.style.display = 'none';
                if (durationsCard) durationsCard.style.display = 'block';
                if (destinationsManagementCard) destinationsManagementCard.style.display = 'none';
                serviceDesc.textContent = 'Rates for trips within Metro Manila';
                currentServiceType = 'metro_manila';
                renderMetroManilaRateTable();
            });
            
            provincialBtn.addEventListener('click', () => {
                provincialBtn.classList.add('active');
                metroBtn.classList.remove('active');
                metroCard.style.display = 'none';
                provincialCard.style.display = 'block';
                if (durationsCard) durationsCard.style.display = 'none';
                if (destinationsManagementCard) destinationsManagementCard.style.display = 'block';
                serviceDesc.textContent = 'Rates for provincial trips (One Way, Roundtrip, Tour)';
                currentServiceType = 'provincial';
                renderProvincialRateTable();
            });
        }
    }
    
    // ========== PROVINCIAL DESTINATIONS MANAGEMENT ==========
    
    async function loadDestinationsList() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/provincial/destinations`);
            if (!response.ok) throw new Error('Failed to load destinations');
            const data = await response.json();
            displayDestinationsList(data.destinations || []);
        } catch (error) {
            console.error('Error loading destinations list:', error);
            showNotification('Failed to load destinations', 'error');
        }
    }
    
    function displayDestinationsList(destinations) {
        const container = document.getElementById('destinationsContainerWD');
        if (!container) return;
        
        if (!destinations || destinations.length === 0) {
            container.innerHTML = '<div class="empty-state">No destinations found. Click "Add Destination" to add.</div>';
            return;
        }
        
        container.innerHTML = destinations.map(dest => `
            <div class="destination-card">
                <div>
                    <span class="destination-name ${!dest.isActive ? 'inactive-text' : ''}">${escapeHtml(dest.name)}</span>
                    <span class="destination-status ${dest.isActive ? 'active' : 'inactive'}">
                        ${dest.isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="destination-actions">
                    ${sessionRole === 'superadmin' ? `
                        <button class="btn-icon-sm" onclick="window.withDriver.toggleDestination('${dest.key}')">
                            <i class="fas ${dest.isActive ? 'fa-ban' : 'fa-check-circle'}"></i>
                        </button>
                        <button class="btn-icon-sm" onclick="window.withDriver.deleteDestination('${dest.key}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    function openDestinationModal() {
        resetDestinationForm();
        openModal('destinationModalWD');
    }

    function resetDestinationForm() {
        document.getElementById('destinationNameWD').value = '';
        document.getElementById('destinationModalTitleWD').textContent = 'Add Destination';
    }

    async function addProvincialDestination() {
        const name = document.getElementById('destinationNameWD').value.trim();
        
        if (!name) {
            showNotification('Destination name is required', 'error');
            return;
        }
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/provincial/destinations`, {
                method: 'POST',
                body: JSON.stringify({ name: name })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add destination');
            }
            
            showNotification('Destination added successfully');
            closeModal('destinationModalWD');
            resetDestinationForm();
            await loadDestinationsList();
            await loadProvincialDestinations();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }
    
    async function deleteProvincialDestination(destinationKey) {
        const confirmed = await showConfirmModal('Delete Destination', 'Are you sure you want to delete this destination? This action cannot be undone.');
        if (!confirmed) return;
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/provincial/destinations/${destinationKey}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Failed to delete destination');
            
            showNotification('Destination deleted successfully');
            await loadDestinationsList();
            await loadProvincialDestinations();
        } catch (error) {
            showNotification('Failed to delete destination', 'error');
        }
    }
    
    async function toggleProvincialDestination(destinationKey) {
        try {
            const response = await apiRequest(`${API_BASE_URL}/provincial/destinations/${destinationKey}/toggle`, { 
                method: 'PATCH'
            });
            if (!response.ok) throw new Error('Failed to toggle destination');
            const data = await response.json();
            showNotification(data.message);
            await loadDestinationsList();
            await loadProvincialDestinations();
        } catch (error) {
            showNotification('Failed to toggle destination', 'error');
        }
    }
    
    // ========== PROVINCIAL DESTINATIONS (for matrix) ==========
    
    async function loadProvincialDestinations() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/provincial/destinations`);
            if (!response.ok) throw new Error('Failed to load destinations');
            const data = await response.json();
            withDriverData.allProvincialDestinations = data.destinations || [];
            withDriverData.provincialDestinations = (data.destinations || []).filter(d => d.isActive !== false);
            renderProvincialRateTable();
        } catch (error) {
            console.error('Error loading destinations:', error);
            showNotification('Failed to load destinations', 'error');
        }
    }
    
    // ========== DURATIONS ==========
    
    async function loadWithDriverDurations() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/durations`);
            if (!response.ok) throw new Error('Failed to load durations');
            const data = await response.json();
            withDriverData.durations = data.durations || [];
            displayWithDriverDurations(data.durations);
            
            if (currentServiceType === 'metro_manila') {
                renderMetroManilaRateTable();
            }
        } catch (error) {
            console.error('Error loading durations:', error);
            showNotification('Failed to load durations', 'error');
        }
    }
    
    function displayWithDriverDurations(durations) {
        const container = document.getElementById('durationsContainerWD');
        if (!container) return;
        
        if (!durations || durations.length === 0) {
            container.innerHTML = '<div class="empty-state">No durations found. Add your first duration!</div>';
            return;
        }
        
        const sortedDurations = [...durations].sort((a, b) => a.hours - b.hours);
        
        container.innerHTML = sortedDurations.map(duration => `
            <div class="duration-card">
                <div>
                    <span class="duration-name ${!duration.isActive ? 'inactive-text' : ''}">${escapeHtml(duration.name)}</span>
                    <span class="location-hours">(${duration.hours} hours)</span>
                    <span class="duration-status ${duration.isActive ? 'active' : 'inactive'}">
                        ${duration.isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="duration-actions">
                    ${sessionRole === 'superadmin' ? `
                        <button class="btn-icon-sm" onclick="window.withDriver.toggleDuration('${duration.key}')">
                            <i class="fas ${duration.isActive ? 'fa-ban' : 'fa-check-circle'}"></i>
                        </button>
                        <button class="btn-icon-sm" onclick="window.withDriver.deleteDuration('${duration.key}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }
    
    async function addWithDriverDuration() {
        const name = document.getElementById('durationNameWD').value.trim();
        const hours = parseInt(document.getElementById('durationHoursWD').value);
        
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
            closeModal('durationModalWD');
            document.getElementById('durationNameWD').value = '';
            document.getElementById('durationHoursWD').value = '';
            await loadWithDriverDurations();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }
    
    async function toggleWithDriverDuration(durationKey) {
        try {
            const response = await apiRequest(`${API_BASE_URL}/durations/${durationKey}/toggle`, { 
                method: 'PATCH'
            });
            if (!response.ok) throw new Error('Failed to toggle duration');
            const data = await response.json();
            showNotification(data.message);
            await loadWithDriverDurations();
        } catch (error) {
            showNotification('Failed to toggle duration', 'error');
        }
    }
    
    async function deleteWithDriverDuration(durationKey) {
        const confirmed = await showConfirmModal('Delete Duration', 'Are you sure you want to delete this duration? This action cannot be undone.');
        if (!confirmed) return;
        
        try {
            const response = await apiRequest(`${API_BASE_URL}/durations/${durationKey}`, { 
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete duration');
            showNotification('Duration deleted successfully');
            await loadWithDriverDurations();
        } catch (error) {
            showNotification('Failed to delete duration', 'error');
        }
    }
    
    // ========== METRO MANILA RATE TABLE ==========
    
    function initializeMetroManilaRateTypeFilter() {
        const regularBtn = document.getElementById('regularRateBtnWD');
        const allInBtn = document.getElementById('allInRateBtnWD');
        
        if (regularBtn && allInBtn) {
            regularBtn.addEventListener('click', () => {
                regularBtn.classList.add('active');
                allInBtn.classList.remove('active');
                currentRateType = 'regular';
                renderMetroManilaRateTable();
            });
            
            allInBtn.addEventListener('click', () => {
                allInBtn.classList.add('active');
                regularBtn.classList.remove('active');
                currentRateType = 'all_in';
                renderMetroManilaRateTable();
            });
        }
    }
    
    function getMetroManilaRate(vehicleType, durationKey) {
        // First try to get discounted rate
        if (withDriverData.discountedMetroManilaRates[currentRateType] && 
            withDriverData.discountedMetroManilaRates[currentRateType][vehicleType] && 
            withDriverData.discountedMetroManilaRates[currentRateType][vehicleType][durationKey]) {
            return parseInt(withDriverData.discountedMetroManilaRates[currentRateType][vehicleType][durationKey]);
        }
        
        // Fall back to original rate
        if (withDriverData.metroManilaRates[currentRateType] && 
            withDriverData.metroManilaRates[currentRateType][vehicleType] && 
            withDriverData.metroManilaRates[currentRateType][vehicleType][durationKey]) {
            return parseInt(withDriverData.metroManilaRates[currentRateType][vehicleType][durationKey]);
        }
        return 0;
    }
    
    function getOriginalMetroManilaRate(vehicleType, durationKey) {
        if (withDriverData.metroManilaRates[currentRateType] && 
            withDriverData.metroManilaRates[currentRateType][vehicleType] && 
            withDriverData.metroManilaRates[currentRateType][vehicleType][durationKey]) {
            return parseInt(withDriverData.metroManilaRates[currentRateType][vehicleType][durationKey]);
        }
        return 0;
    }
    
    function hasMetroManilaDiscount(vehicleType, durationKey) {
        return withDriverData.discountedMetroManilaRates[currentRateType] && 
               withDriverData.discountedMetroManilaRates[currentRateType][vehicleType] && 
               withDriverData.discountedMetroManilaRates[currentRateType][vehicleType][durationKey];
    }
    
    function renderMetroManilaRateTable() {
        const tbody = document.getElementById('tableBodyWD');
        const thead = document.getElementById('tableHeaderWD');
        
        if (!withDriverData.vehicleTypes || withDriverData.vehicleTypes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No vehicle types available</td></tr>';
            return;
        }
        
        if (!withDriverData.durations || withDriverData.durations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No durations available</td></tr>';
            return;
        }
        
        const activeDurations = withDriverData.durations
            .filter(d => d.isActive !== false)
            .sort((a, b) => a.hours - b.hours);
        
        thead.innerHTML = `
            <tr>
                <th>Vehicle Type</th>
                ${activeDurations.map(d => `<th>${escapeHtml(d.name)}<br><small>(${d.hours} hrs)</small></th>`).join('')}
            </tr>
        `;
        
        const calculationText = document.getElementById('calculationTextWD');
        const rateTypeDisplay = currentRateType === 'regular' ? 'Regular' : 'All-in';
        calculationText.innerHTML = `Package Type: ${rateTypeDisplay} | Rates shown are for Metro Manila trips`;
        
        let rowsHtml = '';
        
        for (const vehicleType of withDriverData.vehicleTypes) {
            rowsHtml += '<tr>';
            rowsHtml += `<td><strong>${escapeHtml(vehicleType)}</strong></td>`;
            
            for (const duration of activeDurations) {
                const originalRate = getOriginalMetroManilaRate(vehicleType, duration.key);
                const displayRate = getMetroManilaRate(vehicleType, duration.key);
                const hasDiscount = hasMetroManilaDiscount(vehicleType, duration.key);
                
                let discountBadge = '';
                if (hasDiscount && originalRate > 0 && displayRate !== originalRate && currentDiscountData) {
                    const discountValue = currentDiscountData.discountType === 'percentage' 
                        ? `${currentDiscountData.value}% OFF`
                        : `₱${parseFloat(currentDiscountData.value).toLocaleString()} OFF`;
                    discountBadge = `<span class="discount-indicator" title="${discountValue}">${discountValue}</span>`;
                }
                
                const priceHtml = formatPriceWithDiscount(originalRate, displayRate, hasDiscount && displayRate !== originalRate);
                
                rowsHtml += `<td class="rate-price ${hasDiscount ? 'has-discount' : ''}" 
                    data-vehicle-type="${vehicleType}" 
                    data-duration="${duration.key}" 
                    data-current-rate="${originalRate}">
                    <div class="price-info">
                        ${priceHtml}
                        ${discountBadge}
                        <div class="price-breakdown">(${duration.hours}hrs)</div>
                    </div>
                   </div>`;
            }
            
            rowsHtml += '</tr>';
        }
        
        tbody.innerHTML = rowsHtml;
    }
    
    // ========== PROVINCIAL RATE TABLE ==========
    
    function initializeProvincialPackageFilter() {
        const oneWayBtn = document.getElementById('oneWayBtnWD');
        const roundtripBtn = document.getElementById('roundtripBtnWD');
        const tourBtn = document.getElementById('tourBtnWD');
        
        if (oneWayBtn) {
            oneWayBtn.addEventListener('click', () => {
                oneWayBtn.classList.add('active');
                roundtripBtn?.classList.remove('active');
                tourBtn?.classList.remove('active');
                currentPackageType = 'one_way';
                renderProvincialRateTable();
            });
        }
        
        if (roundtripBtn) {
            roundtripBtn.addEventListener('click', () => {
                roundtripBtn.classList.add('active');
                oneWayBtn.classList.remove('active');
                tourBtn?.classList.remove('active');
                currentPackageType = 'roundtrip';
                renderProvincialRateTable();
            });
        }
        
        if (tourBtn) {
            tourBtn.addEventListener('click', () => {
                tourBtn.classList.add('active');
                oneWayBtn.classList.remove('active');
                roundtripBtn?.classList.remove('active');
                currentPackageType = 'tour';
                renderProvincialRateTable();
            });
        }
    }
    
    function getProvincialRate(vehicleType, destinationKey) {
        // First try to get discounted rate
        if (withDriverData.discountedProvincialRates[currentPackageType] && 
            withDriverData.discountedProvincialRates[currentPackageType][vehicleType] && 
            withDriverData.discountedProvincialRates[currentPackageType][vehicleType][destinationKey]) {
            return parseInt(withDriverData.discountedProvincialRates[currentPackageType][vehicleType][destinationKey]);
        }
        
        // Fall back to original rate
        if (withDriverData.provincialRates[currentPackageType] && 
            withDriverData.provincialRates[currentPackageType][vehicleType] && 
            withDriverData.provincialRates[currentPackageType][vehicleType][destinationKey]) {
            return parseInt(withDriverData.provincialRates[currentPackageType][vehicleType][destinationKey]);
        }
        return 0;
    }
    
    function getOriginalProvincialRate(vehicleType, destinationKey) {
        if (withDriverData.provincialRates[currentPackageType] && 
            withDriverData.provincialRates[currentPackageType][vehicleType] && 
            withDriverData.provincialRates[currentPackageType][vehicleType][destinationKey]) {
            return parseInt(withDriverData.provincialRates[currentPackageType][vehicleType][destinationKey]);
        }
        return 0;
    }
    
    function hasProvincialDiscount(vehicleType, destinationKey) {
        return withDriverData.discountedProvincialRates[currentPackageType] && 
               withDriverData.discountedProvincialRates[currentPackageType][vehicleType] && 
               withDriverData.discountedProvincialRates[currentPackageType][vehicleType][destinationKey];
    }
    
    function renderProvincialRateTable() {
        const tbody = document.getElementById('provincialTableBodyWD');
        const thead = document.getElementById('provincialTableHeaderWD');
        
        if (!withDriverData.vehicleTypes || withDriverData.vehicleTypes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No vehicle types available</div><tr>';
            return;
        }
        
        if (!withDriverData.provincialDestinations || withDriverData.provincialDestinations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No provincial destinations configured. Click "Add Destination" to add destinations.</div></tr>';
            return;
        }
        
        const packageDisplay = {
            'one_way': 'One Way',
            'roundtrip': 'Round Trip',
            'tour': 'Tour'
        };
        
        // Create headers with all destinations
        thead.innerHTML = `
            <tr>
                <th>Vehicle Type</th>
                ${withDriverData.provincialDestinations.map(d => `<th style="min-width: 150px;">${escapeHtml(d.name)}</th>`).join('')}
            </tr>
        `;
        
        const calculationText = document.getElementById('provincialCalculationTextWD');
        const packageName = packageDisplay[currentPackageType] || 'One Way';
        calculationText.innerHTML = `Package: ${packageName} | Showing rates for all destinations`;
        
        let rowsHtml = '';
        
        for (const vehicleType of withDriverData.vehicleTypes) {
            rowsHtml += '<tr>';
            rowsHtml += `<td><strong>${escapeHtml(vehicleType)}</strong></div>`;
            
            for (const destination of withDriverData.provincialDestinations) {
                const originalRate = getOriginalProvincialRate(vehicleType, destination.key);
                const displayRate = getProvincialRate(vehicleType, destination.key);
                const hasDiscount = hasProvincialDiscount(vehicleType, destination.key);
                
                let discountBadge = '';
                if (hasDiscount && originalRate > 0 && displayRate !== originalRate && currentDiscountData) {
                    const discountValue = currentDiscountData.discountType === 'percentage' 
                        ? `${currentDiscountData.value}% OFF`
                        : `₱${parseFloat(currentDiscountData.value).toLocaleString()} OFF`;
                    discountBadge = `<span class="discount-indicator" title="${discountValue}">${discountValue}</span>`;
                }
                
                const priceHtml = formatPriceWithDiscount(originalRate, displayRate, hasDiscount && displayRate !== originalRate);
                
                rowsHtml += `<td class="rate-price ${hasDiscount ? 'has-discount' : ''}" 
                    data-vehicle-type="${vehicleType}" 
                    data-destination="${destination.key}" 
                    data-current-rate="${originalRate}" 
                    style="min-width: 150px;">
                    <div class="price-info">
                        ${priceHtml}
                        ${discountBadge}
                    </div>
                   </div>`;
            }
            
            rowsHtml += '</tr>';
        }
        
        tbody.innerHTML = rowsHtml;
    }
    
    // ========== MAKE EDITABLE ==========
    
    function setupEditableCells() {
        const metroTableBody = document.getElementById('tableBodyWD');
        if (metroTableBody) {
            metroTableBody.addEventListener('click', async (e) => {
                const cell = e.target.closest('.rate-price');
                if (!cell) return;
                if (cell.querySelector('input')) return;
                
                const role = await getSessionRole();
                if (role !== 'superadmin') {
                    showNotification('Only superadmin can edit rates', 'error');
                    return;
                }
                
                const vehicleType = cell.getAttribute('data-vehicle-type');
                const duration = cell.getAttribute('data-duration');
                const currentRate = parseInt(cell.getAttribute('data-current-rate')) || 0;
                
                makeMetroManilaEditable(cell, vehicleType, duration, currentRate);
            });
        }
        
        const provincialTableBody = document.getElementById('provincialTableBodyWD');
        if (provincialTableBody) {
            provincialTableBody.addEventListener('click', async (e) => {
                const cell = e.target.closest('.rate-price');
                if (!cell) return;
                if (cell.querySelector('input')) return;
                
                const role = await getSessionRole();
                if (role !== 'superadmin') {
                    showNotification('Only superadmin can edit rates', 'error');
                    return;
                }
                
                const vehicleType = cell.getAttribute('data-vehicle-type');
                const destination = cell.getAttribute('data-destination');
                const currentRate = parseInt(cell.getAttribute('data-current-rate')) || 0;
                
                makeProvincialEditable(cell, vehicleType, destination, currentRate);
            });
        }
    }
    
    function makeMetroManilaEditable(cell, vehicleType, durationKey, currentRate) {
        const originalContent = cell.innerHTML;
        
        const input = document.createElement('input');
        input.type = 'number';
        input.value = currentRate;
        input.className = 'price-input';
        input.min = '0';
        input.step = '100';
        input.style.width = '100%';
        input.style.padding = '0.5rem';
        
        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        
        const savePrice = async () => {
            const newRate = parseInt(input.value) || 0;
            
            try {
                const response = await apiRequest(`${API_BASE_URL}/metro-manila/rates`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        vehicleType: vehicleType,
                        rateType: currentRateType,
                        duration: durationKey,
                        price: newRate
                    })
                });
                
                if (!response.ok) throw new Error('Failed to save rate');
                
                showNotification('Rate saved successfully', 'success');
                await loadRateData();
                
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
    
    function makeProvincialEditable(cell, vehicleType, destinationKey, currentRate) {
        const originalContent = cell.innerHTML;
        
        const input = document.createElement('input');
        input.type = 'number';
        input.value = currentRate;
        input.className = 'price-input';
        input.min = '0';
        input.step = '100';
        input.style.width = '100%';
        input.style.padding = '0.5rem';
        
        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        
        const savePrice = async () => {
            const newRate = parseInt(input.value) || 0;
            
            try {
                const response = await apiRequest(`${API_BASE_URL}/provincial/rates`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        vehicleType: vehicleType,
                        packageType: currentPackageType,
                        destination: destinationKey,
                        price: newRate
                    })
                });
                
                if (!response.ok) throw new Error('Failed to save rate');
                
                showNotification('Rate saved successfully', 'success');
                await loadRateData();
                
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
    
    // ========== LOAD RATE DATA ==========

    async function loadRateData() {
        try {
            const response = await apiRequest(`${API_BASE_URL}/rates/all`);
            if (!response.ok) throw new Error('Failed to load rate data');
            const data = await response.json();
            withDriverData.metroManilaRates = data.metroManila || {};
            withDriverData.provincialRates = data.provincial || {};
            withDriverData.discountedMetroManilaRates = data.discountedMetroManila || {};
            withDriverData.discountedProvincialRates = data.discountedProvincial || {};
            
            if (data.discount) {
                currentDiscountData = data.discount;
                renderDiscountInfo(currentDiscountData);
            }
            
            if (currentServiceType === 'metro_manila') {
                renderMetroManilaRateTable();
            } else {
                renderProvincialRateTable();
            }
        } catch (error) {
            console.error('Error loading rate data:', error);
            showNotification('Failed to load rate data', 'error');
        }
    }
    
    // ========== REFRESH ==========
    
    async function refreshWithDriverData() {
        if (window.withDriverInitialized) {
            await Promise.all([
                loadDestinationsList(),
                loadProvincialDestinations(),
                loadWithDriverDurations(),
                loadRateData(),
                loadDiscountSettings()
            ]);
        }
    }
    
    // ========== INITIALIZE ==========
    
    async function initializeWithDriver() {
        if (window.withDriverInitialized) return;
        
        console.log('Initializing With Driver module...');
        sessionRole = await getSessionRole();
        console.log('Session role:', sessionRole);
        
        await Promise.all([
            loadDestinationsList(),
            loadProvincialDestinations(),
            loadWithDriverDurations(),
            loadRateData(),
            loadDiscountSettings()
        ]);
        
        initializeServiceTypeToggle();
        initializeMetroManilaRateTypeFilter();
        initializeProvincialPackageFilter();
        setupEditableCells();
        initializeWithDriverModals();
        initConfirmModal();
        
        renderMetroManilaRateTable();
        
        window.withDriverInitialized = true;
        console.log('With Driver initialized successfully');
    }
    
    // ========== MODALS ==========
    
    function initializeWithDriverModals() {
        // Destination modal
        document.getElementById('addDestinationBtnWD')?.addEventListener('click', () => openDestinationModal());
        document.getElementById('closeDestinationModalWD')?.addEventListener('click', () => closeModal('destinationModalWD'));
        document.getElementById('cancelDestinationBtnWD')?.addEventListener('click', () => closeModal('destinationModalWD'));
        document.getElementById('destinationFormWD')?.addEventListener('submit', (e) => { 
            e.preventDefault(); 
            addProvincialDestination(); 
        });
        
        // Duration modal
        document.getElementById('addDurationBtnWD')?.addEventListener('click', () => openModal('durationModalWD'));
        document.getElementById('closeDurationModalWD')?.addEventListener('click', () => closeModal('durationModalWD'));
        document.getElementById('cancelDurationBtnWD')?.addEventListener('click', () => closeModal('durationModalWD'));
        document.getElementById('durationFormWD')?.addEventListener('submit', (e) => { e.preventDefault(); addWithDriverDuration(); });
        
        // Discount modal
        document.getElementById('editDiscountBtnWD')?.addEventListener('click', () => openDiscountModal());
        document.getElementById('closeDiscountModalWD')?.addEventListener('click', () => closeDiscountModal());
        document.getElementById('cancelDiscountBtnWD')?.addEventListener('click', () => closeDiscountModal());
        document.getElementById('discountFormWD')?.addEventListener('submit', saveGlobalDiscount);
        
        // Close modals on outside click
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        });
    }
    
    // Expose module globally
    window.withDriver = {
        initialize: initializeWithDriver,
        refresh: refreshWithDriverData,
        deleteDestination: deleteProvincialDestination,
        toggleDestination: toggleProvincialDestination,
        toggleDuration: toggleWithDriverDuration,
        deleteDuration: deleteWithDriverDuration,
        openDiscountModal: openDiscountModal,
        removeGlobalDiscount: removeGlobalDiscount
    };
    
    window.initializeWithDriver = initializeWithDriver;
    window.withDriverInitialized = false;
})();