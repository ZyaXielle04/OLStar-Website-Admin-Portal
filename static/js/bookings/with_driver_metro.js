// static/js/bookings/with_driver_metro.js - Metro Point-to-Point Booking Management

// ============================================
// CSRF TOKEN HELPER FUNCTIONS
// ============================================

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

async function apiRequest(url, options = {}) {
    const method = options.method || 'GET';
    const csrfToken = getCsrfToken();
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (method !== 'GET' && csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
    }
    
    const config = {
        ...options,
        method,
        headers,
        credentials: 'include'
    };
    
    if (method === 'GET' && config.body) {
        delete config.body;
    }
    
    return fetch(url, config);
}

// ============================================
// POLLING WITH CACHE & SCROLL PRESERVATION
// ============================================

let pollingInterval = null;
let isRefreshing = false;
let lastScrollPosition = 0;
let lastBookingIdsHash = '';
let allBookings = [];
let currentStatus = 'unassigned';
let currentSearchTerm = '';
let currentDateFilter = 'all';
let currentAreaFilter = 'all';
let currentDurationFilter = 'all';

// Cache for bookings data
let bookingsCache = {
    data: null,
    timestamp: null,
    cacheDuration: 30000, // 30 seconds cache
    isValid: function() {
        return this.data && this.timestamp && (Date.now() - this.timestamp) < this.cacheDuration;
    },
    set: function(data) {
        this.data = data;
        this.timestamp = Date.now();
    },
    get: function() {
        return this.data;
    },
    clear: function() {
        this.data = null;
        this.timestamp = null;
    }
};

// Save current scroll position
function saveScrollPosition() {
    lastScrollPosition = window.scrollY;
}

// Restore scroll position
function restoreScrollPosition() {
    if (lastScrollPosition > 0) {
        setTimeout(() => {
            window.scrollTo({
                top: lastScrollPosition,
                behavior: 'instant'
            });
        }, 50);
    }
}

// Generate unique hash of current bookings (for change detection)
function getBookingsHash(bookings) {
    return JSON.stringify(bookings.map(b => ({
        id: b.id,
        status: b.status,
        updatedAt: b.updatedAt || b.timestamp
    })));
}

// Setup polling listener
function setupPollingListener() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
    
    pollingInterval = setInterval(() => {
        if (!isRefreshing && document.hasFocus()) {
            refreshBookingsSilently();
        }
    }, 30000); // 30 seconds
    
    console.log('Auto-refresh enabled (every 30 seconds)');
}

// Silent refresh without user notification (preserves scroll)
async function refreshBookingsSilently() {
    isRefreshing = true;
    
    try {
        // Save current scroll position before refresh
        saveScrollPosition();
        
        // Check cache first
        if (bookingsCache.isValid()) {
            const cachedData = bookingsCache.get();
            const newHash = getBookingsHash(cachedData.bookings);
            
            if (newHash !== lastBookingIdsHash) {
                const oldCount = allBookings.length;
                allBookings = cachedData.bookings;
                lastBookingIdsHash = newHash;
                
                // Update UI without full re-render if possible
                updateStats();
                updateStatusCounts();
                
                // Only re-render if necessary
                if (needsReRender(cachedData.bookings)) {
                    renderBookingsCards();
                } else {
                    // Just update counts and badges without re-rendering cards
                    updateCardStatuses(cachedData.bookings);
                }
                
                // Notify only for new bookings (but don't disrupt)
                if (cachedData.bookings.length > oldCount) {
                    toastInfo(`${cachedData.bookings.length - oldCount} new booking(s) received!`, 'Update');
                }
            }
        } else {
            // Fetch fresh data
            const response = await apiRequest(`/api/common/with-driver-metro/bookings?status=all&_t=${Date.now()}`);
            
            if (!response.ok) {
                throw new Error('Failed to refresh');
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Update cache
                bookingsCache.set(data);
                
                const newHash = getBookingsHash(data.bookings);
                
                if (newHash !== lastBookingIdsHash) {
                    const oldCount = allBookings.length;
                    allBookings = data.bookings;
                    lastBookingIdsHash = newHash;
                    
                    updateStats();
                    updateStatusCounts();
                    renderBookingsCards();
                    
                    // Optional: Notify only for new bookings
                    if (data.bookings.length > oldCount) {
                        toastInfo(`${data.bookings.length - oldCount} new booking(s) received!`, 'Update');
                    }
                }
            }
        }
        
        // Restore scroll position after refresh
        restoreScrollPosition();
        
    } catch (error) {
        console.error('Auto-refresh error:', error);
    } finally {
        isRefreshing = false;
    }
}

// Check if UI needs full re-render
function needsReRender(newBookings) {
    // If status tab changed, need re-render
    const currentFilteredCount = allBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    }).length;
    
    const newFilteredCount = newBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    }).length;
    
    // If counts differ or search/filters active, re-render
    if (currentFilteredCount !== newFilteredCount) return true;
    if (currentSearchTerm) return true;
    if (currentDateFilter !== 'all') return true;
    if (currentAreaFilter !== 'all') return true;
    if (currentDurationFilter !== 'all') return true;
    
    return false;
}

// Update card statuses without full re-render (optimization)
function updateCardStatuses(newBookings) {
    const bookingCards = document.querySelectorAll('.booking-card');
    
    bookingCards.forEach(card => {
        const bookingId = card.dataset.bookingId;
        const updatedBooking = newBookings.find(b => b.id === bookingId);
        
        if (updatedBooking) {
            // Update status badge
            const statusBadge = card.querySelector('.status-badge');
            if (statusBadge && updatedBooking.status !== allBookings.find(b => b.id === bookingId)?.status) {
                const newStatusBadge = getStatusBadge(updatedBooking.status);
                statusBadge.outerHTML = newStatusBadge;
            }
            
            // Update payment badge
            const paymentBadge = card.querySelector('.payment-badge');
            if (paymentBadge && updatedBooking.paymentStatus !== allBookings.find(b => b.id === bookingId)?.paymentStatus) {
                const newPaymentBadge = getPaymentStatusBadge(updatedBooking.paymentStatus);
                paymentBadge.outerHTML = newPaymentBadge;
            }
            
            // Update action buttons if status changed
            const actionButtons = card.querySelector('.card-actions');
            if (actionButtons && updatedBooking.status !== allBookings.find(b => b.id === bookingId)?.status) {
                const newButtons = getCardActionButtons(updatedBooking);
                actionButtons.innerHTML = newButtons;
                
                // Re-attach event listeners
                attachCardActionListeners();
            }
        }
    });
}

function stopPollingListener() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('Auto-refresh stopped');
    }
}

// ============================================
// GLOBAL VARIABLES
// ============================================

// DOM Elements
const totalBookingsEl = document.getElementById('totalBookings');
const todayBookingsEl = document.getElementById('todayBookings');
const totalRevenueEl = document.getElementById('totalRevenue');
const searchInput = document.getElementById('searchInput');
const dateFilter = document.getElementById('dateFilter');
const areaFilter = document.getElementById('areaFilter');
const durationFilter = document.getElementById('durationFilter');
const refreshBtn = document.getElementById('refreshBookingsBtn');
const cardsContainer = document.getElementById('bookingsCardsContainer');
const tableTitle = document.getElementById('tableTitle');
const resultsCount = document.getElementById('resultsCount');

// Modal elements
const viewBookingModal = document.getElementById('viewBookingModal');
const assignDriverModal = document.getElementById('assignDriverModal');
const startTripModal = document.getElementById('startTripModal');
const completeTripModal = document.getElementById('completeTripModal');
const cancelBookingModal = document.getElementById('cancelBookingModal');
const reassignDriverModal = document.getElementById('reassignDriverModal');
const bookingDetailsContainer = document.getElementById('bookingDetailsContainer');
const driverSelect = document.getElementById('driverSelect');
const vehicleSelect = document.getElementById('vehicleSelect');
const reassignDriverSelect = document.getElementById('reassignDriverSelect');
const reassignVehicleSelect = document.getElementById('reassignVehicleSelect');
const selectedBookingId = document.getElementById('selectedBookingId');
const reassignBookingId = document.getElementById('reassignBookingId');
const startTripBookingId = document.getElementById('startTripBookingId');
const completeTripBookingId = document.getElementById('completeTripBookingId');
const cancelBookingId = document.getElementById('cancelBookingId');
const cancelReason = document.getElementById('cancelReason');
const completionNotes = document.getElementById('completionNotes');
const assignmentNotes = document.getElementById('assignmentNotes');
const estimatedDuration = document.getElementById('estimatedDuration');
const reassignReason = document.getElementById('reassignReason');

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadBookings();
    setupEventListeners();
    setupPollingListener(); // Use polling instead of Firebase
});

window.addEventListener('beforeunload', () => {
    stopPollingListener();
});

function setupEventListeners() {
    // Status tabs - save scroll before tab change
    document.querySelectorAll('.status-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            saveScrollPosition();
            document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentStatus = tab.dataset.status;
            updateTableTitle();
            renderBookingsCards();
            restoreScrollPosition();
        });
    });

    // Search input with debounce
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            saveScrollPosition();
            currentSearchTerm = e.target.value.toLowerCase();
            renderBookingsCards();
            restoreScrollPosition();
        }, 300);
    });

    // Filters - save scroll before filter change
    dateFilter.addEventListener('change', (e) => {
        saveScrollPosition();
        currentDateFilter = e.target.value;
        renderBookingsCards();
        restoreScrollPosition();
    });
    
    areaFilter.addEventListener('change', (e) => {
        saveScrollPosition();
        currentAreaFilter = e.target.value;
        renderBookingsCards();
        restoreScrollPosition();
    });
    
    durationFilter.addEventListener('change', (e) => {
        saveScrollPosition();
        currentDurationFilter = e.target.value;
        renderBookingsCards();
        restoreScrollPosition();
    });

    refreshBtn.addEventListener('click', () => {
        saveScrollPosition();
        loadBookings(true);
        toastInfo('Manually refreshed', 'Refresh');
        setTimeout(() => restoreScrollPosition(), 100);
    });

    // Modal close buttons
    document.getElementById('closeViewBookingModal')?.addEventListener('click', () => {
        viewBookingModal.style.display = 'none';
    });
    document.getElementById('closeModalFooterBtn')?.addEventListener('click', () => {
        viewBookingModal.style.display = 'none';
    });
    document.getElementById('closeAssignDriverModal')?.addEventListener('click', () => {
        assignDriverModal.style.display = 'none';
    });
    document.getElementById('closeStartTripModal')?.addEventListener('click', () => {
        startTripModal.style.display = 'none';
    });
    document.getElementById('closeCompleteTripModal')?.addEventListener('click', () => {
        completeTripModal.style.display = 'none';
    });
    document.getElementById('closeCancelBookingModal')?.addEventListener('click', () => {
        cancelBookingModal.style.display = 'none';
    });
    document.getElementById('closeReassignDriverModal')?.addEventListener('click', () => {
        reassignDriverModal.style.display = 'none';
    });
    document.getElementById('cancelAssignBtn')?.addEventListener('click', () => {
        assignDriverModal.style.display = 'none';
    });
    document.getElementById('cancelStartTripBtn')?.addEventListener('click', () => {
        startTripModal.style.display = 'none';
    });
    document.getElementById('cancelCompleteTripBtn')?.addEventListener('click', () => {
        completeTripModal.style.display = 'none';
    });
    document.getElementById('cancelBookingBtn')?.addEventListener('click', () => {
        cancelBookingModal.style.display = 'none';
    });
    document.getElementById('cancelReassignBtn')?.addEventListener('click', () => {
        reassignDriverModal.style.display = 'none';
    });

    // Close modals when clicking overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        });
    });

    // Form submissions
    document.getElementById('assignDriverForm')?.addEventListener('submit', handleAssignDriver);
    document.getElementById('startTripForm')?.addEventListener('submit', handleStartTrip);
    document.getElementById('completeTripForm')?.addEventListener('submit', handleCompleteTrip);
    document.getElementById('cancelBookingForm')?.addEventListener('submit', handleCancelBooking);
    document.getElementById('reassignDriverForm')?.addEventListener('submit', handleReassignDriver);
}

function updateTableTitle() {
    const titles = {
        'unassigned': 'Unassigned Metro Point-to-Point Bookings',
        'assigned': 'Assigned Metro Bookings (Ready for Pickup)',
        'in_progress': 'In Progress Trips',
        'completed': 'Completed Metro Bookings',
        'cancelled': 'Cancelled Metro Bookings',
        'all': 'All Metro Point-to-Point Bookings'
    };
    tableTitle.textContent = titles[currentStatus] || 'Metro Bookings';
}

async function loadBookings(forceRefresh = false) {
    try {
        showLoadingState();
        
        // Check cache first
        if (!forceRefresh && bookingsCache.isValid()) {
            const cachedData = bookingsCache.get();
            allBookings = cachedData.bookings;
            lastBookingIdsHash = getBookingsHash(allBookings);
            updateStats();
            updateStatusCounts();
            renderBookingsCards();
            return;
        }
        
        const response = await apiRequest(`/api/common/with-driver-metro/bookings?status=all&_t=${Date.now()}`);
        
        if (!response.ok) {
            throw new Error('Failed to load bookings');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Update cache
            bookingsCache.set(data);
            
            allBookings = data.bookings;
            lastBookingIdsHash = getBookingsHash(allBookings);
            updateStats();
            updateStatusCounts();
            renderBookingsCards();
            
            if (forceRefresh) {
                toastSuccess(`Refreshed ${data.total} bookings`, 'Success');
            }
        } else {
            toastError(data.message || 'Failed to load bookings', 'Error');
        }
    } catch (error) {
        console.error('Error loading bookings:', error);
        toastError('Unable to load bookings. Please try again.', 'Connection Error');
        cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-exclamation-triangle"></i> Error loading bookings. Please refresh.</div>`;
    }
}

function showLoadingState() {
    if (allBookings.length === 0) {
        cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-spinner fa-spin"></i> Loading metro bookings...</div>`;
    }
}

function updateStats() {
    const filteredByStatus = allBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    });
    
    totalBookingsEl.textContent = filteredByStatus.length;
    
    const today = new Date().toISOString().split('T')[0];
    const todayBookingsCount = filteredByStatus.filter(booking => {
        const bookingDate = booking.travelDate;
        if (bookingDate) {
            let formattedDate = bookingDate;
            if (bookingDate.includes('-')) {
                const parts = bookingDate.split('-');
                if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
                    formattedDate = `${parts[2]}-${parts[0]}-${parts[1]}`;
                }
            }
            return formattedDate === today;
        }
        return false;
    }).length;
    todayBookingsEl.textContent = todayBookingsCount;
    
    let totalRevenue = filteredByStatus
        .filter(b => b.paymentStatus === 'paid')
        .reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    totalRevenueEl.textContent = `₱${totalRevenue.toLocaleString()}`;
}

async function updateStatusCounts() {
    try {
        const response = await apiRequest('/api/common/with-driver-metro/bookings/counts');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('unassignedCount').textContent = data.counts.unassigned || 0;
            document.getElementById('assignedCount').textContent = data.counts.assigned || 0;
            document.getElementById('inProgressCount').textContent = data.counts.in_progress || 0;
            document.getElementById('completedCount').textContent = data.counts.completed || 0;
            document.getElementById('cancelledCount').textContent = data.counts.cancelled || 0;
            document.getElementById('allCount').textContent = data.counts.all || 0;
        }
    } catch (error) {
        console.error('Error updating counts:', error);
    }
}

function filterByDate(booking) {
    if (currentDateFilter === 'all') return true;
    
    const bookingDate = booking.travelDate;
    if (!bookingDate) return false;
    
    let formattedDate = bookingDate;
    if (bookingDate.includes('-')) {
        const parts = bookingDate.split('-');
        if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
            formattedDate = `${parts[2]}-${parts[0]}-${parts[1]}`;
        }
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    switch(currentDateFilter) {
        case 'today':
            return formattedDate === today;
        case 'tomorrow':
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            return formattedDate === tomorrowStr;
        case 'this_week':
            const bookingDateObj = new Date(formattedDate);
            const todayObj = new Date(today);
            const weekStart = new Date(todayObj);
            weekStart.setDate(todayObj.getDate() - todayObj.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return bookingDateObj >= weekStart && bookingDateObj <= weekEnd;
        case 'next_week':
            const nextWeekStart = new Date(todayObj);
            nextWeekStart.setDate(todayObj.getDate() + (7 - todayObj.getDay()));
            const nextWeekEnd = new Date(nextWeekStart);
            nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
            return bookingDateObj >= nextWeekStart && bookingDateObj <= nextWeekEnd;
        default:
            return true;
    }
}

function filterByArea(booking) {
    if (currentAreaFilter === 'all') return true;
    
    const pickup = (booking.pickupLocation || '').toLowerCase();
    const dropoff = (booking.dropoffLocation || '').toLowerCase();
    
    const areaKeywords = {
        'manila': ['manila', 'ermita', 'malate', 'binondo', 'intramuros'],
        'quezon_city': ['quezon city', 'qc', 'diliman', 'cubao', 'commonwealth'],
        'makati': ['makati', 'ayala', 'rockwell', 'bel-air'],
        'taguig': ['taguig', 'bgc', 'bonifacio', 'mckinley'],
        'pasay': ['pasay', 'moa', 'mall of asia', 'naia'],
        'paranaque': ['paranaque', 'sucat', 'baclaran'],
        'las_pinas': ['las pinas', 'las piñas', 'alabang'],
        'muntinlupa': ['muntinlupa', 'alabang', 'filinvest'],
        'pasig': ['pasig', 'ortigas', 'cainta'],
        'mandaluyong': ['mandaluyong', 'shaw', 'boni'],
        'marikina': ['marikina', 'concepcion'],
        'valenzuela': ['valenzuela', 'karuhatan'],
        'caloocan': ['caloocan', 'monumento'],
        'malabon': ['malabon', 'hulo'],
        'navotas': ['navotas', 'north bay'],
        'san_juan': ['san juan', 'greenhills'],
        'pateros': ['pateros']
    };
    
    const keywords = areaKeywords[currentAreaFilter] || [];
    for (const keyword of keywords) {
        if (pickup.includes(keyword) || dropoff.includes(keyword)) {
            return true;
        }
    }
    return false;
}

function filterByDuration(booking) {
    if (currentDurationFilter === 'all') return true;
    
    const duration = booking.duration || '';
    
    switch(currentDurationFilter) {
        case '1-2':
            return duration.includes('1') || duration.includes('2') || duration === '1-2 hours';
        case '2-4':
            return duration.includes('3') || duration.includes('4') || duration === '2-4 hours';
        case '4-6':
            return duration.includes('5') || duration.includes('6') || duration === '4-6 hours';
        case '6-8':
            return duration.includes('7') || duration.includes('8') || duration === '6-8 hours';
        case '8+':
            return parseInt(duration) >= 8 || duration === '8+ hours';
        default:
            return true;
    }
}

function renderBookingsCards() {
    let filteredBookings = allBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    });
    
    if (currentSearchTerm) {
        filteredBookings = filteredBookings.filter(booking => {
            const searchableFields = [
                booking.id,
                booking.clientName,
                booking.contactNumber,
                booking.email,
                booking.pickupLocation,
                booking.dropoffLocation
            ];
            return searchableFields.some(field => 
                field && field.toLowerCase().includes(currentSearchTerm)
            );
        });
    }
    
    filteredBookings = filteredBookings.filter(booking => filterByDate(booking));
    filteredBookings = filteredBookings.filter(booking => filterByArea(booking));
    filteredBookings = filteredBookings.filter(booking => filterByDuration(booking));
    
    resultsCount.textContent = filteredBookings.length;
    
    if (filteredBookings.length === 0) {
        cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-inbox"></i> No ${currentStatus} metro bookings found</div>`;
        return;
    }
    
    cardsContainer.innerHTML = filteredBookings.map(booking => renderBookingCard(booking)).join('');
    attachCardActionListeners();
}

function renderBookingCard(booking) {
    const travelDate = formatReadableDate(booking.travelDate);
    const status = getStatusBadge(booking.status);
    const amount = `₱${parseFloat(booking.amount || 0).toLocaleString()}`;
    const payment = getPaymentStatusBadge(booking.paymentStatus);
    
    const pickup = booking.pickupLocation || 'N/A';
    const dropoff = booking.dropoffLocation || 'N/A';
    const duration = booking.duration || 'N/A';
    const packageType = booking.package || booking.packageType || 'N/A';
    const vehicleType = booking.vehicleType || 'N/A';
    
    return `
        <div class="booking-card" data-booking-id="${booking.id}">
            <div class="card-header-section">
                <div class="booking-ref">
                    🎫 ${escapeHtml(booking.id)}
                </div>
                <div class="card-badges">
                    ${status}
                    ${payment}
                </div>
            </div>
            
            <div class="card-body">
                <div class="info-row">
                    <div class="info-item">👤 <span><strong>${escapeHtml(booking.clientName)}</strong></span></div>
                    <div class="info-item">📞 <span>${escapeHtml(booking.contactNumber)}</span></div>
                    <div class="info-item">✉️ <span>${escapeHtml(booking.email)}</span></div>
                </div>
                
                <div class="info-row">
                    <div class="info-item">📅 <span><strong>Date:</strong> ${travelDate}</span></div>
                    <div class="info-item">⏰ <span><strong>Time:</strong> ${escapeHtml(booking.pickupTime || 'Flexible')}</span></div>
                    <div class="info-item">🚗 <span><strong>Vehicle:</strong> ${escapeHtml(vehicleType)}</span></div>
                </div>
                
                <div class="location-section">
                    <div class="location-row">
                        <div class="location-label">📍 PICKUP:</div>
                        <div class="location-value">${escapeHtml(pickup)}</div>
                    </div>
                    <div class="location-row">
                        <div class="location-label">🏁 DROPOFF:</div>
                        <div class="location-value">${escapeHtml(dropoff)}</div>
                    </div>
                </div>
                
                <div class="duration-info-card">
                    <span><i class="fas fa-hourglass-half"></i> Duration: <strong>${escapeHtml(duration)}</strong></span>
                    <span><i class="fas fa-tag"></i> Package: <strong>${escapeHtml(packageType)}</strong></span>
                </div>
                
                ${booking.plannedItinerary ? `
                <div class="itinerary-info">
                    <i class="fas fa-map"></i> Itinerary: ${escapeHtml(booking.plannedItinerary)}
                </div>
                ` : ''}
                
                <div class="price-section">
                    <div class="amount">💰 ${amount}</div>
                    <div class="payment-method">💳 ${escapeHtml(booking.paymentMethod || 'N/A')}</div>
                </div>
                
                <div class="card-actions">
                    ${getCardActionButtons(booking)}
                </div>
            </div>
        </div>
    `;
}

function getCardActionButtons(booking) {
    const viewBtn = `<button class="card-action-btn btn-view-card" data-action="view" data-booking-id="${booking.id}">📄 View Details</button>`;
    
    if (booking.status === 'unassigned') {
        return `${viewBtn}<button class="card-action-btn btn-assign-card" data-action="assign" data-booking-id="${booking.id}">👨‍✈️ Assign Driver</button><button class="card-action-btn btn-cancel-card" data-action="cancel" data-booking-id="${booking.id}">🗑️ Cancel</button>`;
    } else if (booking.status === 'assigned') {
        return `${viewBtn}<button class="card-action-btn btn-start-card" data-action="start" data-booking-id="${booking.id}">🚀 Start Trip</button><button class="card-action-btn btn-reassign-card" data-action="reassign" data-booking-id="${booking.id}">🔄 Reassign</button><button class="card-action-btn btn-cancel-card" data-action="cancel" data-booking-id="${booking.id}">🗑️ Cancel</button>`;
    } else if (booking.status === 'in_progress') {
        return `${viewBtn}<button class="card-action-btn btn-complete-card" data-action="complete" data-booking-id="${booking.id}">✅ Complete Trip</button>`;
    } else {
        return viewBtn;
    }
}

function getStatusBadge(status) {
    const badges = {
        'unassigned': '<span class="status-badge status-unassigned">⏳ Unassigned</span>',
        'assigned': '<span class="status-badge status-assigned">✓ Assigned</span>',
        'in_progress': '<span class="status-badge status-in_progress">🚀 In Progress</span>',
        'completed': '<span class="status-badge status-completed">✅ Completed</span>',
        'cancelled': '<span class="status-badge status-cancelled">❌ Cancelled</span>'
    };
    return badges[status] || `<span class="status-badge">${status}</span>`;
}

function getPaymentStatusBadge(status) {
    const isPaid = status === 'paid';
    const icon = isPaid ? '✅' : '⏳';
    const statusClass = isPaid ? 'status-paid' : 'status-pending';
    const statusText = isPaid ? 'Paid' : 'Pending';
    return `<span class="payment-badge ${statusClass}">${icon} ${statusText}</span>`;
}

function formatReadableDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        let parts;
        if (dateStr.includes('-')) {
            parts = dateStr.split('-');
            if (parts.length === 3) {
                if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
                    const date = new Date(parts[2], parts[0] - 1, parts[1]);
                    return date.toLocaleDateString('en-PH', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric',
                        weekday: 'short'
                    });
                } else if (parts[0].length === 4 && parts[1].length === 2 && parts[2].length === 2) {
                    const date = new Date(parts[0], parts[1] - 1, parts[2]);
                    return date.toLocaleDateString('en-PH', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric',
                        weekday: 'short'
                    });
                }
            }
        }
        return dateStr;
    } catch {
        return dateStr;
    }
}

function attachCardActionListeners() {
    document.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener('click', () => viewBookingDetails(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="assign"]').forEach(btn => {
        btn.addEventListener('click', () => openAssignDriverModal(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="start"]').forEach(btn => {
        btn.addEventListener('click', () => openStartTripModal(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="complete"]').forEach(btn => {
        btn.addEventListener('click', () => openCompleteTripModal(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', () => openCancelBookingModal(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="reassign"]').forEach(btn => {
        btn.addEventListener('click', () => openReassignDriverModal(btn.dataset.bookingId));
    });
}

async function viewBookingDetails(bookingId) {
    try {
        const response = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}`);
        const data = await response.json();
        if (data.success) {
            bookingDetailsContainer.innerHTML = renderBookingDetails(data.booking);
            viewBookingModal.style.display = 'flex';
        } else {
            toastError('Failed to load booking details', 'Error');
        }
    } catch (error) {
        console.error('Error viewing booking:', error);
        toastError('Failed to load booking details', 'Error');
    }
}

function renderBookingDetails(booking) {
    const travelDate = formatReadableDate(booking.travelDate);
    const pickupDateTime = `${travelDate} at ${booking.pickupTime || 'Flexible'}`;
    
    return `
        <div class="booking-details">
            <div class="details-section">
                <h4>📋 Booking Information</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>🎫 Booking Reference:</label><span><strong>${escapeHtml(booking.id)}</strong></span></div>
                    <div class="detail-item"><label>🚗 Service Type:</label><span>Metro Point-to-Point</span></div>
                    <div class="detail-item"><label>📊 Status:</label><span>${getStatusBadge(booking.status)}</span></div>
                    <div class="detail-item"><label>💳 Payment Status:</label><span>${getPaymentStatusBadge(booking.paymentStatus)}</span></div>
                    <div class="detail-item"><label>💰 Amount:</label><span><strong>₱${parseFloat(booking.amount || 0).toLocaleString()}</strong></span></div>
                    <div class="detail-item"><label>💎 Payment Method:</label><span>${escapeHtml(booking.paymentMethod || 'N/A')}</span></div>
                </div>
            </div>
            
            <div class="details-section">
                <h4>👤 Customer Information</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>👤 Name:</label><span>${escapeHtml(booking.clientName || 'N/A')}</span></div>
                    <div class="detail-item"><label>📞 Contact Number:</label><span>${escapeHtml(booking.contactNumber || 'N/A')}</span></div>
                    <div class="detail-item"><label>✉️ Email:</label><span>${escapeHtml(booking.email || 'N/A')}</span></div>
                </div>
            </div>
            
            <div class="details-section">
                <h4>🗺️ Trip Details</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>📍 Pickup Location:</label><span>${escapeHtml(booking.pickupLocation || 'N/A')}</span></div>
                    <div class="detail-item"><label>🏁 Dropoff Location:</label><span>${escapeHtml(booking.dropoffLocation || 'N/A')}</span></div>
                    <div class="detail-item"><label>📅 Pickup Date & Time:</label><span>${pickupDateTime}</span></div>
                    <div class="detail-item"><label>⏱️ Duration:</label><span>${escapeHtml(booking.duration || 'N/A')}</span></div>
                    <div class="detail-item"><label>🏷️ Package Type:</label><span>${escapeHtml(booking.package || booking.packageType || 'N/A')}</span></div>
                    <div class="detail-item"><label>🚐 Vehicle Type:</label><span>${escapeHtml(booking.vehicleType || 'N/A')}</span></div>
                </div>
            </div>
            
            ${booking.plannedItinerary ? `
            <div class="details-section">
                <h4>📝 Planned Itinerary</h4>
                <p class="itinerary-info">${escapeHtml(booking.plannedItinerary)}</p>
            </div>
            ` : ''}
            
            ${booking.note ? `
            <div class="details-section">
                <h4>📝 Special Requests / Notes</h4>
                <p class="itinerary-info">${escapeHtml(booking.note)}</p>
            </div>
            ` : ''}
            
            ${booking.assigned_driver ? `
            <div class="details-section">
                <h4>✅ Assignment Details</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>👨‍✈️ Driver:</label><span>${escapeHtml(booking.assigned_driver.name || 'N/A')}</span></div>
                    <div class="detail-item"><label>📞 Driver Contact:</label><span>${escapeHtml(booking.assigned_driver.contact || 'N/A')}</span></div>
                    <div class="detail-item"><label>🚐 Vehicle:</label><span>${escapeHtml(booking.assigned_vehicle?.name || 'N/A')}</span></div>
                    <div class="detail-item"><label>🔢 Plate Number:</label><span>${escapeHtml(booking.assigned_vehicle?.plate_number || 'N/A')}</span></div>
                </div>
            </div>
            ` : ''}
            
            ${booking.trip_started_at ? `
            <div class="details-section">
                <h4>🚀 Trip Progress</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>Started At:</label><span>${new Date(booking.trip_started_at).toLocaleString()}</span></div>
                    <div class="detail-item"><label>Start Location:</label><span>${escapeHtml(booking.trip_start_location || 'N/A')}</span></div>
                </div>
            </div>
            ` : ''}
            
            ${booking.completed_at ? `
            <div class="details-section">
                <h4>✅ Completion Details</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>Completed At:</label><span>${new Date(booking.completed_at).toLocaleString()}</span></div>
                    <div class="detail-item"><label>Actual Duration:</label><span>${escapeHtml(booking.actual_duration || 'N/A')}</span></div>
                </div>
            </div>
            ` : ''}
        </div>
    `;
}

async function openAssignDriverModal(bookingId) {
    try {
        // First, get the booking details to know the vehicle type
        const bookingResponse = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}`);
        const bookingData = await bookingResponse.json();
        
        if (!bookingData.success) {
            toastError('Failed to load booking details', 'Error');
            return;
        }
        
        const booking = bookingData.booking;
        const requiredVehicleType = (booking.vehicleType || booking.vehicle_type || 'sedan').toUpperCase();
        
        // Show the vehicle requirement banner
        const banner = document.getElementById('vehicleRequirementBanner');
        const requiredText = document.getElementById('requiredVehicleTypeText');
        const vehicleTypeHint = document.getElementById('vehicleTypeHint');
        
        if (banner && requiredText) {
            requiredText.innerHTML = `Customer requested vehicle type: <strong>${requiredVehicleType}</strong>`;
            banner.style.display = 'block';
        }
        
        if (vehicleTypeHint) {
            vehicleTypeHint.innerHTML = `(filtered by type: ${requiredVehicleType})`;
        }
        
        // Load drivers (always all available drivers)
        await loadDrivers();
        
        // Load vehicles filtered by the required type
        await loadVehiclesByType(requiredVehicleType.toLowerCase());
        
        // Store the booking ID
        selectedBookingId.value = bookingId;
        
        // Show the modal
        assignDriverModal.style.display = 'flex';
        
    } catch (error) {
        console.error('Error opening assign modal:', error);
        toastError('Failed to load assignment options', 'Error');
    }
}

async function loadVehiclesByType(vehicleType) {
    try {
        // Pass the vehicle type as a query parameter
        const response = await apiRequest(`/api/common/with-driver-metro/vehicles/available?type=${encodeURIComponent(vehicleType)}`);
        const data = await response.json();
        
        if (data.success && data.vehicles && data.vehicles.length > 0) {
            vehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            reassignVehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            data.vehicles.forEach(vehicle => {
                const option = document.createElement('option');
                option.value = vehicle.id;
                option.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number} (${vehicle.type})`;
                vehicleSelect.appendChild(option);
                const option2 = document.createElement('option');
                option2.value = vehicle.id;
                option2.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number} (${vehicle.type})`;
                reassignVehicleSelect.appendChild(option2);
            });
        } else {
            vehicleSelect.innerHTML = `<option value="">No ${vehicleType} vehicles available</option>`;
            reassignVehicleSelect.innerHTML = `<option value="">No ${vehicleType} vehicles available</option>`;
            toastWarning(`No ${vehicleType} vehicles available for assignment`, 'Vehicle Unavailable');
        }
    } catch (error) {
        console.error('Error loading vehicles:', error);
        vehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
        reassignVehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
        toastError('Failed to load vehicles. Please try again.', 'Error');
    }
}

async function loadDrivers() {
    try {
        const response = await apiRequest('/api/common/with-driver-metro/drivers/available');
        const data = await response.json();
        
        if (data.success && data.drivers && data.drivers.length > 0) {
            driverSelect.innerHTML = '<option value="">Choose Driver</option>';
            reassignDriverSelect.innerHTML = '<option value="">Choose Driver</option>';
            data.drivers.forEach(driver => {
                const option = document.createElement('option');
                option.value = driver.id;
                option.textContent = driver.name;
                driverSelect.appendChild(option);
                const option2 = document.createElement('option');
                option2.value = driver.id;
                option2.textContent = driver.name;
                reassignDriverSelect.appendChild(option2);
            });
        } else {
            driverSelect.innerHTML = '<option value="">No drivers available</option>';
            reassignDriverSelect.innerHTML = '<option value="">No drivers available</option>';
            toastWarning('No drivers available for assignment', 'Attention');
        }
    } catch (error) {
        console.error('Error loading drivers:', error);
        driverSelect.innerHTML = '<option value="">Error loading drivers</option>';
        reassignDriverSelect.innerHTML = '<option value="">Error loading drivers</option>';
        toastError('Failed to load drivers. Please try again.', 'Error');
    }
}

async function loadVehicles() {
    try {
        const response = await apiRequest('/api/common/with-driver-metro/vehicles/available');
        const data = await response.json();
        
        if (data.success && data.vehicles && data.vehicles.length > 0) {
            vehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            reassignVehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            data.vehicles.forEach(vehicle => {
                const option = document.createElement('option');
                option.value = vehicle.id;
                option.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number}`;
                vehicleSelect.appendChild(option);
                const option2 = document.createElement('option');
                option2.value = vehicle.id;
                option2.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number}`;
                reassignVehicleSelect.appendChild(option2);
            });
        } else {
            vehicleSelect.innerHTML = '<option value="">No vehicles available</option>';
            reassignVehicleSelect.innerHTML = '<option value="">No vehicles available</option>';
            toastWarning('No vehicles available for assignment', 'Attention');
        }
    } catch (error) {
        console.error('Error loading vehicles:', error);
        vehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
        reassignVehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
        toastError('Failed to load vehicles. Please try again.', 'Error');
    }
}

async function handleAssignDriver(e) {
    e.preventDefault();
    const bookingId = selectedBookingId.value;
    const driverId = driverSelect.value;
    const vehicleId = vehicleSelect.value;
    const notes = assignmentNotes.value;
    
    if (!driverId || !vehicleId) {
        toastError('Please select both driver and vehicle', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Assigning...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}/assign`, {
            method: 'POST',
            body: JSON.stringify({ 
                driver_id: driverId, 
                vehicle_id: vehicleId, 
                assignment_notes: notes 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Driver assigned successfully!', 'Assignment Complete');
            assignDriverModal.style.display = 'none';
            assignmentNotes.value = '';
            driverSelect.value = '';
            vehicleSelect.value = '';
            // Refresh data after assignment
            loadBookings(true);
        } else {
            toastError(data.message || 'Failed to assign driver', 'Assignment Failed');
        }
    } catch (error) {
        console.error('Error assigning driver:', error);
        toastError('Failed to assign driver', 'Error');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

function openStartTripModal(bookingId) {
    startTripBookingId.value = bookingId;
    startTripModal.style.display = 'flex';
}

async function handleStartTrip(e) {
    e.preventDefault();
    const bookingId = startTripBookingId.value;
    const startLocation = document.getElementById('startLocation').value;
    const tripNotes = document.getElementById('tripNotes').value;
    
    if (!startLocation) {
        toastError('Please confirm starting location', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}/start-trip`, {
            method: 'POST',
            body: JSON.stringify({ start_location: startLocation, trip_notes: tripNotes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Trip started successfully!', 'Trip Started');
            startTripModal.style.display = 'none';
            document.getElementById('startLocation').value = '';
            document.getElementById('tripNotes').value = '';
            // Refresh data after starting trip
            loadBookings(true);
        } else {
            toastError(data.message || 'Failed to start trip', 'Error');
        }
    } catch (error) {
        console.error('Error starting trip:', error);
        toastError('Failed to start trip', 'Error');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

function openCompleteTripModal(bookingId) {
    completeTripBookingId.value = bookingId;
    completeTripModal.style.display = 'flex';
}

async function handleCompleteTrip(e) {
    e.preventDefault();
    const bookingId = completeTripBookingId.value;
    const endLocation = document.getElementById('endLocation').value;
    const actualDuration = document.getElementById('actualDuration').value;
    const notes = completionNotes.value;
    
    if (!endLocation) {
        toastError('Please confirm drop-off location', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}/complete`, {
            method: 'POST',
            body: JSON.stringify({ 
                end_location: endLocation, 
                actual_duration: actualDuration,
                completion_notes: notes 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Trip completed successfully!', 'Trip Complete');
            completeTripModal.style.display = 'none';
            document.getElementById('endLocation').value = '';
            document.getElementById('actualDuration').value = '';
            completionNotes.value = '';
            // Refresh data after completing trip
            loadBookings(true);
        } else {
            toastError(data.message || 'Failed to complete trip', 'Error');
        }
    } catch (error) {
        console.error('Error completing trip:', error);
        toastError('Failed to complete trip', 'Error');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

function openCancelBookingModal(bookingId) {
    cancelBookingId.value = bookingId;
    cancelReason.value = '';
    cancelBookingModal.style.display = 'flex';
}

async function handleCancelBooking(e) {
    e.preventDefault();
    const bookingId = cancelBookingId.value;
    const reason = cancelReason.value;
    
    if (!reason) {
        toastError('Please provide a cancellation reason', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ cancellation_reason: reason })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Booking cancelled successfully!', 'Cancelled');
            cancelBookingModal.style.display = 'none';
            cancelReason.value = '';
            // Refresh data after cancellation
            loadBookings(true);
        } else {
            toastError(data.message || 'Failed to cancel booking', 'Error');
        }
    } catch (error) {
        console.error('Error cancelling booking:', error);
        toastError('Failed to cancel booking', 'Error');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

async function openReassignDriverModal(bookingId) {
    try {
        // Get booking details to know vehicle type
        const bookingResponse = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}`);
        const bookingData = await bookingResponse.json();
        
        if (!bookingData.success) {
            toastError('Failed to load booking details', 'Error');
            return;
        }
        
        const booking = bookingData.booking;
        const requiredVehicleType = (booking.vehicleType || booking.vehicle_type || 'sedan').toLowerCase();
        
        await loadDrivers();
        await loadVehiclesForReassign(requiredVehicleType);
        
        reassignBookingId.value = bookingId;
        reassignReason.value = '';
        reassignDriverModal.style.display = 'flex';
        
    } catch (error) {
        console.error('Error opening reassign modal:', error);
        toastError('Failed to load reassignment options', 'Error');
    }
}

async function loadVehiclesForReassign(vehicleType) {
    try {
        const response = await apiRequest(`/api/common/with-driver-metro/vehicles/available?type=${encodeURIComponent(vehicleType)}`);
        const data = await response.json();
        
        if (data.success && data.vehicles && data.vehicles.length > 0) {
            reassignVehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            data.vehicles.forEach(vehicle => {
                const option = document.createElement('option');
                option.value = vehicle.id;
                option.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number} (${vehicle.type})`;
                reassignVehicleSelect.appendChild(option);
            });
        } else {
            reassignVehicleSelect.innerHTML = `<option value="">No ${vehicleType} vehicles available</option>`;
            toastWarning(`No ${vehicleType} vehicles available for reassignment`, 'Vehicle Unavailable');
        }
    } catch (error) {
        console.error('Error loading vehicles for reassign:', error);
        reassignVehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
    }
}

async function handleReassignDriver(e) {
    e.preventDefault();
    const bookingId = reassignBookingId.value;
    const driverId = reassignDriverSelect.value;
    const vehicleId = reassignVehicleSelect.value;
    const reason = reassignReason.value;
    
    if (!driverId || !vehicleId) {
        toastError('Please select both driver and vehicle', 'Validation Error');
        return;
    }
    
    if (!reason) {
        toastError('Please provide a reason for reassignment', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reassigning...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/with-driver-metro/bookings/${bookingId}/reassign`, {
            method: 'POST',
            body: JSON.stringify({ 
                driver_id: driverId, 
                vehicle_id: vehicleId, 
                reassign_reason: reason 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Driver reassigned successfully!', 'Reassignment Complete');
            reassignDriverModal.style.display = 'none';
            reassignReason.value = '';
            reassignDriverSelect.value = '';
            reassignVehicleSelect.value = '';
            // Refresh data after reassignment
            loadBookings(true);
        } else {
            toastError(data.message || 'Failed to reassign driver', 'Reassignment Failed');
        }
    } catch (error) {
        console.error('Error reassigning driver:', error);
        toastError('Failed to reassign driver', 'Error');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toastSuccess(message, title = 'Success!') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, message, 'success');
    } else {
        console.log('✅', title, message);
    }
}

function toastError(message, title = 'Error!') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, message, 'error');
    } else {
        console.log('❌', title, message);
    }
}

function toastWarning(message, title = 'Warning!') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, message, 'warning');
    } else {
        console.log('⚠️', title, message);
    }
}

function toastInfo(message, title = 'Info') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, message, 'info');
    } else {
        console.log('ℹ️', title, message);
    }
}