// ============================================
// Transport Units Management Functions - WITH CSRF SUPPORT
// ============================================

let allUnits = [];
let currentTypeFilter = 'all';
let currentAvailabilityFilter = 'all';
let currentSearchTerm = '';
let currentPage = 1;
const ITEMS_PER_PAGE = 10;
let totalPages = 1;
let rowPreviewPopup = null;
let hoverTimeout = null;
let cachedUnits = null;
let lastFetchTime = null;
let isLoading = false;
let pendingRequest = null;

const CACHE_DURATION = 30000; // 30 seconds cache
const DEBOUNCE_DELAY = 300;

// Get current user role from session
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
    if (window.prefetchedUnits) {
        console.log('Using prefetched data');
        allUnits = window.prefetchedUnits;
        cachedUnits = window.prefetchedUnits;
        lastFetchTime = Date.now();
        applyFilters();
        showSkeleton(false);
    } else {
        loadUnits();
    }
    
    setupEventListeners();
    prefetchData();
});

async function loadUnits(forceRefresh = false) {
    if (isLoading) return;
    
    // Check cache
    if (!forceRefresh && cachedUnits && lastFetchTime && 
        (Date.now() - lastFetchTime) < CACHE_DURATION) {
        console.log('Using cached data');
        allUnits = cachedUnits;
        applyFilters();
        return;
    }
    
    isLoading = true;
    showSkeleton(true);
    
    try {
        // Abort previous request if exists
        if (pendingRequest) {
            pendingRequest.abort();
        }
        
        const controller = new AbortController();
        pendingRequest = controller;
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await apiRequest('/api/common/transport-units', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        pendingRequest = null;
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Store in cache
        cachedUnits = data.units || [];
        lastFetchTime = Date.now();
        allUnits = cachedUnits;
        
        // Prefetch next data
        prefetchData();
        
        applyFilters();
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request aborted');
        } else {
            console.error('Error loading units:', error);
            showError('Failed to load transport units');
            toastError('Failed to load transport units', 'Error');
            
            // Use cached data if available
            if (cachedUnits) {
                allUnits = cachedUnits;
                applyFilters();
                toastWarning('Using cached data', 'Offline Mode');
            }
        }
    } finally {
        isLoading = false;
        showSkeleton(false);
    }
}

function prefetchData() {
    // Prefetch data for next page load
    if (!cachedUnits && !isLoading) {
        setTimeout(() => {
            apiRequest('/api/common/transport-units')
                .then(res => res.json())
                .then(data => {
                    cachedUnits = data.units || [];
                    lastFetchTime = Date.now();
                    console.log('Prefetched transport units data');
                })
                .catch(err => console.log('Prefetch failed:', err));
        }, 3000);
    }
}

function setupEventListeners() {
    // Add Unit button
    const addUnitBtn = document.getElementById('addUnitBtn');
    if (addUnitBtn) {
        addUnitBtn.addEventListener('click', () => {
            window.location.href = '/transport-units/create';
        });
    }
    
    // Type filter
    const typeFilter = document.getElementById('typeFilter');
    if (typeFilter) {
        typeFilter.addEventListener('change', function() {
            currentTypeFilter = this.value;
            currentPage = 1;
            applyFilters();
        });
    }
    
    // Availability filter
    const availabilityFilter = document.getElementById('availabilityFilter');
    if (availabilityFilter) {
        availabilityFilter.addEventListener('change', function() {
            currentAvailabilityFilter = this.value;
            currentPage = 1;
            applyFilters();
        });
    }
    
    // Search input with debounce
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentSearchTerm = this.value;
                currentPage = 1;
                
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = currentSearchTerm ? 'flex' : 'none';
                }
                
                applyFilters();
            }, DEBOUNCE_DELAY);
        });
    }
    
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
            if (searchInput) {
                searchInput.value = '';
                currentSearchTerm = '';
                currentPage = 1;
                clearSearchBtn.style.display = 'none';
                applyFilters();
            }
        });
    }
    
    // Pagination buttons
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                applyFilters();
            }
        });
    }
    
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                applyFilters();
            }
        });
    }
}

function applyFilters() {
    let filteredUnits = [...allUnits];
    
    // Apply type filter
    if (currentTypeFilter !== 'all') {
        filteredUnits = filteredUnits.filter(unit => unit.unitType === currentTypeFilter);
    }
    
    // Apply availability filter
    if (currentAvailabilityFilter !== 'all') {
        const isAvailable = currentAvailabilityFilter === 'available';
        filteredUnits = filteredUnits.filter(unit => unit.isAvailable === isAvailable);
    }
    
    // Apply search filter
    if (currentSearchTerm.trim() !== '') {
        const searchLower = currentSearchTerm.toLowerCase().trim();
        filteredUnits = filteredUnits.filter(unit => {
            return (unit.id || '').toLowerCase().includes(searchLower) ||
                   (unit.plateNumber || '').toLowerCase().includes(searchLower) ||
                   (unit.transportUnit || '').toLowerCase().includes(searchLower);
        });
    }
    
    // Update pagination
    totalPages = Math.ceil(filteredUnits.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedUnits = filteredUnits.slice(start, end);
    
    // Use requestAnimationFrame for smooth rendering
    requestAnimationFrame(() => {
        renderUnitsTable(paginatedUnits, filteredUnits.length);
    });
    
    updatePaginationControls();
}

function renderUnitsTable(units, totalCount) {
    const tbody = document.getElementById('unitsTableBody');
    
    if (!tbody) return;
    
    if (!units || units.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No transport units found</td></tr>';
        updatePaginationInfo(0);
        updatePaginationControls();
        return;
    }
    
    // Use DocumentFragment for batch DOM updates (faster)
    const fragment = document.createDocumentFragment();
    
    units.forEach(unit => {
        const row = document.createElement('tr');
        const statusClass = unit.isAvailable ? 'badge-available' : 'badge-unavailable';
        const statusText = unit.isAvailable ? 'Available' : 'Unavailable';
        
        // Store unit data for hover preview
        row.setAttribute('data-unit-id', unit.id);
        row.setAttribute('data-unit-name', unit.transportUnit);
        if (unit.imageUrl) {
            row.setAttribute('data-image-url', unit.imageUrl);
        }
        
        // Optimized image loading with lazy loading
        let imageHtml = '';
        if (unit.imageUrl) {
            // Use Cloudinary's automatic optimization parameters
            const optimizedUrl = unit.imageUrl.replace('/upload/', '/upload/q_auto,f_auto,w_50,h_50,c_fill/');
            imageHtml = `<img src="${optimizedUrl}" alt="${unit.transportUnit}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 8px;" loading="lazy">`;
        } else {
            imageHtml = `<div style="width: 40px; height: 40px; background: #F1F5F9; border-radius: 8px; display: flex; align-items: center; justify-content: center;"><i class="fas fa-image" style="color: #94A3B8;"></i></div>`;
        }
        
        // Build action buttons
        let actions = `
            <button class="btn-icon btn-view" onclick="viewUnit('${unit.id}')" title="View">
                <i class="fas fa-eye"></i>
            </button>
        `;
        
        if (userRole === 'superadmin') {
            actions += `
                <button class="btn-icon btn-edit" onclick="editUnit('${unit.id}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-icon btn-toggle ${unit.isAvailable ? 'available' : 'unavailable'}" onclick="toggleAvailability('${unit.id}', ${unit.isAvailable})" title="Toggle Status">
                    <i class="fas fa-power-off"></i>
                </button>
                <button class="btn-icon btn-delete" onclick="deleteUnit('${unit.id}', '${escapeHtml(unit.transportUnit)}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }
        
        row.innerHTML = `
            <td>${imageHtml}</td>
            <td><strong>${escapeHtml(unit.id)}</strong></td>
            <td>${escapeHtml(unit.transportUnit)}</td>
            <td>${escapeHtml(unit.plateNumber)}</td>
            <td>${escapeHtml(unit.color)}</td>
            <td>${escapeHtml(unit.unitType)}</td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
            <td class="action-buttons">${actions}</td>
        `;
        
        // Add hover event listeners
        row.addEventListener('mouseenter', (e) => {
            hoverTimeout = setTimeout(() => {
                showRowPreview(unit, e);
            }, 500);
        });
        
        row.addEventListener('mouseleave', () => {
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                hoverTimeout = null;
            }
            hideRowPreview();
        });
        
        row.addEventListener('mousemove', (e) => {
            if (rowPreviewPopup && rowPreviewPopup.classList.contains('show')) {
                requestAnimationFrame(() => updatePreviewPosition(e));
            }
        });
        
        fragment.appendChild(row);
    });
    
    // Batch DOM update
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
    
    updatePaginationInfo(totalCount);
    updatePaginationControls();
}

function updatePaginationInfo(totalCount) {
    const paginationInfo = document.getElementById('paginationInfo');
    if (paginationInfo) {
        const start = (currentPage - 1) * ITEMS_PER_PAGE + 1;
        const end = Math.min(start + ITEMS_PER_PAGE - 1, totalCount);
        
        if (totalCount > 0) {
            paginationInfo.textContent = `Showing ${start}-${end} of ${totalCount} units`;
        } else {
            paginationInfo.textContent = 'Showing 0 of 0 units';
        }
    }
}

function updatePaginationControls() {
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    
    if (prevPageBtn) {
        prevPageBtn.disabled = currentPage === 1 || totalPages === 0;
    }
    
    if (nextPageBtn) {
        nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
    }
    
    if (pageInfo) {
        if (totalPages > 0) {
            pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        } else {
            pageInfo.textContent = 'Page 0 of 0';
        }
    }
}

function showRowPreview(unit, event) {
    if (!rowPreviewPopup) {
        rowPreviewPopup = document.createElement('div');
        rowPreviewPopup.className = 'row-image-preview';
        document.body.appendChild(rowPreviewPopup);
    }
    
    if (unit.imageUrl) {
        // Use optimized image for preview
        const optimizedUrl = unit.imageUrl.replace('/upload/', '/upload/q_auto,f_auto,w_250,h_180,c_fill/');
        rowPreviewPopup.innerHTML = `<img src="${optimizedUrl}" alt="${escapeHtml(unit.transportUnit)}" loading="lazy">`;
    } else {
        rowPreviewPopup.innerHTML = `
            <div class="no-image-preview">
                <i class="fas fa-image"></i>
                <span>No image available for<br>${escapeHtml(unit.transportUnit)}</span>
            </div>
        `;
    }
    
    updatePreviewPosition(event);
    rowPreviewPopup.classList.add('show');
}

function updatePreviewPosition(event) {
    if (!rowPreviewPopup) return;
    
    let x = event.clientX + 15;
    let y = event.clientY + 15;
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const wasVisible = rowPreviewPopup.classList.contains('show');
    if (!wasVisible) {
        rowPreviewPopup.style.visibility = 'hidden';
        rowPreviewPopup.classList.add('show');
    }
    
    const popupRect = rowPreviewPopup.getBoundingClientRect();
    
    if (!wasVisible) {
        rowPreviewPopup.classList.remove('show');
        rowPreviewPopup.style.visibility = '';
    }
    
    if (x + popupRect.width + 10 > viewportWidth) {
        x = event.clientX - popupRect.width - 15;
    }
    
    if (y + popupRect.height + 10 > viewportHeight) {
        y = event.clientY - popupRect.height - 15;
    }
    
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    
    rowPreviewPopup.style.left = x + 'px';
    rowPreviewPopup.style.top = y + 'px';
}

function hideRowPreview() {
    if (rowPreviewPopup) {
        rowPreviewPopup.classList.remove('show');
    }
}

function showSkeleton(show) {
    const tbody = document.getElementById('unitsTableBody');
    if (!tbody) return;
    
    if (show) {
        const skeletonRows = [];
        for (let i = 0; i < ITEMS_PER_PAGE; i++) {
            skeletonRows.push(`
                <tr class="skeleton-row">
                    <td><div class="skeleton-cell" style="width: 40px; height: 40px; border-radius: 8px;"></div></td>
                    <td><div class="skeleton-cell" style="width: 80px"></div></td>
                    <td><div class="skeleton-cell" style="width: 120px"></div></td>
                    <td><div class="skeleton-cell" style="width: 100px"></div></td>
                    <td><div class="skeleton-cell" style="width: 80px"></div></td>
                    <td><div class="skeleton-cell" style="width: 60px"></div></td>
                    <td><div class="skeleton-cell" style="width: 80px"></div></td>
                    <td><div class="skeleton-cell" style="width: 120px"></div></td>
                </tr>
            `);
        }
        tbody.innerHTML = skeletonRows.join('');
    }
}

function showError(message) {
    const tbody = document.getElementById('unitsTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="error-state">${message}</td></tr>`;
    }
}

// Action functions
function viewUnit(unitId) {
    window.location.href = `/transport-units/${unitId}/view`;
}

function editUnit(unitId) {
    window.location.href = `/transport-units/${unitId}/edit`;
}

async function toggleAvailability(unitId, currentStatus) {
    const newStatus = !currentStatus;
    const action = newStatus ? 'available' : 'unavailable';
    
    showConfirmModal({
        title: newStatus ? 'Make Available' : 'Mark as Unavailable',
        message: `Are you sure you want to mark this unit as ${action}?`,
        confirmText: newStatus ? 'Make Available' : 'Mark Unavailable',
        confirmIcon: 'fa-power-off',
        cancelText: 'Cancel',
        type: 'warning',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/transport-units/${unitId}/toggle-availability`, {
                    method: 'PATCH'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    toastSuccess(data.message, 'Status Updated');
                    // Clear cache and reload
                    cachedUnits = null;
                    loadUnits(true);
                } else {
                    const error = await response.json();
                    toastError(error.error || 'Failed to update status', 'Error');
                }
            } catch (error) {
                console.error('Error toggling availability:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

function deleteUnit(unitId, unitName) {
    showConfirmModal({
        title: 'Delete Transport Unit',
        message: `Are you sure you want to delete "${unitName}"? This action cannot be undone.`,
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await apiRequest(`/api/common/transport-units/${unitId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    toastSuccess(`${unitName} has been deleted successfully`, 'Unit Deleted');
                    // Clear cache and reload
                    cachedUnits = null;
                    loadUnits(true);
                } else {
                    const error = await response.json();
                    toastError(error.error || 'Failed to delete unit', 'Deletion Failed');
                }
            } catch (error) {
                console.error('Error deleting unit:', error);
                toastError('An unexpected error occurred', 'Error');
            }
        }
    });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (rowPreviewPopup) {
        rowPreviewPopup.remove();
        rowPreviewPopup = null;
    }
    if (pendingRequest) {
        pendingRequest.abort();
    }
});