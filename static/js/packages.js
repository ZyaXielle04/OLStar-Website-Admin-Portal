// ============================================
// Packages Management Functions WITH CSRF SUPPORT
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

const userRole =
    document.querySelector('.user-role')
        ?.innerText
        ?.toLowerCase() || 'admin';

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

document.addEventListener('DOMContentLoaded', function () {

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

    if (
        !forceRefresh &&
        cachedPackages &&
        lastFetchTime &&
        (Date.now() - lastFetchTime) < CACHE_DURATION
    ) {
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

        const response = await apiRequest('/api/common/packages', {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        pendingRequest = null;

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        cachedPackages = data.packages || [];
        lastFetchTime = Date.now();

        allPackages = cachedPackages;

        applyFilters();

    } catch (error) {

        if (error.name !== 'AbortError') {
            console.error('Error loading packages:', error);

            showError('Failed to load packages');
            toastError('Failed to load packages', 'Error');
        }

    } finally {

        isLoading = false;

        showSkeleton(false);
    }
}


function prefetchData() {

    if (!cachedPackages && !isLoading) {

        setTimeout(() => {

            apiRequest('/api/common/packages')
                .then(res => res.json())
                .then(data => {
                    cachedPackages = data.packages || [];
                    lastFetchTime = Date.now();
                })
                .catch(() => { });

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

        searchInput.addEventListener('input', function () {

            clearTimeout(debounceTimer);

            debounceTimer = setTimeout(() => {

                currentSearchTerm = this.value;

                currentPage = 1;

                if (clearSearchBtn) {
                    clearSearchBtn.style.display =
                        currentSearchTerm ? 'flex' : 'none';
                }

                applyFilters();

            }, DEBOUNCE_DELAY);
        });
    }

    if (clearSearchBtn) {

        clearSearchBtn.addEventListener('click', function () {

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

        const searchLower =
            currentSearchTerm.toLowerCase().trim();

        filteredPackages = filteredPackages.filter(pkg => {

            const vehicleTypes = Array.isArray(pkg.vehicleTypes)
                ? pkg.vehicleTypes.join(' ').toLowerCase()
                : '';

            return (
                (pkg.id || '')
                    .toLowerCase()
                    .includes(searchLower)
                ||
                (pkg.packageName || '')
                    .toLowerCase()
                    .includes(searchLower)
                ||
                vehicleTypes.includes(searchLower)
            );
        });
    }

    totalPages =
        Math.ceil(filteredPackages.length / ITEMS_PER_PAGE);

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;

    const paginatedPackages =
        filteredPackages.slice(start, end);

    renderPackagesTable(
        paginatedPackages,
        filteredPackages.length
    );

    updatePaginationControls();
}


function renderPackagesTable(packages, totalCount) {

    const tbody =
        document.getElementById('packagesTableBody');

    if (!tbody) return;

    if (!packages || packages.length === 0) {

        tbody.innerHTML =
            '<tr><td colspan="7" class="empty-state">No packages found</td></tr>';

        updatePaginationInfo(0);

        return;
    }

    tbody.innerHTML = '';

    packages.forEach(pkg => {

        const row = document.createElement('tr');

        let actions = `
            <button class="btn-icon btn-view"
                onclick="viewPackage('${pkg.id}')"
                title="View">
                <i class="fas fa-eye"></i>
            </button>
        `;

        if (userRole === 'superadmin') {

            actions += `
                <button class="btn-icon btn-edit"
                    onclick="editPackage('${pkg.id}')"
                    title="Edit">
                    <i class="fas fa-edit"></i>
                </button>

                <button class="btn-icon btn-delete"
                    onclick="deletePackage('${pkg.id}', '${escapeHtml(pkg.packageName)}')"
                    title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }

        const vehicleTypes = Array.isArray(pkg.vehicleTypes)
            ? pkg.vehicleTypes.join(', ')
            : 'N/A';

        row.innerHTML = `
            <td><strong>${escapeHtml(pkg.id)}</strong></td>
            <td>${escapeHtml(pkg.packageName)}</td>
            <td>${pkg.maxPax || 0}</td>
            <td>${pkg.maxLuggage || 0}</td>
            <td>${escapeHtml(vehicleTypes)}</td>
            <td>${pkg.created_at ? new Date(pkg.created_at).toLocaleDateString() : 'N/A'}</td>
            <td class="action-buttons">${actions}</td>
        `;

        tbody.appendChild(row);
    });

    updatePaginationInfo(totalCount);
}


function updatePaginationInfo(totalCount) {

    const paginationInfo =
        document.getElementById('paginationInfo');

    if (!paginationInfo) return;

    const start =
        (currentPage - 1) * ITEMS_PER_PAGE + 1;

    const end =
        Math.min(start + ITEMS_PER_PAGE - 1, totalCount);

    if (totalCount > 0) {

        paginationInfo.textContent =
            `Showing ${start}-${end} of ${totalCount} packages`;

    } else {

        paginationInfo.textContent =
            'Showing 0 of 0 packages';
    }
}


function updatePaginationControls() {

    const prevPageBtn =
        document.getElementById('prevPageBtn');

    const nextPageBtn =
        document.getElementById('nextPageBtn');

    const pageInfo =
        document.getElementById('pageInfo');

    if (prevPageBtn) {
        prevPageBtn.disabled =
            currentPage === 1 || totalPages === 0;
    }

    if (nextPageBtn) {
        nextPageBtn.disabled =
            currentPage === totalPages || totalPages === 0;
    }

    if (pageInfo) {

        if (totalPages > 0) {

            pageInfo.textContent =
                `Page ${currentPage} of ${totalPages}`;

        } else {

            pageInfo.textContent =
                'Page 0 of 0';
        }
    }
}


function showSkeleton(show) {

    const tbody =
        document.getElementById('packagesTableBody');

    if (!tbody) return;

    if (show) {

        const skeletonRows = [];

        for (let i = 0; i < ITEMS_PER_PAGE; i++) {

            skeletonRows.push(`
                <tr class="skeleton-row">
                    <td><div class="skeleton-cell"></div></td>
                    <td><div class="skeleton-cell"></div></td>
                    <td><div class="skeleton-cell"></div></td>
                    <td><div class="skeleton-cell"></div></td>
                    <td><div class="skeleton-cell"></div></td>
                    <td><div class="skeleton-cell"></div></td>
                    <td><div class="skeleton-cell"></div></td>
                </table>
            `);
        }

        tbody.innerHTML = skeletonRows.join('');
    }
}


function showError(message) {

    const tbody =
        document.getElementById('packagesTableBody');

    if (tbody) {
        tbody.innerHTML =
            `<tr><td colspan="7" class="error-state">${message}</td></tr>`;
    }
}


function viewPackage(packageId) {
    window.location.href = `/packages/${packageId}/view`;
}


function editPackage(packageId) {
    window.location.href = `/packages/${packageId}/edit`;
}


function deletePackage(packageId, packageName) {

    showConfirmModal({
        title: 'Delete Package',
        message:
            `Are you sure you want to delete "${packageName}"?`,
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',

        onConfirm: async () => {

            try {

                const response =
                    await apiRequest(`/api/common/packages/${packageId}`, {
                        method: 'DELETE'
                    });

                if (response.ok) {

                    toastSuccess(
                        `${packageName} deleted successfully`,
                        'Deleted'
                    );

                    cachedPackages = null;

                    loadPackages(true);

                } else {

                    const error = await response.json();

                    toastError(
                        error.error || 'Failed to delete package',
                        'Error'
                    );
                }

            } catch (error) {

                console.error(error);

                toastError(
                    'An unexpected error occurred',
                    'Error'
                );
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


window.addEventListener('beforeunload', () => {

    if (pendingRequest) {
        pendingRequest.abort();
    }
});