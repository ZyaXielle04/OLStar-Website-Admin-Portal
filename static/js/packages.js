// ============================================
// Packages Management Functions
// ============================================

let allPackages = [];
let currentSearchTerm = '';
let currentPage = 1;
const ITEMS_PER_PAGE = 10;
let totalPages = 1;
let cachedPackages = null;
let lastFetchTime = null;
let isLoading = false;
let pendingRequest = null;

const CACHE_DURATION = 30000;
const DEBOUNCE_DELAY = 300;

const userRole = document.querySelector('.user-role')?.innerText?.toLowerCase() || 'admin';

document.addEventListener('DOMContentLoaded', function() {
    if (window.prefetchedPackages) {
        allPackages = window.prefetchedPackages;
        cachedPackages = window.prefetchedPackages;
        lastFetchTime = Date.now();
        applyFilters();
        showSkeleton(false);
    } else {
        loadPackages();
    }
    
    setupEventListeners();
    prefetchData();
});

async function loadPackages(forceRefresh = false) {
    if (isLoading) return;
    
    if (!forceRefresh && cachedPackages && lastFetchTime && 
        (Date.now() - lastFetchTime) < CACHE_DURATION) {
        allPackages = cachedPackages;
        applyFilters();
        return;
    }
    
    isLoading = true;
    showSkeleton(true);
    
    try {
        if (pendingRequest) {
            pendingRequest.abort();
        }
        
        const controller = new AbortController();
        pendingRequest = controller;
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch('/api/common/packages', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        pendingRequest = null;
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        cachedPackages = data.packages || [];
        lastFetchTime = Date.now();
        allPackages = cachedPackages;
        
        prefetchData();
        applyFilters();
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request aborted');
        } else {
            console.error('Error loading packages:', error);
            showError('Failed to load packages');
            toastError('Failed to load packages', 'Error');
            
            if (cachedPackages) {
                allPackages = cachedPackages;
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
    if (!cachedPackages && !isLoading) {
        setTimeout(() => {
            fetch('/api/common/packages')
                .then(res => res.json())
                .then(data => {
                    cachedPackages = data.packages || [];
                    lastFetchTime = Date.now();
                })
                .catch(err => console.log('Prefetch failed:', err));
        }, 3000);
    }
}

function setupEventListeners() {
    const addPackageBtn = document.getElementById('addPackageBtn');
    if (addPackageBtn) {
        addPackageBtn.addEventListener('click', () => {
            window.location.href = '/packages/create';
        });
    }
    
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
    let filteredPackages = [...allPackages];
    
    if (currentSearchTerm.trim() !== '') {
        const searchLower = currentSearchTerm.toLowerCase().trim();
        filteredPackages = filteredPackages.filter(pkg => {
            return (pkg.id || '').toLowerCase().includes(searchLower) ||
                   (pkg.packageName || '').toLowerCase().includes(searchLower);
        });
    }
    
    totalPages = Math.ceil(filteredPackages.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedPackages = filteredPackages.slice(start, end);
    
    requestAnimationFrame(() => {
        renderPackagesTable(paginatedPackages, filteredPackages.length);
    });
    
    updatePaginationControls();
}

function renderPackagesTable(packages, totalCount) {
    const tbody = document.getElementById('packagesTableBody');
    
    if (!tbody) return;
    
    if (!packages || packages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No packages found</td></tr>';
        updatePaginationInfo(0);
        updatePaginationControls();
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    packages.forEach(pkg => {
        const row = document.createElement('tr');
        
        let actions = `
            <button class="btn-icon btn-view" onclick="viewPackage('${pkg.id}')" title="View">
                <i class="fas fa-eye"></i>
            </button>
        `;
        
        if (userRole === 'superadmin') {
            actions += `
                <button class="btn-icon btn-edit" onclick="editPackage('${pkg.id}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-icon btn-delete" onclick="deletePackage('${pkg.id}', '${escapeHtml(pkg.packageName)}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }
        
        row.innerHTML = `
            <td><strong>${escapeHtml(pkg.id)}</strong></td>
            <td>${escapeHtml(pkg.packageName)}</td>
            <td>${pkg.maxPax || 0}</td>
            <td>${pkg.maxLuggage || 0}</td>
            <td>${pkg.unitCount || 0}</td>
            <td>${pkg.created_at ? new Date(pkg.created_at).toLocaleDateString() : 'N/A'}</td>
            <td class="action-buttons">${actions}</td>
        `;
        
        fragment.appendChild(row);
    });
    
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
            paginationInfo.textContent = `Showing ${start}-${end} of ${totalCount} packages`;
        } else {
            paginationInfo.textContent = 'Showing 0 of 0 packages';
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

function showSkeleton(show) {
    const tbody = document.getElementById('packagesTableBody');
    if (!tbody) return;
    
    if (show) {
        const skeletonRows = [];
        for (let i = 0; i < ITEMS_PER_PAGE; i++) {
            skeletonRows.push(`
                <tr class="skeleton-row">
                    <td><div class="skeleton-cell" style="width: 80px"></div></td>
                    <td><div class="skeleton-cell" style="width: 120px"></div></td>
                    <td><div class="skeleton-cell" style="width: 50px"></div></td>
                    <td><div class="skeleton-cell" style="width: 50px"></div></td>
                    <td><div class="skeleton-cell" style="width: 50px"></div></td>
                    <td><div class="skeleton-cell" style="width: 100px"></div></td>
                    <td><div class="skeleton-cell" style="width: 120px"></div></td>
                </tr>
            `);
        }
        tbody.innerHTML = skeletonRows.join('');
    }
}

function showError(message) {
    const tbody = document.getElementById('packagesTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="error-state">${message}</td></tr>`;
    }
}

// Action functions
function viewPackage(packageId) {
    window.location.href = `/packages/${packageId}/view`;
}

function editPackage(packageId) {
    window.location.href = `/packages/${packageId}/edit`;
}

function deletePackage(packageId, packageName) {
    showConfirmModal({
        title: 'Delete Package',
        message: `Are you sure you want to delete "${packageName}"? This action cannot be undone.`,
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: async () => {
            try {
                const response = await fetch(`/api/common/packages/${packageId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    toastSuccess(`${packageName} has been deleted successfully`, 'Package Deleted');
                    cachedPackages = null;
                    loadPackages(true);
                } else {
                    const error = await response.json();
                    toastError(error.error || 'Failed to delete package', 'Deletion Failed');
                }
            } catch (error) {
                console.error('Error deleting package:', error);
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
    if (pendingRequest) {
        pendingRequest.abort();
    }
});