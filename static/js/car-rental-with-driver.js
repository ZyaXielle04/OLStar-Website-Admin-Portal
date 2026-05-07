// car-rental-with-driver.js - With Driver specific logic
(function() {
    'use strict';
    
    if (window.withDriverInitialized) return;
    
    let sessionRole = null;
    let currentServiceType = 'metro_manila'; // 'metro_manila' or 'provincial'
    let currentRateType = 'regular'; // 'regular' or 'all_in' (for metro manila)
    let currentPackageType = 'one_way'; // 'one_way', 'roundtrip', 'tour' (for provincial)
    
    let withDriverData = {
        vehicleTypes: ['Sedan', 'SUV/MPV', 'Van'],
        durations: [],
        metroManilaRates: {},
        provincialRates: {},
        provincialDestinations: []
    };
    
    const API_BASE_URL = '/api/common/car-rental/with-driver';
    
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
            const response = await fetch('/api/v1/auth/session/check');
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
            const response = await fetch(`${API_BASE_URL}/provincial/destinations`);
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
            const response = await fetch(`${API_BASE_URL}/provincial/destinations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const response = await fetch(`${API_BASE_URL}/provincial/destinations/${destinationKey}`, {
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
    
    // ========== PROVINCIAL DESTINATIONS (for matrix) ==========
    
    async function loadProvincialDestinations() {
        try {
            const response = await fetch(`${API_BASE_URL}/provincial/destinations`);
            if (!response.ok) throw new Error('Failed to load destinations');
            const data = await response.json();
            // Store ALL destinations for management, but only ACTIVE ones for the matrix
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
            const response = await fetch(`${API_BASE_URL}/durations`);
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
        const ratePath = withDriverData.metroManilaRates[currentRateType];
        if (ratePath && ratePath[vehicleType] && ratePath[vehicleType][durationKey]) {
            return parseInt(ratePath[vehicleType][durationKey]);
        }
        return 0;
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
                const rate = getMetroManilaRate(vehicleType, duration.key);
                
                rowsHtml += `<td class="rate-price" data-vehicle-type="${vehicleType}" data-duration="${duration.key}" data-current-rate="${rate}">
                    <div class="price-info">
                        <span class="base-price">₱${formatNumber(rate)}</span>
                        <span class="price-breakdown">(${duration.hours}hrs)</span>
                    </div>
                </td>`;
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
        const packageRates = withDriverData.provincialRates[currentPackageType];
        if (packageRates && packageRates[vehicleType] && packageRates[vehicleType][destinationKey]) {
            return parseInt(packageRates[vehicleType][destinationKey]);
        }
        return 0;
    }
    
    function renderProvincialRateTable() {
        const tbody = document.getElementById('provincialTableBodyWD');
        const thead = document.getElementById('provincialTableHeaderWD');
        
        if (!withDriverData.vehicleTypes || withDriverData.vehicleTypes.length === 0) {
            tbody.innerHTML = '<td><td colspan="100%" class="text-center">No vehicle types available</td></tr>';
            return;
        }
        
        if (!withDriverData.provincialDestinations || withDriverData.provincialDestinations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" class="text-center">No provincial destinations configured. Click "Add Destination" to add destinations.</td></tr>';
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
            rowsHtml += `<td><strong>${escapeHtml(vehicleType)}</strong></td>`;
            
            for (const destination of withDriverData.provincialDestinations) {
                const rate = getProvincialRate(vehicleType, destination.key);
                
                rowsHtml += `<td class="rate-price" data-vehicle-type="${vehicleType}" data-destination="${destination.key}" data-current-rate="${rate}" style="min-width: 150px;">
                    <div class="price-info">
                        <span class="base-price">₱${formatNumber(rate)}</span>
                    </div>
                </td>`;
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
                const response = await fetch(`${API_BASE_URL}/metro-manila/rates`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vehicleType: vehicleType,
                        rateType: currentRateType,
                        duration: durationKey,
                        price: newRate
                    })
                });
                
                if (!response.ok) throw new Error('Failed to save rate');
                
                // If rate is 0, delete from local data
                if (newRate === 0) {
                    if (withDriverData.metroManilaRates[currentRateType] &&
                        withDriverData.metroManilaRates[currentRateType][vehicleType] &&
                        withDriverData.metroManilaRates[currentRateType][vehicleType][durationKey]) {
                        delete withDriverData.metroManilaRates[currentRateType][vehicleType][durationKey];
                    }
                    if (withDriverData.metroManilaRates[currentRateType] &&
                        withDriverData.metroManilaRates[currentRateType][vehicleType] &&
                        Object.keys(withDriverData.metroManilaRates[currentRateType][vehicleType]).length === 0) {
                        delete withDriverData.metroManilaRates[currentRateType][vehicleType];
                    }
                } else {
                    if (!withDriverData.metroManilaRates[currentRateType]) {
                        withDriverData.metroManilaRates[currentRateType] = {};
                    }
                    if (!withDriverData.metroManilaRates[currentRateType][vehicleType]) {
                        withDriverData.metroManilaRates[currentRateType][vehicleType] = {};
                    }
                    withDriverData.metroManilaRates[currentRateType][vehicleType][durationKey] = newRate;
                }
                
                cell.setAttribute('data-current-rate', newRate);
                
                if (newRate === 0) {
                    showNotification('Rate deleted successfully (set to 0)', 'info');
                } else {
                    showNotification('Rate saved successfully', 'success');
                }
                
                renderMetroManilaRateTable();
            } catch (error) {
                console.error('Save error:', error);
                showNotification('Failed to save rate', 'error');
                cell.innerHTML = originalContent;
            }
        };
        
        input.addEventListener('blur', savePrice);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                savePrice();
            } else if (e.key === 'Escape') {
                cell.innerHTML = originalContent;
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
                const response = await fetch(`${API_BASE_URL}/provincial/rates`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vehicleType: vehicleType,
                        packageType: currentPackageType,
                        destination: destinationKey,
                        price: newRate
                    })
                });
                
                if (!response.ok) throw new Error('Failed to save rate');
                
                // If rate is 0 or deleted, remove from local data
                if (newRate === 0) {
                    // Delete the rate from local data if it exists
                    if (withDriverData.provincialRates[currentPackageType] &&
                        withDriverData.provincialRates[currentPackageType][vehicleType] &&
                        withDriverData.provincialRates[currentPackageType][vehicleType][destinationKey]) {
                        delete withDriverData.provincialRates[currentPackageType][vehicleType][destinationKey];
                    }
                    // If the vehicle type has no more rates, clean up
                    if (withDriverData.provincialRates[currentPackageType] &&
                        withDriverData.provincialRates[currentPackageType][vehicleType] &&
                        Object.keys(withDriverData.provincialRates[currentPackageType][vehicleType]).length === 0) {
                        delete withDriverData.provincialRates[currentPackageType][vehicleType];
                    }
                } else {
                    // Update local data
                    if (!withDriverData.provincialRates[currentPackageType]) {
                        withDriverData.provincialRates[currentPackageType] = {};
                    }
                    if (!withDriverData.provincialRates[currentPackageType][vehicleType]) {
                        withDriverData.provincialRates[currentPackageType][vehicleType] = {};
                    }
                    withDriverData.provincialRates[currentPackageType][vehicleType][destinationKey] = newRate;
                }
                
                cell.setAttribute('data-current-rate', newRate);
                
                if (newRate === 0) {
                    showNotification('Rate deleted successfully (set to 0)', 'info');
                } else {
                    showNotification('Rate saved successfully', 'success');
                }
                
                renderProvincialRateTable();
            } catch (error) {
                console.error('Save error:', error);
                showNotification('Failed to save rate', 'error');
                cell.innerHTML = originalContent;
            }
        };
        
        input.addEventListener('blur', savePrice);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                savePrice();
            } else if (e.key === 'Escape') {
                cell.innerHTML = originalContent;
            }
        });
    }
    
    // ========== LOAD RATE DATA ==========

    async function loadRateData() {
        try {
            const response = await fetch(`${API_BASE_URL}/rates/all`);
            if (!response.ok) throw new Error('Failed to load rate data');
            const data = await response.json();
            withDriverData.metroManilaRates = data.metroManila || {};
            withDriverData.provincialRates = data.provincial || {};
            
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
            loadRateData()
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
        } catch (error) {
            showNotification('Failed to toggle duration', 'error');
        }
    }
    
    async function deleteWithDriverDuration(durationKey) {
        const confirmed = await showConfirmModal('Delete Duration', 'Are you sure you want to delete this duration? This action cannot be undone.');
        if (!confirmed) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/durations/${durationKey}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete duration');
            showNotification('Duration deleted successfully');
            await loadWithDriverDurations();
        } catch (error) {
            showNotification('Failed to delete duration', 'error');
        }
    }
    
    async function refreshWithDriverData() {
        if (window.withDriverInitialized) {
            await Promise.all([
                loadDestinationsList(),
                loadProvincialDestinations(),
                loadWithDriverDurations(),
                loadRateData()
            ]);
        }
    }

    async function toggleWithDriverDuration(durationKey) {
        try {
            const response = await fetch(`${API_BASE_URL}/durations/${durationKey}/toggle`, { 
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error('Failed to toggle duration');
            const data = await response.json();
            showNotification(data.message);
            await loadWithDriverDurations();
        } catch (error) {
            showNotification('Failed to toggle duration', 'error');
        }
    }

    async function toggleProvincialDestination(destinationKey) {
        try {
            const response = await fetch(`${API_BASE_URL}/provincial/destinations/${destinationKey}/toggle`, { 
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' }
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
    
    // Expose module globally
    window.withDriver = {
        initialize: initializeWithDriver,
        refresh: refreshWithDriverData,
        deleteDestination: deleteProvincialDestination,
        toggleDestination: toggleProvincialDestination,
        toggleDuration: toggleWithDriverDuration,
        deleteDuration: deleteWithDriverDuration
    };
    
    window.initializeWithDriver = initializeWithDriver;
    window.withDriverInitialized = false;
})();