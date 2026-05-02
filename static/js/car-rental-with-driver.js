// car-rental-with-driver.js - With Driver specific logic
(function() {
    'use strict';
    
    if (window.withDriverInitialized) return;
    
    let sessionRole = null;
    let currentRateType = 'regular';  // 'regular' or 'all_in'
    
    let withDriverData = {
        transportUnits: [],
        durations: [],
        rates: {},
        locations: []
    };
    
    let currentPage = 1;
    let itemsPerPage = 10;
    let currentPickupLocation = null;
    let currentDropoffLocation = null;
    let currentUnitTypeFilter = 'all';
    let availableUnitTypes = [];
    
    const API_BASE_URL = '/api/common/car-rental';
    
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
    
    function getSessionRole() {
        return typeof window.getSessionRole === 'function' ? window.getSessionRole() : null;
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

    // Custom confirmation modal
    function showConfirmModal(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
        return new Promise((resolve) => {
            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            
            // Create unique IDs to avoid conflicts
            const uniqueId = 'confirm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            // Create modal content
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
            
            // Helper to close modal and resolve
            const complete = (result) => {
                if (overlay && overlay.remove) {
                    overlay.remove();
                }
                resolve(result);
            };
            
            // Add event listeners using data attributes
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
            
            // Close when clicking outside
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    complete(false);
                }
            });
        });
    }
    
    // ========== LOCATIONS (With Driver) ==========
    
    async function loadWithDriverLocations() {
        try {
            const response = await fetch(`${API_BASE_URL}/locations`);
            if (!response.ok) throw new Error('Failed to load locations');
            const data = await response.json();
            withDriverData.locations = data.locations;
            displayWithDriverLocations(data.locations);
            updateWithDriverLocationSelects();
            
            if (currentPickupLocation) {
                updateWithDriverDropoffSelect();
            }
        } catch (error) {
            console.error('Error loading locations:', error);
            showNotification('Failed to load locations', 'error');
        }
    }
    
    function displayWithDriverLocations(locations) {
        const container = document.getElementById('locationsContainerWD');
        if (!container) return;
        
        if (!locations || locations.length === 0) {
            container.innerHTML = '<div class="empty-state">No locations found. Add your first location!</div>';
            return;
        }
        
        sessionRole = getSessionRole();
        
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
                    ${sessionRole === 'superadmin' ? `
                        <button class="btn-icon-sm" onclick="window.withDriver.editLocation('${location.key}')"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon-sm" onclick="window.withDriver.toggleLocation('${location.key}')"><i class="fas ${location.isActive ? 'fa-ban' : 'fa-check-circle'}"></i></button>
                        <button class="btn-icon-sm" onclick="window.withDriver.deleteLocation('${location.key}')"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }
    
    function updateWithDriverLocationSelects() {
        const pickupSelect = document.getElementById('pickupLocationSelectWD');
        const dropoffSelect = document.getElementById('dropoffLocationSelectWD');
        
        if (pickupSelect && dropoffSelect && withDriverData.locations) {
            const activeLocations = withDriverData.locations.filter(l => {
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
                updateWithDriverDropoffSelect();
            }
        }
    }
    
    function updateWithDriverDropoffSelect() {
        const dropoffSelect = document.getElementById('dropoffLocationSelectWD');
        if (!dropoffSelect || !withDriverData.locations || !currentPickupLocation) return;
        
        const otherLocations = withDriverData.locations.filter(l => {
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
    
    async function addOrUpdateWithDriverLocation() {
        const key = document.getElementById('locationKeyWD').value;
        const name = document.getElementById('locationNameWD').value.trim();
        const deliveryFeeFromPasay = parseInt(document.getElementById('deliveryFeeFromPasayWD').value) || 0;
        
        if (!name) {
            showNotification('Location name is required', 'error');
            return;
        }
        
        try {
            let response;
            if (key) {
                response = await fetch(`${API_BASE_URL}/locations/${key}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, deliveryFeeFromPasay })
                });
            } else {
                response = await fetch(`${API_BASE_URL}/locations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, deliveryFeeFromPasay })
                });
            }
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save location');
            }
            
            showNotification(key ? 'Location updated' : 'Location added');
            closeModal('locationModalWD');
            resetWithDriverLocationForm();
            await loadWithDriverLocations();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }
    
    function resetWithDriverLocationForm() {
        document.getElementById('locationKeyWD').value = '';
        document.getElementById('locationNameWD').value = '';
        document.getElementById('deliveryFeeFromPasayWD').value = '0';
        document.getElementById('locationModalTitleWD').textContent = 'Add Location';
    }
    
    function editWithDriverLocation(locationKey) {
        const location = withDriverData.locations.find(l => l.key === locationKey);
        if (location) {
            document.getElementById('locationKeyWD').value = location.key;
            document.getElementById('locationNameWD').value = location.name;
            document.getElementById('deliveryFeeFromPasayWD').value = location.deliveryFeeFromPasay || 0;
            document.getElementById('locationModalTitleWD').textContent = 'Edit Location';
            openModal('locationModalWD');
        }
    }
    
    async function toggleWithDriverLocation(locationKey) {
        try {
            const response = await fetch(`${API_BASE_URL}/locations/${locationKey}/toggle`, { method: 'PATCH' });
            if (!response.ok) throw new Error('Failed to toggle location');
            const data = await response.json();
            showNotification(data.message);
            await loadWithDriverLocations();
        } catch (error) {
            showNotification('Failed to toggle location', 'error');
        }
    }
    
    async function deleteWithDriverLocation(locationKey) {
        const confirmed = await showConfirmModal(
            'Delete Location',
            `Are you sure you want to delete this location? This action cannot be undone.`,
            'Delete',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/locations/${locationKey}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete location');
            showNotification('Location deleted successfully');
            await loadWithDriverLocations();
        } catch (error) {
            showNotification('Failed to delete location', 'error');
        }
    }
    
    // ========== DURATIONS (With Driver) ==========
    
    async function loadWithDriverDurations() {
        try {
            const response = await fetch(`${API_BASE_URL}/durations`);
            if (!response.ok) throw new Error('Failed to load durations');
            const data = await response.json();
            withDriverData.durations = data.durations;
            displayWithDriverDurations(data.durations);
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
        
        sessionRole = getSessionRole();
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
                    ${sessionRole === 'superadmin' ? `
                        <button class="btn-icon-sm" onclick="window.withDriver.toggleDuration('${duration.key}')"><i class="fas ${duration.isActive ? 'fa-ban' : 'fa-check-circle'}"></i></button>
                        <button class="btn-icon-sm" onclick="window.withDriver.deleteDuration('${duration.key}')"><i class="fas fa-trash"></i></button>
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
            const response = await fetch(`${API_BASE_URL}/durations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            await loadWithDriverRateTableData();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }
    
    async function toggleWithDriverDuration(durationKey) {
        try {
            const response = await fetch(`${API_BASE_URL}/durations/${durationKey}/toggle`, { method: 'PATCH' });
            if (!response.ok) throw new Error('Failed to toggle duration');
            const data = await response.json();
            showNotification(data.message);
            await loadWithDriverDurations();
            await loadWithDriverRateTableData();
        } catch (error) {
            showNotification('Failed to toggle duration', 'error');
        }
    }
    
    async function deleteWithDriverDuration(durationKey) {
        const confirmed = await showConfirmModal(
            'Delete Duration',
            `Are you sure you want to delete this duration? This action cannot be undone.`,
            'Delete',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/durations/${durationKey}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete duration');
            showNotification('Duration deleted successfully');
            await loadWithDriverDurations();
            await loadWithDriverRateTableData();
        } catch (error) {
            showNotification('Failed to delete duration', 'error');
        }
    }
    
    // ========== TRANSPORT UNITS (With Driver) ==========
    
    async function loadWithDriverTransportUnits() {
        try {
            const response = await fetch(`${API_BASE_URL}/transport-units`);
            if (!response.ok) throw new Error('Failed to load transport units');
            const data = await response.json();
            withDriverData.transportUnits = data.transportUnits;
        } catch (error) {
            console.error('Error loading transport units:', error);
            showNotification('Failed to load transport units', 'error');
        }
    }
    
    // ========== UNIT TYPE FILTER (With Driver) ==========
    
    function extractWithDriverUnitTypes() {
        const unitTypesSet = new Set();
        withDriverData.transportUnits.forEach(unit => {
            if (unit.unitType && unit.unitType.trim() !== '') {
                unitTypesSet.add(unit.unitType);
            }
        });
        availableUnitTypes = Array.from(unitTypesSet).sort();
        updateWithDriverUnitTypeFilterSelect();
    }
    
    function updateWithDriverUnitTypeFilterSelect() {
        const filterSelect = document.getElementById('unitTypeFilterSelectWD');
        if (!filterSelect) return;
        
        let options = '<option value="all">-- All Unit Types --</option>';
        availableUnitTypes.forEach(unitType => {
            options += `<option value="${escapeHtml(unitType)}">${escapeHtml(unitType)}</option>`;
        });
        filterSelect.innerHTML = options;
    }
    
    function getWithDriverFilteredTransportUnits() {
        if (currentUnitTypeFilter === 'all') {
            return withDriverData.transportUnits;
        }
        return withDriverData.transportUnits.filter(unit => 
            unit.unitType === currentUnitTypeFilter
        );
    }
    
    function initializeWithDriverUnitTypeFilter() {
        const filterSelect = document.getElementById('unitTypeFilterSelectWD');
        if (!filterSelect) return;
        
        filterSelect.addEventListener('change', (e) => {
            currentUnitTypeFilter = e.target.value;
            currentPage = 1;
            renderWithDriverRateTable();
        });
    }
    
    // ========== RATE TYPE FILTER (With Driver) ==========
    
    function initializeWithDriverRateTypeFilter() {
        const regularBtn = document.getElementById('regularRateBtnWD');
        const allInBtn = document.getElementById('allInRateBtnWD');
        
        if (regularBtn && allInBtn) {
            regularBtn.addEventListener('click', () => {
                regularBtn.classList.add('active');
                allInBtn.classList.remove('active');
                currentRateType = 'regular';
                currentPage = 1;
                renderWithDriverRateTable();
            });
            
            allInBtn.addEventListener('click', () => {
                allInBtn.classList.add('active');
                regularBtn.classList.remove('active');
                currentRateType = 'all_in';
                currentPage = 1;
                renderWithDriverRateTable();
            });
        }
    }
    
    // ========== RATES (With Driver) ==========
    
    async function loadWithDriverRateTableData() {
        try {
            const response = await fetch(`${API_BASE_URL}/table-data`);
            if (!response.ok) throw new Error('Failed to load table data');
            const data = await response.json();
            withDriverData.transportUnits = data.transportUnits;
            withDriverData.durations = data.durations;
            // Use withDriverRates from the API response
            withDriverData.rates = data.withDriverRates || {};
            withDriverData.locations = data.locations;
            
            extractWithDriverUnitTypes();
            
            currentPage = 1;
            renderWithDriverRateTable();
        } catch (error) {
            console.error('Error loading table data:', error);
            showNotification('Failed to load rate table', 'error');
        }
    }
    
    function getWithDriverDeliveryFee(locationKey) {
        const location = withDriverData.locations.find(l => l.key === locationKey);
        return location ? location.deliveryFeeFromPasay : 0;
    }
    
    function getWithDriverRateForUnit(unitId, locationType, locationKey, durationKey) {
        // New structure: rates[unitId][rateType][locationType][locationKey][durationKey]
        if (withDriverData.rates[unitId] && 
            withDriverData.rates[unitId][currentRateType] && 
            withDriverData.rates[unitId][currentRateType][locationType] && 
            withDriverData.rates[unitId][currentRateType][locationType][locationKey] && 
            withDriverData.rates[unitId][currentRateType][locationType][locationKey][durationKey]) {
            return parseInt(withDriverData.rates[unitId][currentRateType][locationType][locationKey][durationKey]);
        }
        return 0;
    }
    
    function renderWithDriverRateTable() {
        const tbody = document.getElementById('tableBodyWD');
        const thead = document.getElementById('tableHeaderWD');
        
        const filteredUnits = getWithDriverFilteredTransportUnits();
        
        if (filteredUnits.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No transport units match the selected filter</td>' + '</tr>';
            return;
        }
        
        if (!withDriverData.durations || withDriverData.durations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No durations available</td>' + '</tr>';
            return;
        }
        
        if (!currentPickupLocation) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">Please select a pickup location to view rates</td>' + '</tr>';
            return;
        }
        
        const activeDurations = withDriverData.durations
            .filter(d => d.isActive !== false)
            .sort((a, b) => a.hours - b.hours);
        
        const isDifferentLocation = currentDropoffLocation && currentDropoffLocation !== 'same';
        const locationType = isDifferentLocation ? 'different_location' : 'same_location';
        const locationKey = isDifferentLocation ? `${currentPickupLocation}_to_${currentDropoffLocation}` : currentPickupLocation;
        const deliveryFee = getWithDriverDeliveryFee(currentPickupLocation);
        
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
        
        const paginationInfo = document.getElementById('paginationInfoWD');
        const prevBtn = document.getElementById('prevPageBtnWD');
        const nextBtn = document.getElementById('nextPageBtnWD');
        
        if (paginationInfo) {
            paginationInfo.textContent = `Page ${currentPage} of ${totalPages || 1} (${filteredUnits.length} total units)`;
        }
        if (prevBtn) prevBtn.disabled = currentPage === 1;
        if (nextBtn) nextBtn.disabled = currentPage === totalPages || totalPages === 0;
        
        const calculationText = document.getElementById('calculationTextWD');
        const pickupLocationObj = withDriverData.locations.find(l => l.key === currentPickupLocation);
        const pickupName = pickupLocationObj?.name || currentPickupLocation;
        const rateTypeDisplay = currentRateType === 'regular' ? 'Regular' : 'All-in';
        
        if (isDifferentLocation) {
            const dropoffLocationObj = withDriverData.locations.find(l => l.key === currentDropoffLocation);
            const dropoffName = dropoffLocationObj?.name || currentDropoffLocation;
            calculationText.innerHTML = `🚗 ${pickupName} → ${dropoffName} (Different locations) | Rate Type: ${rateTypeDisplay} | Rate + Delivery Fee (₱${formatNumber(deliveryFee)} from Pasay to ${pickupName})`;
        } else {
            calculationText.innerHTML = `📍 ${pickupName} (Same pickup/dropoff) | Rate Type: ${rateTypeDisplay} | Rate + Delivery Fee (₱${formatNumber(deliveryFee)} from Pasay to ${pickupName})`;
        }
        
        let rowsHtml = '';
        
        for (const unit of paginatedUnits) {
            rowsHtml += '<tr>';
            rowsHtml += `<td>
                <div class="unit-name">${escapeHtml(unit.name)}</div>
                <div class="unit-details">${escapeHtml(unit.unitType)} | ${escapeHtml(unit.plateNumber)}</div>
            </td>`;
            
            for (const duration of activeDurations) {
                const hourKey = duration.key;
                const baseRate = getWithDriverRateForUnit(unit.id, locationType, locationKey, hourKey);
                const totalPrice = baseRate + deliveryFee;
                
                rowsHtml += `<td class="rate-price" onclick="window.withDriver.makeEditable(this, '${unit.id}', '${locationType}', '${locationKey}', '${hourKey}', ${baseRate})">
                    <div class="price-info">
                        <span class="base-price">Rate: ₱${formatNumber(baseRate)} (${duration.hours}hrs)</span><br>
                        <span class="total-price"><strong>Total: ₱${formatNumber(totalPrice)}</strong></span>
                        <span class="price-breakdown">+ ₱${formatNumber(deliveryFee)} delivery</span>
                    </div>
                </div>
                </td>`;
            }
            
            rowsHtml += '</tr>';
        }
        
        tbody.innerHTML = rowsHtml;
    }
    
    function makeWithDriverEditable(element, unitId, locationType, locationKey, durationKey, currentBaseRate) {
        sessionRole = getSessionRole();
        if (sessionRole !== 'superadmin') return;
        
        const input = document.createElement('input');
        input.type = 'number';
        input.value = currentBaseRate;
        input.className = 'price-input';
        input.min = '0';
        input.step = '50';
        
        element.innerHTML = '';
        element.appendChild(input);
        input.focus();
        
        const savePrice = async () => {
            const newBaseRate = parseInt(input.value) || 0;
            
            try {
                // Updated API call to match backend structure
                const response = await fetch(`${API_BASE_URL}/with-driver/rates`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        transportUnitId: unitId, 
                        rateType: currentRateType,
                        locationType: locationType,
                        locationKey: locationKey,
                        duration: durationKey, 
                        price: newBaseRate 
                    })
                });
                
                if (!response.ok) throw new Error('Failed to save rate');
                
                // Update local data with new structure
                if (!withDriverData.rates[unitId]) withDriverData.rates[unitId] = {};
                if (!withDriverData.rates[unitId][currentRateType]) withDriverData.rates[unitId][currentRateType] = {};
                if (!withDriverData.rates[unitId][currentRateType][locationType]) withDriverData.rates[unitId][currentRateType][locationType] = {};
                if (!withDriverData.rates[unitId][currentRateType][locationType][locationKey]) withDriverData.rates[unitId][currentRateType][locationType][locationKey] = {};
                withDriverData.rates[unitId][currentRateType][locationType][locationKey][durationKey] = newBaseRate;
                
                showNotification('Rate saved successfully');
                renderWithDriverRateTable();
            } catch (error) {
                console.error('Error saving rate:', error);
                showNotification('Failed to save rate', 'error');
                renderWithDriverRateTable();
            }
        };
        
        input.addEventListener('blur', savePrice);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                savePrice();
            }
        });
    }
    
    // ========== LOCATION SELECTION HANDLERS (With Driver) ==========
    
    function initializeWithDriverLocationSelectors() {
        const pickupSelect = document.getElementById('pickupLocationSelectWD');
        const dropoffSelect = document.getElementById('dropoffLocationSelectWD');
        
        if (!pickupSelect || !dropoffSelect) return;
        
        pickupSelect.addEventListener('change', (e) => {
            currentPickupLocation = e.target.value;
            console.log('Pickup location changed to:', currentPickupLocation);
            
            if (currentPickupLocation) {
                updateWithDriverDropoffSelect();
                dropoffSelect.value = 'same';
                currentDropoffLocation = 'same';
                currentPage = 1;
                renderWithDriverRateTable();
            } else {
                dropoffSelect.innerHTML = '<option value="same">-- Same as Pickup Location --</option>';
                currentDropoffLocation = null;
                renderWithDriverRateTable();
            }
        });
        
        dropoffSelect.addEventListener('change', (e) => {
            currentDropoffLocation = e.target.value;
            console.log('Dropoff location changed to:', currentDropoffLocation);
            currentPage = 1;
            renderWithDriverRateTable();
        });
    }
    
    // ========== PAGINATION (With Driver) ==========
    
    function goToWithDriverPrevPage() {
        if (currentPage > 1) {
            currentPage--;
            renderWithDriverRateTable();
        }
    }
    
    function goToWithDriverNextPage() {
        const filteredUnits = getWithDriverFilteredTransportUnits();
        const totalPages = Math.ceil(filteredUnits.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderWithDriverRateTable();
        }
    }
    
    // ========== MODALS (With Driver) ==========
    
    function initializeWithDriverModals() {
        document.getElementById('addLocationBtnWD')?.addEventListener('click', () => { resetWithDriverLocationForm(); openModal('locationModalWD'); });
        document.getElementById('closeLocationModalWD')?.addEventListener('click', () => closeModal('locationModalWD'));
        document.getElementById('cancelLocationBtnWD')?.addEventListener('click', () => closeModal('locationModalWD'));
        document.getElementById('locationFormWD')?.addEventListener('submit', (e) => { e.preventDefault(); addOrUpdateWithDriverLocation(); });
        
        document.getElementById('addDurationBtnWD')?.addEventListener('click', () => openModal('durationModalWD'));
        document.getElementById('closeDurationModalWD')?.addEventListener('click', () => closeModal('durationModalWD'));
        document.getElementById('cancelDurationBtnWD')?.addEventListener('click', () => closeModal('durationModalWD'));
        document.getElementById('durationFormWD')?.addEventListener('submit', (e) => { e.preventDefault(); addWithDriverDuration(); });
        
        document.getElementById('prevPageBtnWD')?.addEventListener('click', goToWithDriverPrevPage);
        document.getElementById('nextPageBtnWD')?.addEventListener('click', goToWithDriverNextPage);
        
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        });
    }
    
    // ========== INITIALIZE WITH DRIVER ==========
    async function initializeWithDriver() {
        if (window.withDriverInitialized) {
            console.log('With Driver already initialized');
            return;
        }
        
        console.log('Initializing With Driver module...');
        sessionRole = getSessionRole();
        
        await Promise.all([
            loadWithDriverLocations(),
            loadWithDriverDurations(),
            loadWithDriverTransportUnits(),
            loadWithDriverRateTableData()
        ]);
        
        initializeWithDriverLocationSelectors();
        initializeWithDriverUnitTypeFilter();
        initializeWithDriverRateTypeFilter();
        initializeWithDriverModals();
        
        window.withDriverInitialized = true;
    }
    
    // Function to refresh data when switching tabs
    async function refreshWithDriverData() {
        if (window.withDriverInitialized) {
            await Promise.all([
                loadWithDriverLocations(),
                loadWithDriverDurations(),
                loadWithDriverRateTableData()
            ]);
        }
    }
    
    // Expose With Driver module globally
    window.withDriver = {
        initialize: initializeWithDriver,
        refresh: refreshWithDriverData,
        editLocation: editWithDriverLocation,
        toggleLocation: toggleWithDriverLocation,
        deleteLocation: deleteWithDriverLocation,
        toggleDuration: toggleWithDriverDuration,
        deleteDuration: deleteWithDriverDuration,
        makeEditable: makeWithDriverEditable
    };
    
    // For backward compatibility
    window.editWithDriverLocation = editWithDriverLocation;
    window.toggleWithDriverLocation = toggleWithDriverLocation;
    window.deleteWithDriverLocation = deleteWithDriverLocation;
    window.toggleWithDriverDuration = toggleWithDriverDuration;
    window.deleteWithDriverDuration = deleteWithDriverDuration;
    window.makeWithDriverEditable = makeWithDriverEditable;
    window.initializeWithDriver = initializeWithDriver;
    window.refreshWithDriverData = refreshWithDriverData;
})();