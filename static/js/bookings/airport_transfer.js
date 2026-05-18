// airport_transfer.js - Airport Transfer Booking Management

// ============================================
// CSRF TOKEN HELPER FUNCTIONS
// ============================================

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
// FIREBASE REALTIME LISTENER SETUP
// ============================================

let firebaseListener = null;
let lastUpdateTime = null;
let pendingRefresh = false;

function setupFirebaseListener() {
    // Check if Firebase is available
    if (typeof firebase === 'undefined' || !firebase.database) {
        console.warn('Firebase not available, falling back to manual refresh');
        return;
    }
    
    try {
        // Get Firebase database reference
        const db = firebase.database();
        const pendingRef = db.ref('/pendingBooking');
        
        // Query for airport transfer bookings only
        firebaseListener = pendingRef.orderByChild('bookingType').equalTo('airportTransfer');
        
        // Listen for changes
        firebaseListener.on('value', (snapshot) => {
            const data = snapshot.val();
            const now = Date.now();
            
            // Debounce rapid updates (prevents too many refreshes)
            if (lastUpdateTime && (now - lastUpdateTime) < 1000) {
                if (!pendingRefresh) {
                    pendingRefresh = true;
                    setTimeout(() => {
                        processRealtimeUpdate(data);
                        pendingRefresh = false;
                    }, 1000);
                }
                return;
            }
            
            lastUpdateTime = now;
            processRealtimeUpdate(data);
            
        }, (error) => {
            console.error('Firebase listener error:', error);
            toastWarning('Real-time connection issue. Please refresh manually.', 'Connection');
        });
        
        console.log('Firebase realtime listener activated');
        
    } catch (error) {
        console.error('Failed to setup Firebase listener:', error);
    }
}

function processRealtimeUpdate(data) {
    if (!data) {
        // No data, clear bookings if needed
        if (allBookings.length > 0) {
            allBookings = [];
            renderBookingsCards();
            updateStats();
            toastInfo('All bookings cleared', 'Update');
        }
        return;
    }
    
    // Transform Firebase data to array
    const freshBookings = [];
    for (const [id, booking] of Object.entries(data)) {
        if (booking.bookingType === 'airportTransfer') {
            freshBookings.push({
                id: id,
                ...booking
            });
        }
    }
    
    // Sort by date and time
    freshBookings.sort((a, b) => {
        const dateCompare = (b.date || '').localeCompare(a.date || '');
        if (dateCompare !== 0) return dateCompare;
        return (b.time || '').localeCompare(a.time || '');
    });
    
    // Check if there are actual changes before updating UI
    const hasChanges = JSON.stringify(freshBookings) !== JSON.stringify(allBookings);
    
    if (hasChanges) {
        allBookings = freshBookings;
        
        // Filter by current status and render
        const filteredByStatus = allBookings.filter(b => {
            if (currentStatus === 'all') return true;
            return b.status === currentStatus;
        });
        
        // Update UI
        updateStats();
        updateStatusCounts();
        
        // Only re-render if the current tab has changes
        if (filteredByStatus.length !== resultsCount.textContent || hasChanges) {
            renderBookingsCards();
        }
        
        // Show subtle notification for important changes
        const changeType = detectChangeType(allBookings, freshBookings);
        if (changeType === 'new') {
            toastInfo('New booking received!', 'Real-time Update');
        } else if (changeType === 'status_change') {
            toastInfo('Booking status updated', 'Real-time Update');
        }
    }
}

function detectChangeType(oldBookings, newBookings) {
    if (newBookings.length > oldBookings.length) return 'new';
    if (JSON.stringify(oldBookings) !== JSON.stringify(newBookings)) return 'status_change';
    return null;
}

function stopFirebaseListener() {
    if (firebaseListener) {
        firebaseListener.off();
        firebaseListener = null;
        console.log('Firebase listener stopped');
    }
}

// ============================================
// CACHE MANAGEMENT
// ============================================

let lastInitialLoad = null;
const CACHE_DURATION = 30000; // 30 seconds

// Check if cache is still valid
function isCacheValid() {
    return lastInitialLoad && (Date.now() - lastInitialLoad) < CACHE_DURATION;
}

// ============================================
// GLOBAL VARIABLES
// ============================================

const SERVICE_TYPE = 'airportTransfer';
let currentStatus = 'unassigned';
let allBookings = [];
let currentSearchTerm = '';
let currentDateFilter = 'all';

// DOM Elements
const totalBookingsEl = document.getElementById('totalBookings');
const todayBookingsEl = document.getElementById('todayBookings');
const totalRevenueEl = document.getElementById('totalRevenue');
const searchInput = document.getElementById('searchInput');
const dateFilter = document.getElementById('dateFilter');
const refreshBtn = document.getElementById('refreshBookingsBtn');
const cardsContainer = document.getElementById('bookingsCardsContainer');
const tableTitle = document.getElementById('tableTitle');
const resultsCount = document.getElementById('resultsCount');

// Modal elements
const viewBookingModal = document.getElementById('viewBookingModal');
const assignDriverModal = document.getElementById('assignDriverModal');
const cancelBookingModal = document.getElementById('cancelBookingModal');
const completeBookingModal = document.getElementById('completeBookingModal');
const bookingDetailsContainer = document.getElementById('bookingDetailsContainer');
const driverSelect = document.getElementById('driverSelect');
const vehicleSelect = document.getElementById('vehicleSelect');
const selectedBookingId = document.getElementById('selectedBookingId');
const cancelBookingId = document.getElementById('cancelBookingId');
const cancelReason = document.getElementById('cancelReason');
const completeBookingId = document.getElementById('completeBookingId');
const completionNotes = document.getElementById('completionNotes');
const assignmentNotes = document.getElementById('assignmentNotes');

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadBookings();
    setupEventListeners();
    setupFirebaseListener(); // Start real-time listener
});

// Clean up listener on page unload
window.addEventListener('beforeunload', () => {
    stopFirebaseListener();
});

// Setup all event listeners
function setupEventListeners() {
    // Status tabs
    document.querySelectorAll('.status-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentStatus = tab.dataset.status;
            updateTableTitle();
            
            // Re-filter and render from existing data
            const filteredByStatus = allBookings.filter(b => {
                if (currentStatus === 'all') return true;
                return b.status === currentStatus;
            });
            
            // Update stats for this status
            const stats = calculateStatusStats(filteredByStatus);
            totalBookingsEl.textContent = filteredByStatus.length;
            totalRevenueEl.textContent = `₱${stats.revenue.toLocaleString()}`;
            
            renderBookingsCards();
        });
    });

    // Search input with debounce
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearchTerm = e.target.value.toLowerCase();
            renderBookingsCards();
        }, 300);
    });

    // Date filter
    dateFilter.addEventListener('change', (e) => {
        currentDateFilter = e.target.value;
        renderBookingsCards();
    });

    // Refresh button - force manual refresh
    refreshBtn.addEventListener('click', () => {
        loadBookings(true); // Force refresh
        toastInfo('Manually refreshed', 'Refresh');
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
    document.getElementById('closeCancelBookingModal')?.addEventListener('click', () => {
        cancelBookingModal.style.display = 'none';
    });
    document.getElementById('closeCompleteBookingModal')?.addEventListener('click', () => {
        completeBookingModal.style.display = 'none';
    });
    document.getElementById('cancelAssignBtn')?.addEventListener('click', () => {
        assignDriverModal.style.display = 'none';
    });
    document.getElementById('cancelBookingBtn')?.addEventListener('click', () => {
        cancelBookingModal.style.display = 'none';
    });
    document.getElementById('cancelCompleteBtn')?.addEventListener('click', () => {
        completeBookingModal.style.display = 'none';
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
    document.getElementById('cancelBookingForm')?.addEventListener('submit', handleCancelBooking);
    document.getElementById('completeBookingForm')?.addEventListener('submit', handleCompleteBooking);
}

// Update table title based on current status
function updateTableTitle() {
    const titles = {
        'unassigned': 'Unassigned Airport Transfers',
        'assigned': 'Assigned Airport Transfers',
        'completed': 'Completed Airport Transfers',
        'cancelled': 'Cancelled Airport Transfers',
        'all': 'All Airport Transfers'
    };
    tableTitle.textContent = titles[currentStatus] || 'Airport Transfers';
}

// Calculate stats for a filtered booking list
function calculateStatusStats(bookings) {
    const today = new Date().toISOString().split('T')[0];
    const todayCount = bookings.filter(b => {
        if (b.date) {
            const formattedDate = formatDateForComparison(b.date);
            return formattedDate === today;
        }
        return false;
    }).length;
    
    const revenue = bookings
        .filter(b => b.paymentStatus === 'paid')
        .reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    
    return { todayCount, revenue };
}

// Load bookings from API (initial load or manual refresh)
async function loadBookings(forceRefresh = false) {
    try {
        // Check cache for initial loads
        if (!forceRefresh && isCacheValid() && allBookings.length > 0) {
            console.log('Using cached data');
            return;
        }
        
        showLoadingState();
        
        const response = await apiRequest(`/api/common/airport-transfer/bookings?status=all`);
        
        if (!response.ok) {
            throw new Error('Failed to load bookings');
        }
        
        const data = await response.json();
        
        if (data.success) {
            allBookings = data.bookings;
            lastInitialLoad = Date.now();
            
            // Filter by current status for display
            const filteredByStatus = allBookings.filter(b => {
                if (currentStatus === 'all') return true;
                return b.status === currentStatus;
            });
            
            const stats = calculateStatusStats(filteredByStatus);
            todayBookingsEl.textContent = stats.todayCount;
            totalRevenueEl.textContent = `₱${stats.revenue.toLocaleString()}`;
            
            updateStatusCounts();
            renderBookingsCards();
            
            const count = filteredByStatus.length;
            if (count === 0) {
                toastInfo(`No ${currentStatus} airport transfer bookings found`, 'Info');
            } else if (forceRefresh) {
                toastSuccess(`Refreshed ${count} ${currentStatus} airport transfer bookings`, 'Success');
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

// Show loading state
function showLoadingState() {
    if (allBookings.length === 0) {
        cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-spinner fa-spin"></i> Loading airport transfer bookings...</div>`;
    }
}

// Update statistics based on current status
function updateStats() {
    const filteredByStatus = allBookings.filter(b => {
        if (currentStatus === 'all') return true;
        return b.status === currentStatus;
    });
    
    totalBookingsEl.textContent = filteredByStatus.length;
    
    const today = new Date().toISOString().split('T')[0];
    const todayBookings = filteredByStatus.filter(booking => {
        const bookingDate = booking.date;
        if (bookingDate) {
            const formattedDate = formatDateForComparison(bookingDate);
            return formattedDate === today;
        }
        return false;
    }).length;
    todayBookingsEl.textContent = todayBookings;
    
    let totalRevenue = 0;
    if (currentStatus === 'unassigned' || currentStatus === 'assigned') {
        totalRevenue = filteredByStatus
            .filter(b => b.paymentStatus === 'paid')
            .reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    }
    totalRevenueEl.textContent = `₱${totalRevenue.toLocaleString()}`;
}

// Update status counts in tabs
async function updateStatusCounts() {
    try {
        const response = await apiRequest('/api/common/airport-transfer/bookings/counts');
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

// Format date for comparison
function formatDateForComparison(dateStr) {
    if (!dateStr) return null;
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
            return `${parts[2]}-${parts[0]}-${parts[1]}`;
        }
    }
    return dateStr;
}

// Filter by date range
function filterByDate(booking) {
    if (currentDateFilter === 'all') return true;
    
    const bookingDate = booking.date;
    if (!bookingDate) return false;
    
    const [month, day, year] = bookingDate.split('-');
    const bookingDateObj = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    switch(currentDateFilter) {
        case 'today':
            const todayStr = formatDateForComparison(bookingDate);
            return todayStr === new Date().toISOString().split('T')[0];
        case 'tomorrow':
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            const bookingDateStr = formatDateForComparison(bookingDate);
            return bookingDateStr === tomorrowStr;
        case 'this_week':
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return bookingDateObj >= weekStart && bookingDateObj <= weekEnd;
        case 'next_week':
            const nextWeekStart = new Date(today);
            nextWeekStart.setDate(today.getDate() + (7 - today.getDay()));
            const nextWeekEnd = new Date(nextWeekStart);
            nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
            return bookingDateObj >= nextWeekStart && bookingDateObj <= nextWeekEnd;
        default:
            return true;
    }
}

// Render bookings as cards
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
                booking.pickup,
                booking.dropoff,
                booking.flight_number
            ];
            return searchableFields.some(field => 
                field && field.toLowerCase().includes(currentSearchTerm)
            );
        });
    }
    
    filteredBookings = filteredBookings.filter(booking => filterByDate(booking));
    
    resultsCount.textContent = filteredBookings.length;
    
    if (filteredBookings.length === 0) {
        cardsContainer.innerHTML = `<div class="loading-cards"><i class="fas fa-inbox"></i> No ${currentStatus} airport transfer bookings found</div>`;
        return;
    }
    
    cardsContainer.innerHTML = filteredBookings.map(booking => renderBookingCard(booking)).join('');
    attachCardActionListeners();
}

// Render a single booking card
function renderBookingCard(booking) {
    const date = formatReadableDate(booking.date);
    const time = booking.time || 'N/A';
    const status = getStatusBadge(booking.status);
    const amount = `₱${parseFloat(booking.amount || 0).toLocaleString()}`;
    const payment = getPaymentStatusBadge(booking.paymentStatus);
    const hasFlightNumber = booking.flight_number && booking.flight_number !== 'N/A' && booking.flight_number !== '';
    const hasNote = booking.note && booking.note !== '';
    
    const clientName = booking.clientName || 'N/A';
    const contactNumber = booking.contactNumber || 'N/A';
    const email = booking.email || 'N/A';
    const pickup = booking.pickup || 'N/A';
    const dropoff = booking.dropoff || 'N/A';
    const packageType = booking.packageType || 'N/A';
    const flightNumber = booking.flight_number || 'N/A';
    const paymentMethod = booking.paymentMethod || 'N/A';
    const note = booking.note || '';
    
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
                    <div class="info-item">👤 <span><strong>${escapeHtml(clientName)}</strong></span></div>
                    <div class="info-item">📞 <span>${escapeHtml(contactNumber)}</span></div>
                    <div class="info-item">✉️ <span>${escapeHtml(email)}</span></div>
                </div>
                
                <div class="info-row">
                    <div class="info-item">📅 <span><strong>Date:</strong> ${date}</span></div>
                    <div class="info-item">⏰ <span><strong>Time:</strong> ${escapeHtml(time)}</span></div>
                    <div class="info-item">🏷️ <span><strong>Package:</strong> ${escapeHtml(packageType)}</span></div>
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
                
                ${hasFlightNumber && flightNumber !== 'N/A' ? `
                <div class="flight-info-card">
                    ✈️ <span><strong>Flight Number:</strong> ${escapeHtml(flightNumber)}</span>
                </div>
                ` : ''}
                
                <div class="note-card">
                    📝 <span><strong>Note:</strong> ${hasNote ? escapeHtml(note) : 'No notes available'}</span>
                </div>
                
                <div class="price-section">
                    <div class="amount">💰 ${amount}</div>
                    <div class="payment-method">💳 ${escapeHtml(paymentMethod)}</div>
                </div>
                
                <div class="card-actions">
                    ${getCardActionButtons(booking)}
                </div>
            </div>
        </div>
    `;
}

// Get action buttons for card based on status
function getCardActionButtons(booking) {
    const viewBtn = `<button class="card-action-btn btn-view-card" data-action="view" data-booking-id="${booking.id}">📄 View Details</button>`;
    
    if (booking.status === 'unassigned') {
        return `${viewBtn}<button class="card-action-btn btn-assign-card" data-action="assign" data-booking-id="${booking.id}">👨‍✈️ Assign Driver</button><button class="card-action-btn btn-cancel-card" data-action="cancel" data-booking-id="${booking.id}">🗑️ Cancel</button>`;
    } else if (booking.status === 'assigned') {
        return `${viewBtn}<button class="card-action-btn btn-complete-card" data-action="complete" data-booking-id="${booking.id}">✅ Complete</button><button class="card-action-btn btn-cancel-card" data-action="cancel" data-booking-id="${booking.id}">🗑️ Cancel</button>`;
    } else {
        return viewBtn;
    }
}

// Get status badge
function getStatusBadge(status) {
    const badges = {
        'unassigned': '<span class="status-badge status-unassigned">⏳ Unassigned</span>',
        'assigned': '<span class="status-badge status-assigned">✓ Assigned</span>',
        'completed': '<span class="status-badge status-completed">✅ Completed</span>',
        'cancelled': '<span class="status-badge status-cancelled">❌ Cancelled</span>'
    };
    return badges[status] || `<span class="status-badge">${status}</span>`;
}

// Get payment status badge
function getPaymentStatusBadge(status) {
    const isPaid = status === 'paid';
    const icon = isPaid ? '✅' : '⏳';
    const statusClass = isPaid ? 'status-paid' : 'status-pending';
    const statusText = isPaid ? 'Paid' : 'Pending';
    return `<span class="payment-badge ${statusClass}">${icon} ${statusText}</span>`;
}

// Format readable date
function formatReadableDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const date = new Date(parts[2], parts[0] - 1, parts[1]);
            return date.toLocaleDateString('en-PH', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                weekday: 'short'
            });
        }
        return dateStr;
    } catch {
        return dateStr;
    }
}

// Attach card action button listeners
function attachCardActionListeners() {
    document.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener('click', () => viewBookingDetails(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="assign"]').forEach(btn => {
        btn.addEventListener('click', () => openAssignDriverModal(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="cancel"]').forEach(btn => {
        btn.addEventListener('click', () => openCancelBookingModal(btn.dataset.bookingId));
    });
    document.querySelectorAll('[data-action="complete"]').forEach(btn => {
        btn.addEventListener('click', () => openCompleteBookingModal(btn.dataset.bookingId));
    });
}

// View booking details - USING apiRequest
async function viewBookingDetails(bookingId) {
    try {
        const response = await apiRequest(`/api/common/airport-transfer/bookings/${bookingId}`);
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

// Render booking details modal content
function renderBookingDetails(booking) {
    const pickupDateTime = `${formatReadableDate(booking.date)} at ${booking.time || 'N/A'}`;
    
    return `
        <div class="booking-details">
            <div class="details-section">
                <h4>📋 Booking Information</h4>
                <div class="details-grid">
                    <div class="detail-item"><label>🎫 Booking Reference:</label><span><strong>${escapeHtml(booking.id)}</strong></span></div>
                    <div class="detail-item"><label>🚗 Service Type:</label><span>Airport Transfer</span></div>
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
                    <div class="detail-item"><label>📍 Pickup Location:</label><span>${escapeHtml(booking.pickup || 'N/A')}</span></div>
                    <div class="detail-item"><label>🏁 Dropoff Location:</label><span>${escapeHtml(booking.dropoff || 'N/A')}</span></div>
                    <div class="detail-item"><label>📅 Pickup Date & Time:</label><span>${pickupDateTime}</span></div>
                    <div class="detail-item"><label>✈️ Flight Number:</label><span>${escapeHtml(booking.flight_number || 'N/A')}</span></div>
                    <div class="detail-item"><label>🏷️ Package Type:</label><span>${escapeHtml(booking.packageType || 'N/A')}</span></div>
                </div>
            </div>
            
            ${booking.note ? `<div class="details-section"><h4>📝 Special Requests / Notes</h4><p class="flight-info">${escapeHtml(booking.note)}</p></div>` : ''}
            
            ${booking.assigned_driver ? `<div class="details-section"><h4>✅ Assignment Details</h4><div class="details-grid"><div class="detail-item"><label>👨‍✈️ Driver:</label><span>${escapeHtml(booking.assigned_driver.name || 'N/A')}</span></div><div class="detail-item"><label>📞 Driver Contact:</label><span>${escapeHtml(booking.assigned_driver.contact || 'N/A')}</span></div><div class="detail-item"><label>🚐 Vehicle:</label><span>${escapeHtml(booking.assigned_vehicle?.name || 'N/A')}</span></div><div class="detail-item"><label>🔢 Plate Number:</label><span>${escapeHtml(booking.assigned_vehicle?.plate_number || 'N/A')}</span></div></div></div>` : ''}
        </div>
    `;
}

// Open assign driver modal
async function openAssignDriverModal(bookingId) {
    try {
        await loadDrivers();
        await loadVehicles();
        selectedBookingId.value = bookingId;
        assignDriverModal.style.display = 'flex';
    } catch (error) {
        console.error('Error opening assign modal:', error);
        toastError('Failed to load assignment options', 'Error');
    }
}

// Load available drivers - USING apiRequest
async function loadDrivers() {
    try {
        const response = await apiRequest('/api/common/airport-transfer/drivers/available');
        const data = await response.json();
        
        if (data.success && data.drivers && data.drivers.length > 0) {
            driverSelect.innerHTML = '<option value="">Choose Driver</option>';
            data.drivers.forEach(driver => {
                const option = document.createElement('option');
                option.value = driver.id;
                option.textContent = driver.name;
                driverSelect.appendChild(option);
            });
        } else {
            driverSelect.innerHTML = '<option value="">No drivers available</option>';
            toastWarning('No drivers available for assignment', 'Attention');
        }
    } catch (error) {
        console.error('Error loading drivers:', error);
        driverSelect.innerHTML = '<option value="">Error loading drivers</option>';
        toastError('Failed to load drivers. Please try again.', 'Error');
    }
}

// Load available vehicles - USING apiRequest
async function loadVehicles() {
    try {
        const response = await apiRequest('/api/common/airport-transfer/vehicles/available');
        const data = await response.json();
        
        if (data.success && data.vehicles && data.vehicles.length > 0) {
            vehicleSelect.innerHTML = '<option value="">Choose Vehicle</option>';
            data.vehicles.forEach(vehicle => {
                const option = document.createElement('option');
                option.value = vehicle.id;
                option.textContent = `${vehicle.vehicle_name} - ${vehicle.plate_number}`;
                vehicleSelect.appendChild(option);
            });
        } else {
            vehicleSelect.innerHTML = '<option value="">No vehicles available</option>';
            toastWarning('No vehicles available for assignment', 'Attention');
        }
    } catch (error) {
        console.error('Error loading vehicles:', error);
        vehicleSelect.innerHTML = '<option value="">Error loading vehicles</option>';
        toastError('Failed to load vehicles. Please try again.', 'Error');
    }
}

// Handle assign driver - USING apiRequest
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
        const response = await apiRequest(`/api/common/airport-transfer/bookings/${bookingId}/assign`, {
            method: 'POST',
            body: JSON.stringify({ driver_id: driverId, vehicle_id: vehicleId, assignment_notes: notes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Driver assigned successfully!', 'Assignment Complete');
            assignDriverModal.style.display = 'none';
            assignmentNotes.value = '';
            driverSelect.value = '';
            vehicleSelect.value = '';
            // No need to call loadBookings() - Firebase listener will update automatically!
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

// Open cancel booking modal
function openCancelBookingModal(bookingId) {
    cancelBookingId.value = bookingId;
    cancelReason.value = '';
    cancelBookingModal.style.display = 'flex';
}

// Handle cancel booking - USING apiRequest
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
        const response = await apiRequest(`/api/common/airport-transfer/bookings/${bookingId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ cancellation_reason: reason })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Booking cancelled successfully!', 'Cancelled');
            cancelBookingModal.style.display = 'none';
            cancelReason.value = '';
            // No need to call loadBookings() - Firebase listener will update automatically!
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

// Open complete booking modal
function openCompleteBookingModal(bookingId) {
    completeBookingId.value = bookingId;
    completionNotes.value = '';
    completeBookingModal.style.display = 'flex';
}

// Handle complete booking - USING apiRequest
async function handleCompleteBooking(e) {
    e.preventDefault();
    const bookingId = completeBookingId.value;
    const notes = completionNotes.value;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';
    submitBtn.disabled = true;
    
    try {
        const response = await apiRequest(`/api/common/airport-transfer/bookings/${bookingId}/complete`, {
            method: 'POST',
            body: JSON.stringify({ completion_notes: notes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toastSuccess('Booking marked as completed!', 'Complete');
            completeBookingModal.style.display = 'none';
            completionNotes.value = '';
            // No need to call loadBookings() - Firebase listener will update automatically!
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

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toast shortcuts
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