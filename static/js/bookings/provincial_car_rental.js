// static/js/bookings/provincial_car_rental.js - Provincial Car Rental Booking Management

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
let currentDestinationFilter = 'all';
let currentTripTypeFilter = 'all';
let currentDurationFilter = 'all';

// Cache for bookings data
let bookingsCache = {
    data: null,
    timestamp: null,
    cacheDuration: 30000,
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

function saveScrollPosition() {
    lastScrollPosition = window.scrollY;
}

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

function getBookingsHash(bookings) {
    return JSON.stringify(bookings.map(b => ({
        id: b.id,
        status: b.status,
        updatedAt: b.updatedAt || b.timestamp
    })));
}

function setupPollingListener() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
    
    pollingInterval = setInterval(() => {
        if (!isRefreshing && document.hasFocus()) {
            refreshBookingsSilently();
        }
    }, 30000);
    
    console.log('Auto-refresh enabled (every 30 seconds)');
}

async function refreshBookingsSilently() {
    isRefreshing = true;
    
    try {
        saveScrollPosition();
        
        if (bookingsCache.isValid()) {
            const cachedData = bookingsCache.get();
            const newHash = getBookingsHash(cachedData.bookings);
            
            if (newHash !== lastBookingIdsHash) {
                const oldCount = allBookings.length;
                allBookings = cachedData.bookings;
                lastBookingIdsHash = newHash;
                
                updateStats();
                updateStatusCounts();
                
                if (needsReRender(cachedData.bookings)) {
                    renderBookingsCards();
                } else {
                    updateCardStatuses(cachedData.bookings);
                }
                
                if (cachedData.bookings.length > oldCount) {
                    toastInfo(`${cachedData.bookings.length - oldCount} new booking(s) received!`, 'Update');
                }
            }
        } else {
            const response = await apiRequest(`/api/common/provincial-car-rental/bookings?status=all&_t=${Date.now()}`);
            
            if (response.status === 304) {
                if (bookingsCache.data) {
                    bookingsCache.timestamp = Date.now();
                }
                return;
            }
            
            if (!response.ok) {
                throw new Error('Failed to refresh');
            }
            
            const data = await response.json();
            
            if (data.success) {
                bookingsCache.set(data);
                
                const newHash = getBookingsHash(data.bookings);
                
                if (newHash !== lastBookingIdsHash) {
                    const oldCount = allBookings.length;
                    allBookings = data.bookings;
                    lastBookingIdsHash = newHash;
                    
                    updateStats();
                    updateStatusCounts();
                    renderBookingsCards();
                    
                    if (data.bookings.length > oldCount) {
                        toastInfo(`${data.bookings.length - oldCount} new booking(s) received!`, 'Update');
                    }
                }
            }
        }
        
        restoreScrollPosition();
        
    } catch (error) {
        console.error('Auto-refresh error:', error);
    } finally {
        isRefreshing = false;
    }
}

function needsReRender(newBookings) {
    const currentFilteredCount = allBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    }).length;
    
    const newFilteredCount = newBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    }).length;
    
    if (currentFilteredCount !== newFilteredCount) return true;
    if (currentSearchTerm) return true;
    if (currentDateFilter !== 'all') return true;
    if (currentDestinationFilter !== 'all') return true;
    if (currentTripTypeFilter !== 'all') return true;
    if (currentDurationFilter !== 'all') return true;
    
    return false;
}

function updateCardStatuses(newBookings) {
    const bookingCards = document.querySelectorAll('.booking-card');
    
    bookingCards.forEach(card => {
        const bookingId = card.dataset.bookingId;
        const updatedBooking = newBookings.find(b => b.id === bookingId);
        
        if (updatedBooking) {
            const statusBadge = card.querySelector('.status-badge');
            if (statusBadge && updatedBooking.status !== allBookings.find(b => b.id === bookingId)?.status) {
                const newStatusBadge = getStatusBadge(updatedBooking.status);
                statusBadge.outerHTML = newStatusBadge;
            }
            
            const paymentBadge = card.querySelector('.payment-badge');
            if (paymentBadge && updatedBooking.paymentStatus !== allBookings.find(b => b.id === bookingId)?.paymentStatus) {
                const newPaymentBadge = getPaymentStatusBadge(updatedBooking.paymentStatus);
                paymentBadge.outerHTML = newPaymentBadge;
            }
            
            const actionButtons = card.querySelector('.card-actions');
            if (actionButtons && updatedBooking.status !== allBookings.find(b => b.id === bookingId)?.status) {
                const newButtons = getCardActionButtons(updatedBooking);
                actionButtons.innerHTML = newButtons;
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

const DOM_ELEMENTS = {
    totalBookings: document.getElementById('totalBookings'),
    todayBookings: document.getElementById('todayBookings'),
    totalRevenue: document.getElementById('totalRevenue'),
    totalPointsRedeemed: document.getElementById('totalPointsRedeemed'),
    searchInput: document.getElementById('searchInput'),
    dateFilter: document.getElementById('dateFilter'),
    destinationFilter: document.getElementById('destinationFilter'),
    tripTypeFilter: document.getElementById('tripTypeFilter'),
    durationFilter: document.getElementById('durationFilter'),
    refreshBtn: document.getElementById('refreshBookingsBtn'),
    cardsContainer: document.getElementById('bookingsCardsContainer'),
    tableTitle: document.getElementById('tableTitle'),
    resultsCount: document.getElementById('resultsCount')
};

const MODAL_ELEMENTS = {
    viewBooking: document.getElementById('viewBookingModal'),
    assignDriver: document.getElementById('assignDriverModal'),
    completeTrip: document.getElementById('completeTripModal'),
    cancelBooking: document.getElementById('cancelBookingModal'),
    reassignDriver: document.getElementById('reassignDriverModal'),
    bookingDetails: document.getElementById('bookingDetailsContainer'),
    driverSelect: document.getElementById('driverSelect'),
    vehicleSelect: document.getElementById('vehicleSelect'),
    reassignDriverSelect: document.getElementById('reassignDriverSelect'),
    reassignVehicleSelect: document.getElementById('reassignVehicleSelect'),
    selectedBookingId: document.getElementById('selectedBookingId'),
    reassignBookingId: document.getElementById('reassignBookingId'),
    completeTripBookingId: document.getElementById('completeTripBookingId'),
    cancelBookingId: document.getElementById('cancelBookingId'),
    cancelReason: document.getElementById('cancelReason'),
    completionNotes: document.getElementById('completionNotes'),
    assignmentNotes: document.getElementById('assignmentNotes'),
    reassignReason: document.getElementById('reassignReason')
};

document.addEventListener('DOMContentLoaded', () => {
    loadBookings();
    setupEventListeners();
    setupPollingListener();
});

window.addEventListener('beforeunload', () => {
    stopPollingListener();
});

function setupEventListeners() {
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

    let searchTimeout;
    DOM_ELEMENTS.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            saveScrollPosition();
            currentSearchTerm = e.target.value.toLowerCase();
            renderBookingsCards();
            restoreScrollPosition();
        }, 300);
    });

    DOM_ELEMENTS.dateFilter.addEventListener('change', (e) => {
        saveScrollPosition();
        currentDateFilter = e.target.value;
        renderBookingsCards();
        restoreScrollPosition();
    });
    
    DOM_ELEMENTS.destinationFilter.addEventListener('change', (e) => {
        saveScrollPosition();
        currentDestinationFilter = e.target.value;
        renderBookingsCards();
        restoreScrollPosition();
    });
    
    DOM_ELEMENTS.tripTypeFilter.addEventListener('change', (e) => {
        saveScrollPosition();
        currentTripTypeFilter = e.target.value;
        renderBookingsCards();
        restoreScrollPosition();
    });
    
    DOM_ELEMENTS.durationFilter.addEventListener('change', (e) => {
        saveScrollPosition();
        currentDurationFilter = e.target.value;
        renderBookingsCards();
        restoreScrollPosition();
    });

    DOM_ELEMENTS.refreshBtn.addEventListener('click', () => {
        saveScrollPosition();
        loadBookings(true);
        toastInfo('Manually refreshed', 'Refresh');
        setTimeout(() => restoreScrollPosition(), 100);
    });

    // Modal close buttons
    document.getElementById('closeViewBookingModal')?.addEventListener('click', () => {
        MODAL_ELEMENTS.viewBooking.style.display = 'none';
    });
    document.getElementById('closeModalFooterBtn')?.addEventListener('click', () => {
        MODAL_ELEMENTS.viewBooking.style.display = 'none';
    });
    document.getElementById('closeAssignDriverModal')?.addEventListener('click', () => {
        MODAL_ELEMENTS.assignDriver.style.display = 'none';
    });
    document.getElementById('closeCompleteTripModal')?.addEventListener('click', () => {
        MODAL_ELEMENTS.completeTrip.style.display = 'none';
    });
    document.getElementById('closeCancelBookingModal')?.addEventListener('click', () => {
        MODAL_ELEMENTS.cancelBooking.style.display = 'none';
    });
    document.getElementById('closeReassignDriverModal')?.addEventListener('click', () => {
        MODAL_ELEMENTS.reassignDriver.style.display = 'none';
    });
    document.getElementById('cancelAssignBtn')?.addEventListener('click', () => {
        MODAL_ELEMENTS.assignDriver.style.display = 'none';
    });
    document.getElementById('cancelCompleteTripBtn')?.addEventListener('click', () => {
        MODAL_ELEMENTS.completeTrip.style.display = 'none';
    });
    document.getElementById('cancelBookingBtn')?.addEventListener('click', () => {
        MODAL_ELEMENTS.cancelBooking.style.display = 'none';
    });
    document.getElementById('cancelReassignBtn')?.addEventListener('click', () => {
        MODAL_ELEMENTS.reassignDriver.style.display = 'none';
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        });
    });

    document.getElementById('assignDriverForm')?.addEventListener('submit', handleAssignDriver);
    document.getElementById('completeTripForm')?.addEventListener('submit', handleCompleteTrip);
    document.getElementById('cancelBookingForm')?.addEventListener('submit', handleCancelBooking);
    document.getElementById('reassignDriverForm')?.addEventListener('submit', handleReassignDriver);
}

function updateTableTitle() {
    const titles = {
        'unassigned': 'Unassigned Provincial Car Rental Bookings',
        'assigned': 'Assigned Provincial Bookings',
        'completed': 'Completed Provincial Bookings',
        'cancelled': 'Cancelled Provincial Bookings',
        'all': 'All Provincial Car Rental Bookings'
    };
    DOM_ELEMENTS.tableTitle.textContent = titles[currentStatus] || 'Provincial Bookings';
}

async function loadBookings(forceRefresh = false) {
    try {
        showLoadingState();
        
        if (!forceRefresh && bookingsCache.isValid() && allBookings.length > 0) {
            console.log('Using cached data');
            return;
        }
        
        const response = await apiRequest(`/api/common/provincial-car-rental/bookings?status=all&_t=${Date.now()}`);
        
        if (!response.ok) {
            throw new Error('Failed to load bookings');
        }
        
        const data = await response.json();
        
        if (data.success) {
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
        DOM_ELEMENTS.cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-exclamation-triangle"></i> Error loading bookings. Please refresh.</div>`;
    }
}

function showLoadingState() {
    if (allBookings.length === 0) {
        DOM_ELEMENTS.cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-spinner fa-spin"></i> Loading provincial bookings...</div>`;
    }
}

function updateStats() {
    const filteredByStatus = allBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    });
    
    DOM_ELEMENTS.totalBookings.textContent = filteredByStatus.length;
    
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
    DOM_ELEMENTS.todayBookings.textContent = todayBookingsCount;
    
    const totalRevenue = filteredByStatus
        .filter(b => b.paymentStatus === 'paid')
        .reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    DOM_ELEMENTS.totalRevenue.textContent = `₱${totalRevenue.toLocaleString()}`;
}

async function updateStatusCounts() {
    try {
        const response = await apiRequest('/api/common/provincial-car-rental/bookings/counts');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('unassignedCount').textContent = data.counts.unassigned || 0;
            document.getElementById('assignedCount').textContent = data.counts.assigned || 0;
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

function filterByDestination(booking) {
    if (currentDestinationFilter === 'all') return true;
    const destination = (booking.destination || '').toLowerCase();
    return destination === currentDestinationFilter.toLowerCase();
}

function filterByTripType(booking) {
    if (currentTripTypeFilter === 'all') return true;
    return booking.tripType === currentTripTypeFilter;
}

function filterByDuration(booking) {
    if (currentDurationFilter === 'all') return true;
    
    const duration = booking.duration || '';
    const hours = parseInt(duration);
    
    switch(currentDurationFilter) {
        case '1-3':
            return hours >= 1 && hours <= 3;
        case '3-6':
            return hours >= 3 && hours <= 6;
        case '6-12':
            return hours >= 6 && hours <= 12;
        case '12-24':
            return hours >= 12 && hours <= 24;
        case '24+':
            return hours > 24;
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
                booking.destination
            ];
            return searchableFields.some(field => 
                field && field.toLowerCase().includes(currentSearchTerm)
            );
        });
    }
    
    filteredBookings = filteredBookings.filter(booking => filterByDate(booking));
    filteredBookings = filteredBookings.filter(booking => filterByDestination(booking));
    filteredBookings = filteredBookings.filter(booking => filterByTripType(booking));
    filteredBookings = filteredBookings.filter(booking => filterByDuration(booking));
    
    DOM_ELEMENTS.resultsCount.textContent = filteredBookings.length;
    
    if (filteredBookings.length === 0) {
        DOM_ELEMENTS.cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-inbox"></i> No ${currentStatus} provincial bookings found</div>`;
        return;
    }
    
    DOM_ELEMENTS.cardsContainer.innerHTML = filteredBookings.map(booking => renderBookingCard(booking)).join('');
    attachCardActionListeners();
}

function renderBookingCard(booking) {
    const travelDate = formatReadableDate(booking.travelDate);
    const status = getStatusBadge(booking.status);
    const amount = `₱${parseFloat(booking.amount || 0).toLocaleString()}`;
    const originalAmount = booking.originalAmount ? `₱${parseFloat(booking.originalAmount).toLocaleString()}` : null;
    const payment = getPaymentStatusBadge(booking.paymentStatus);
    const tripType = getTripTypeBadge(booking.tripType);
    const hasPoints = (booking.pointsRedeemed || 0) > 0;
    
    return `
        <div class="booking-card" data-booking-id="${booking.id}">
            <div class="card-header-section">
                <div class="booking-ref">
                    🎫 ${escapeHtml(booking.id)}
                </div>
                <div class="card-badges">
                    ${payment}
                    ${tripType}
                </div>
            </div>
            
            <div class="card-body">
                <div class="info-row">
                    <div class="info-item">👤 <span><strong>${escapeHtml(booking.clientName)}</strong></span></div>
                    <div class="info-item">📞 <span>${escapeHtml(booking.contactNumber)}</span></div>
                    <div class="info-item">✉️ <span>${escapeHtml(booking.email)}</span></div>
                </div>
                
                <div class="info-row">
                    <div class="info-item">📅 <span><strong>Travel Date:</strong> ${travelDate}</span></div>
                    <div class="info-item">⏰ <span><strong>Pickup Time:</strong> ${escapeHtml(booking.pickupTime || 'Flexible')}</span></div>
                    <div class="info-item">🚗 <span><strong>Vehicle:</strong> ${escapeHtml(booking.vehicleType || 'N/A')}</span></div>
                </div>
                
                <div class="location-section">
                    <div class="location-row">
                        <div class="location-label">📍 PICKUP:</div>
                        <div class="location-value">${escapeHtml(booking.pickupLocation || 'N/A')}</div>
                    </div>
                    <div class="location-row">
                        <div class="location-label">🏁 DESTINATION:</div>
                        <div class="location-value">${escapeHtml(booking.destination || 'N/A')}</div>
                    </div>
                </div>
                
                <div class="trip-info-card">
                    <span><i class="fas fa-hourglass-half"></i> Duration: <strong>${escapeHtml(booking.duration || 'N/A')}</strong></span>
                </div>
                
                ${booking.plannedItinerary ? `
                <div class="itinerary-info">
                    <i class="fas fa-map"></i> Itinerary: ${escapeHtml(booking.plannedItinerary)}
                </div>
                ` : ''}
                
                ${hasPoints ? `
                <div class="points-section">
                    <span><i class="fas fa-star"></i> Points Redeemed: <strong>${booking.pointsRedeemed}</strong></span>
                    <span><i class="fas fa-tag"></i> Points Discount: ₱${escapeHtml(booking.pointsDiscount || 0)}</span>
                </div>
                ` : ''}
                
                <div class="price-section">
                    <div class="amount">
                        💰 ${amount}
                        ${originalAmount ? `<span class="original-amount"> (was ${originalAmount})</span>` : ''}
                    </div>
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
        return `${viewBtn}<button class="card-action-btn btn-complete-card" data-action="complete" data-booking-id="${booking.id}">✅ Complete</button><button class="card-action-btn btn-reassign-card" data-action="reassign" data-booking-id="${booking.id}">🔄 Reassign</button><button class="card-action-btn btn-cancel-card" data-action="cancel" data-booking-id="${booking.id}">🗑️ Cancel</button>`;
    } else {
        return viewBtn;
    }
}

function getStatusBadge(status) {
    const badges = {
        'unassigned': '<span class="status-badge status-unassigned">⏳ Unassigned</span>',
        'assigned': '<span class="status-badge status-assigned">✓ Assigned</span>',
        'completed': '<span class="status-badge status-completed">✅ Completed</span>',
        'cancelled': '<span class="status-badge status-cancelled">❌ Cancelled</span>'
    };
    return badges[status] || `<span class="status-badge">${status}</span>`;
}

function getTripTypeBadge(tripType) {
    if (!tripType) return '';
    const isRoundTrip = tripType === 'roundtrip';
    const icon = isRoundTrip ? '🔄' : '➡️';
    const typeClass = isRoundTrip ? 'trip-type-roundtrip' : 'trip-type-oneway';
    const typeText = isRoundTrip ? 'Round Trip' : 'One Way';
    return `<span class="trip-type-badge ${typeClass}">${icon} ${typeText}</span>`;
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
        const response = await apiRequest(`/api/common/provincial-car-rental/bookings/${bookingId}`);
        const data = await response.json();
        if (data.success) {
            MODAL_ELEMENTS.bookingDetails.innerHTML = renderBookingDetails(data.booking);
            MODAL_ELEMENTS.viewBooking.style.display = 'flex';
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
    const originalAmount = booking.originalAmount ? `₱${parseFloat(booking.originalAmount).toLocaleString()}` : null;
    
    return `
        <div class="booking-details">
            <div class="details-section">
                <h4>📋 Booking Information</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>🎫 Booking Reference:</label><span><strong>${escapeHtml(booking.id)}</strong></span></div>
                    <div class="detail-item"><label>🚗 Service Type:</label><span>Provincial Car Rental with Driver</span></div>
                    <div class="detail-item"><label>📊 Status:</label><span>${getStatusBadge(booking.status)}</span></div>
                    <div class="detail-item"><label>💳 Payment Status:</label><span>${getPaymentStatusBadge(booking.paymentStatus)}</span></div>
                    <div class="detail-item"><label>💰 Amount:</label><span><strong>₱${parseFloat(booking.amount || 0).toLocaleString()}</strong>${originalAmount ? `<br><small class="original-amount">Original: ${originalAmount}</small>` : ''}</span></div>
                    <div class="detail-item"><label>💎 Payment Method:</label><span>${escapeHtml(booking.paymentMethod || 'N/A')}</span></div>
                    <div class="detail-item"><label>⭐ Points Redeemed:</label><span>${booking.pointsRedeemed || 0} (₱${booking.pointsDiscount || 0} discount)</span></div>
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
                    <div class="detail-item"><label>🏁 Destination:</label><span>${escapeHtml(booking.destination || 'N/A')}</span></div>
                    <div class="detail-item"><label>📅 Pickup Date & Time:</label><span>${pickupDateTime}</span></div>
                    <div class="detail-item"><label>⏱️ Duration:</label><span>${escapeHtml(booking.duration || 'N/A')}</span></div>
                    <div class="detail-item"><label>🔄 Trip Type:</label><span>${booking.tripType === 'roundtrip' ? 'Round Trip' : 'One Way'}</span></div>
                    <div class="detail-item"><label>🚐 Vehicle Type:</label><span>${escapeHtml(booking.vehicleType || 'N/A')}</span></div>
                    <div class="detail-item"><label>📍 Area:</label><span>${escapeHtml(booking.area || 'N/A')}</span></div>
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
            
            ${booking.completed_at ? `
            <div class="details-section">
                <h4>✅ Completion Details</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>Completed At:</label><span>${new Date(booking.completed_at).toLocaleString()}</span></div>
                    <div class="detail-item"><label>Completion Notes:</label><span>${escapeHtml(booking.completion_notes || 'N/A')}</span></div>
                </div>
            </div>
            ` : ''}
        </div>
    `;
}

async function openAssignDriverModal(bookingId) {
    try {
        const bookingResponse = await apiRequest(`/api/common/provincial-car-rental/bookings/${bookingId}`);
        const bookingData = await bookingResponse.json();
        
        if (!bookingData.success) {
            toastError('Failed to load booking details', 'Error');
            return;
        }
        
        const booking = bookingData.booking;
        const requiredVehicleType = (booking.vehicleType || 'sedan').toUpperCase();
        
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
        
        await loadDrivers();
        await loadVehiclesByType(requiredVehicleType.toLowerCase());
        
        MODAL_ELEMENTS.selectedBookingId.value = bookingId;
        MODAL_ELEMENTS.assignDriver.style.display = 'flex';
        
    } catch (error) {
        console.error('Error opening assign modal:', error);
        toastError('Failed to load assignment options', 'Error');
    }
}

async function loadVehiclesByType(vehicleType) {
    try {
        const response = await apiRequest(`/api/common/provincial-car-rental/vehicles/available?type=${encodeURIComponent(vehicleType)}`);
        const data = await response.json();
        
        if (data.success && data.vehicles && data.vehicles.length > 0) {
            MODAL_ELEMENTS.vehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            MODAL_ELEMENTS.reassignVehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            data.vehicles.forEach(vehicle => {
                const option = document.createElement('option');
                option.value = vehicle.id;
                option.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number} (${vehicle.type})`;
                MODAL_ELEMENTS.vehicleSelect.appendChild(option);
                const option2 = document.createElement('option');
                option2.value = vehicle.id;
                option2.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number} (${vehicle.type})`;
                MODAL_ELEMENTS.reassignVehicleSelect.appendChild(option2);
            });
        } else {
            MODAL_ELEMENTS.vehicleSelect.innerHTML = `<option value="">No ${vehicleType} vehicles available</option>`;
            MODAL_ELEMENTS.reassignVehicleSelect.innerHTML = `<option value="">No ${vehicleType} vehicles available</option>`;
            toastWarning(`No ${vehicleType} vehicles available for assignment`, 'Vehicle Unavailable');
        }
    } catch (error) {
        console.error('Error loading vehicles:', error);
        MODAL_ELEMENTS.vehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
        MODAL_ELEMENTS.reassignVehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
        toastError('Failed to load vehicles. Please try again.', 'Error');
    }
}

async function loadDrivers() {
    try {
        const response = await apiRequest('/api/common/provincial-car-rental/drivers/available');
        const data = await response.json();
        
        if (data.success && data.drivers && data.drivers.length > 0) {
            MODAL_ELEMENTS.driverSelect.innerHTML = '<option value="">Choose Driver</option>';
            MODAL_ELEMENTS.reassignDriverSelect.innerHTML = '<option value="">Choose Driver</option>';
            data.drivers.forEach(driver => {
                const option = document.createElement('option');
                option.value = driver.id;
                option.textContent = driver.name;
                MODAL_ELEMENTS.driverSelect.appendChild(option);
                const option2 = document.createElement('option');
                option2.value = driver.id;
                option2.textContent = driver.name;
                MODAL_ELEMENTS.reassignDriverSelect.appendChild(option2);
            });
        } else {
            MODAL_ELEMENTS.driverSelect.innerHTML = '<option value="">No drivers available</option>';
            MODAL_ELEMENTS.reassignDriverSelect.innerHTML = '<option value="">No drivers available</option>';
            toastWarning('No drivers available for assignment', 'Attention');
        }
    } catch (error) {
        console.error('Error loading drivers:', error);
        MODAL_ELEMENTS.driverSelect.innerHTML = '<option value="">Error loading drivers</option>';
        MODAL_ELEMENTS.reassignDriverSelect.innerHTML = '<option value="">Error loading drivers</option>';
        toastError('Failed to load drivers. Please try again.', 'Error');
    }
}

async function handleAssignDriver(e) {
    e.preventDefault();
    const bookingId = MODAL_ELEMENTS.selectedBookingId.value;
    const driverId = MODAL_ELEMENTS.driverSelect.value;
    const vehicleId = MODAL_ELEMENTS.vehicleSelect.value;
    const notes = MODAL_ELEMENTS.assignmentNotes.value;
    
    if (!driverId || !vehicleId) {
        toastError('Please select both driver and vehicle', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Assigning...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/provincial-car-rental/bookings/${bookingId}/assign`, {
            method: 'POST',
            body: JSON.stringify({ driver_id: driverId, vehicle_id: vehicleId, assignment_notes: notes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Driver assigned successfully!', 'Assignment Complete');
            MODAL_ELEMENTS.assignDriver.style.display = 'none';
            MODAL_ELEMENTS.assignmentNotes.value = '';
            MODAL_ELEMENTS.driverSelect.value = '';
            MODAL_ELEMENTS.vehicleSelect.value = '';
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

function openCompleteTripModal(bookingId) {
    MODAL_ELEMENTS.completeTripBookingId.value = bookingId;
    MODAL_ELEMENTS.completeTrip.style.display = 'flex';
}

async function handleCompleteTrip(e) {
    e.preventDefault();
    const bookingId = MODAL_ELEMENTS.completeTripBookingId.value;
    const notes = MODAL_ELEMENTS.completionNotes.value;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/provincial-car-rental/bookings/${bookingId}/complete`, {
            method: 'POST',
            body: JSON.stringify({ completion_notes: notes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Booking completed successfully!', 'Complete');
            MODAL_ELEMENTS.completeTrip.style.display = 'none';
            MODAL_ELEMENTS.completionNotes.value = '';
            loadBookings(true);
        } else {
            toastError(data.message || 'Failed to complete booking', 'Error');
        }
    } catch (error) {
        console.error('Error completing booking:', error);
        toastError('Failed to complete booking', 'Error');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

function openCancelBookingModal(bookingId) {
    MODAL_ELEMENTS.cancelBookingId.value = bookingId;
    MODAL_ELEMENTS.cancelReason.value = '';
    MODAL_ELEMENTS.cancelBooking.style.display = 'flex';
}

async function handleCancelBooking(e) {
    e.preventDefault();
    const bookingId = MODAL_ELEMENTS.cancelBookingId.value;
    const reason = MODAL_ELEMENTS.cancelReason.value;
    
    if (!reason) {
        toastError('Please provide a cancellation reason', 'Validation Error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/provincial-car-rental/bookings/${bookingId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ cancellation_reason: reason })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Booking cancelled successfully!', 'Cancelled');
            MODAL_ELEMENTS.cancelBooking.style.display = 'none';
            MODAL_ELEMENTS.cancelReason.value = '';
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
        const bookingResponse = await apiRequest(`/api/common/provincial-car-rental/bookings/${bookingId}`);
        const bookingData = await bookingResponse.json();
        
        if (!bookingData.success) {
            toastError('Failed to load booking details', 'Error');
            return;
        }
        
        const booking = bookingData.booking;
        const requiredVehicleType = (booking.vehicleType || 'sedan').toLowerCase();
        
        await loadDrivers();
        await loadVehiclesForReassign(requiredVehicleType);
        
        MODAL_ELEMENTS.reassignBookingId.value = bookingId;
        MODAL_ELEMENTS.reassignReason.value = '';
        MODAL_ELEMENTS.reassignDriver.style.display = 'flex';
        
    } catch (error) {
        console.error('Error opening reassign modal:', error);
        toastError('Failed to load reassignment options', 'Error');
    }
}

async function loadVehiclesForReassign(vehicleType) {
    try {
        const response = await apiRequest(`/api/common/provincial-car-rental/vehicles/available?type=${encodeURIComponent(vehicleType)}`);
        const data = await response.json();
        
        if (data.success && data.vehicles && data.vehicles.length > 0) {
            MODAL_ELEMENTS.reassignVehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            data.vehicles.forEach(vehicle => {
                const option = document.createElement('option');
                option.value = vehicle.id;
                option.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number} (${vehicle.type})`;
                MODAL_ELEMENTS.reassignVehicleSelect.appendChild(option);
            });
        } else {
            MODAL_ELEMENTS.reassignVehicleSelect.innerHTML = `<option value="">No ${vehicleType} vehicles available</option>`;
            toastWarning(`No ${vehicleType} vehicles available for reassignment`, 'Vehicle Unavailable');
        }
    } catch (error) {
        console.error('Error loading vehicles for reassign:', error);
        MODAL_ELEMENTS.reassignVehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
    }
}

async function handleReassignDriver(e) {
    e.preventDefault();
    const bookingId = MODAL_ELEMENTS.reassignBookingId.value;
    const driverId = MODAL_ELEMENTS.reassignDriverSelect.value;
    const vehicleId = MODAL_ELEMENTS.reassignVehicleSelect.value;
    const reason = MODAL_ELEMENTS.reassignReason.value;
    
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
        const response = await apiRequest(`/api/common/provincial-car-rental/bookings/${bookingId}/reassign`, {
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
            MODAL_ELEMENTS.reassignDriver.style.display = 'none';
            MODAL_ELEMENTS.reassignReason.value = '';
            MODAL_ELEMENTS.reassignDriverSelect.value = '';
            MODAL_ELEMENTS.reassignVehicleSelect.value = '';
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