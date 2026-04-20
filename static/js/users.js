// ============================================
// User Management Page Functions - OPTIMIZED
// ============================================

let allUsers = [];
let currentRoleFilter = 'all';
let currentSearchTerm = '';
let cachedUsers = null;
let lastFetchTime = null;
let isLoading = false;
let currentPage = 1;
const ITEMS_PER_PAGE = 10;  // Changed from 20 to 10
let totalPages = 1;

const CACHE_DURATION = 30000; // 30 seconds cache

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
    // Check if data was prefetched
    if (window.prefetchedUsers) {
        console.log('Using prefetched data');
        allUsers = window.prefetchedUsers;
        cachedUsers = window.prefetchedUsers;
        lastFetchTime = Date.now();
        applyFilters();
        showSkeleton(false);
    } else {
        loadUsers();
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Prefetch data for next time
    prefetchData();
});

async function loadUsers(forceRefresh = false) {
    if (isLoading) return;
    
    // Check cache
    if (!forceRefresh && cachedUsers && lastFetchTime && 
        (Date.now() - lastFetchTime) < CACHE_DURATION) {
        console.log('Using cached data');
        allUsers = cachedUsers;
        applyFilters();
        return;
    }
    
    isLoading = true;
    showSkeleton(true);
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch('/api/common/users', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Store in cache
        cachedUsers = data.users || [];
        lastFetchTime = Date.now();
        allUsers = cachedUsers;
        
        // Prefetch next data in background
        prefetchData();
        
        applyFilters();
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Request timeout');
            showError('Request timed out. Please check your connection.');
        } else {
            console.error('Error loading users:', error);
            showError('Failed to load users. Please refresh the page.');
        }
        
        // Show cached data if available
        if (cachedUsers) {
            console.log('Falling back to cached data');
            allUsers = cachedUsers;
            applyFilters();
            toastWarning('Using cached data. Some information may be outdated.', 'Offline Mode');
        }
    } finally {
        isLoading = false;
        showSkeleton(false);
    }
}

function prefetchData() {
    // Prefetch data for next page load
    if (!cachedUsers && !isLoading) {
        setTimeout(() => {
            fetch('/api/common/users')
                .then(res => res.json())
                .then(data => {
                    cachedUsers = data.users || [];
                    lastFetchTime = Date.now();
                    console.log('Prefetched data for next load');
                })
                .catch(err => console.log('Prefetch failed:', err));
        }, 3000);
    }
}

function setupEventListeners() {
    // Add User button
    const addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => {
            window.location.href = '/users/create';
        });
    }
    
    // Role filter dropdown
    const roleFilter = document.getElementById('roleFilter');
    if (roleFilter) {
        roleFilter.addEventListener('change', function() {
            currentRoleFilter = this.value;
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
            }, 300);
        });
    }
    
    // Clear search button
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
    
    // Pagination controls
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
    let filteredUsers = [...allUsers];
    
    // Apply role filter
    if (currentRoleFilter !== 'all') {
        filteredUsers = filteredUsers.filter(user => user.role === currentRoleFilter);
    }
    
    // Apply search filter (by name or email)
    if (currentSearchTerm.trim() !== '') {
        const searchLower = currentSearchTerm.toLowerCase().trim();
        filteredUsers = filteredUsers.filter(user => {
            const name = (user.fullName || user.display_name || '').toLowerCase();
            const email = (user.email || '').toLowerCase();
            return name.includes(searchLower) || email.includes(searchLower);
        });
    }
    
    // Update pagination
    totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedUsers = filteredUsers.slice(start, end);
    
    renderUsersTable(paginatedUsers, filteredUsers.length, start, end);
    updatePaginationControls();
}

function renderUsersTable(users, totalCount, start, end) {
    const tbody = document.getElementById('usersTableBody');
    
    if (!tbody) return;
    
    const fragment = document.createDocumentFragment();
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found</td></tr>';
        updatePaginationInfo(0);
        return;
    }
    
    users.forEach(user => {
        const row = document.createElement('tr');
        
        let roleBadgeClass = 'badge-info';
        if (user.role === 'admin') {
            roleBadgeClass = 'badge-danger';
        } else if (user.role === 'superadmin') {
            roleBadgeClass = 'badge-warning';
        }
        
        // Handle created_at
        let createdDate = 'N/A';
        if (user.created_at) {
            createdDate = new Date(user.created_at).toLocaleDateString();
        }
        
        row.innerHTML = `
            <td>${escapeHtml(user.fullName || user.display_name || 'N/A')}</td>
            <td>${escapeHtml(user.email)}</td>
            <td><span class="badge ${roleBadgeClass}">${user.role}</span></td>
            <td>${createdDate}</td>
            <td class="action-buttons">
                <button class="btn-icon btn-edit" onclick="location.href='/users/${user.id}/edit'" title="Edit">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn-icon btn-delete" onclick="deleteUser('${user.id}', '${escapeHtml(user.fullName || user.display_name)}')" title="Delete">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </td>
        `;
        
        fragment.appendChild(row);
    });
    
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
    
    updatePaginationInfo(totalCount);
}

function updatePaginationInfo(totalCount) {
    const paginationInfo = document.getElementById('paginationInfo');
    if (paginationInfo) {
        const start = (currentPage - 1) * ITEMS_PER_PAGE + 1;
        const end = Math.min(start + ITEMS_PER_PAGE - 1, totalCount);
        
        if (totalCount > 0) {
            paginationInfo.textContent = `Showing ${start}-${end} of ${totalCount} users`;
        } else {
            paginationInfo.textContent = 'Showing 0 of 0 users';
        }
    }
}

function updatePaginationControls() {
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    
    if (prevPageBtn) {
        prevPageBtn.disabled = currentPage === 1;
    }
    
    if (nextPageBtn) {
        nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
    }
    
    if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
    }
}

// Skeleton Loader - Show 10 skeleton rows
function showSkeleton(show) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    if (show) {
        const skeletonRows = [];
        for (let i = 0; i < ITEMS_PER_PAGE; i++) {
            skeletonRows.push(`
                <tr class="skeleton-row">
                    <td><div class="skeleton-cell" style="width: 80%"></div></td>
                    <td><div class="skeleton-cell" style="width: 90%"></div></td>
                    <td><div class="skeleton-cell" style="width: 60%"></div></td>
                    <td><div class="skeleton-cell" style="width: 70%"></div></td>
                    <td><div class="skeleton-cell" style="width: 120px"></div></td>
                </tr>
            `);
        }
        tbody.innerHTML = skeletonRows.join('');
    }
}

function showError(message) {
    const tbody = document.getElementById('usersTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" class="error-state">${message}</td></tr>`;
    }
}

async function deleteUser(userId, userName) {
    confirmDelete(userName, async () => {
        toastInfo('Deleting user...', 'Please wait');
        
        try {
            const response = await fetch(`/api/common/users/${userId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                cachedUsers = null;
                lastFetchTime = null;
                toastSuccess(`${userName} has been deleted successfully`, 'User Deleted');
                loadUsers(true);
            } else {
                const error = await response.json();
                toastError(error.error || 'Failed to delete user', 'Deletion Failed');
            }
        } catch (error) {
            console.error('Error deleting user:', error);
            toastError('An unexpected error occurred', 'Error');
        }
    });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}