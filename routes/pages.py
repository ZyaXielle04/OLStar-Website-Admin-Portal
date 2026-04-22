from flask import Blueprint, render_template, session, redirect, url_for
from functools import wraps

pages_bp = Blueprint('pages', __name__)

def login_required_page(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('pages.login_page'))
        return f(*args, **kwargs)
    return decorated_function

def role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'role' not in session:
                return redirect(url_for('pages.dashboard_redirect'))
            if session['role'] not in allowed_roles:
                return redirect(url_for('pages.dashboard_redirect'))
            return f(*args, **kwargs)
        return decorated_function
    return decorator

@pages_bp.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('pages.dashboard_redirect'))
    return redirect(url_for('pages.login_page'))

@pages_bp.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect(url_for('pages.dashboard_redirect'))
    return render_template('index.html')

@pages_bp.route('/dashboard')
@login_required_page
def dashboard_redirect():
    role = session.get('role', 'customer')
    if role == 'superadmin':
        return redirect(url_for('pages.superadmin_dashboard'))
    else:
        return redirect(url_for('pages.admin_dashboard'))

# ========== DASHBOARD PAGES ==========

@pages_bp.route('/dashboard/superadmin')
@login_required_page
@role_required(['superadmin'])
def superadmin_dashboard():
    return render_template('superadmin/dashboard.html')

@pages_bp.route('/dashboard/admin')
@login_required_page
@role_required(['admin', 'superadmin'])
def admin_dashboard():
    return render_template('admin/dashboard.html')

# ========== USER MANAGEMENT PAGES ==========

@pages_bp.route('/users')
@login_required_page
@role_required(['superadmin', 'admin'])
def users_page():
    """User Management page - both roles can access"""
    return render_template('common/users.html')

@pages_bp.route('/users/create')
@login_required_page
@role_required(['superadmin'])
def user_create_page():
    """Create User page - Superadmin only"""
    return render_template('common/user_form.html')

@pages_bp.route('/users/<user_id>/edit')
@login_required_page
@role_required(['superadmin', 'admin'])
def user_edit_page(user_id):
    """Edit User page - Both roles can access"""
    return render_template('common/user_form.html', user_id=user_id)

# ========== TRANSPORT UNITS PAGES ==========

@pages_bp.route('/transport-units')
@login_required_page
@role_required(['superadmin', 'admin'])
def transport_units_page():
    """Transport Units page - accessible by both roles"""
    return render_template('common/transport_units.html')

@pages_bp.route('/transport-units/create')
@login_required_page
@role_required(['superadmin'])  # Only superadmin can create
def transport_unit_create_page():
    """Create Transport Unit page - Superadmin only"""
    return render_template('common/transport_unit_form.html')

@pages_bp.route('/transport-units/<unit_id>/edit')
@login_required_page
@role_required(['superadmin'])  # Only superadmin can edit
def transport_unit_edit_page(unit_id):
    """Edit Transport Unit page - Superadmin only"""
    return render_template('common/transport_unit_form.html', unit_id=unit_id)

@pages_bp.route('/transport-units/<unit_id>/view')
@login_required_page
@role_required(['superadmin', 'admin'])
def transport_unit_view_page(unit_id):
    """View Transport Unit details page - Both roles can view"""
    return render_template('common/transport_unit_details.html', unit_id=unit_id)

# ========== PACKAGES PAGES ==========

@pages_bp.route('/packages')
@login_required_page
@role_required(['superadmin', 'admin'])
def packages_page():
    """Packages page - accessible by both roles"""
    return render_template('common/packages.html')

@pages_bp.route('/packages/create')
@login_required_page
@role_required(['superadmin'])  # Only superadmin can create
def package_create_page():
    """Create Package page - Superadmin only"""
    return render_template('common/package_form.html')

@pages_bp.route('/packages/<package_id>/edit')
@login_required_page
@role_required(['superadmin'])  # Only superadmin can edit
def package_edit_page(package_id):
    """Edit Package page - Superadmin only"""
    return render_template('common/package_form.html', package_id=package_id)

@pages_bp.route('/packages/<package_id>/view')
@login_required_page
@role_required(['superadmin', 'admin'])
def package_view_page(package_id):
    """View Package details page - Both roles can view"""
    return render_template('common/package_details.html', package_id=package_id)

@pages_bp.route('/packages/<package_id>/units')
@login_required_page
@role_required(['superadmin'])  # Only superadmin can manage units
def package_units_page(package_id):
    """Manage transport units for package - Superadmin only"""
    return render_template('common/package_units.html', package_id=package_id)

# ========== AIRPORT TRANSFER RATES PAGES ==========

@pages_bp.route('/rates/airport-transfer')
@login_required_page
@role_required(['superadmin', 'admin'])
def airport_transfer_page():
    return render_template('common/airport_transfer.html')

# ========== METRO MANILA TRANSFER RATES PAGES ==========

@pages_bp.route('/rates/metro-manila-transfer')
@login_required_page
@role_required(['superadmin', 'admin'])
def metro_manila_transfer_page():
    return render_template('common/metro_manila_transfer.html')

# ========== PENDING BOOKINGS PAGES ==========

@pages_bp.route('/pending-bookings')
@login_required_page
@role_required(['superadmin', 'admin'])
def pending_bookings_page():
    """Pending Bookings page - accessible by both roles"""
    return render_template('common/pending_bookings.html')

@pages_bp.route('/pending-bookings/<booking_id>/approve')
@login_required_page
@role_required(['superadmin', 'admin'])
def pending_booking_approve_page(booking_id):
    """Approve booking page"""
    return render_template('common/booking_approve.html', booking_id=booking_id)

@pages_bp.route('/pending-bookings/<booking_id>/reject')
@login_required_page
@role_required(['superadmin', 'admin'])
def pending_booking_reject_page(booking_id):
    """Reject booking page"""
    return render_template('common/booking_reject.html', booking_id=booking_id)

@pages_bp.route('/pending-bookings/<booking_id>/details')
@login_required_page
@role_required(['superadmin', 'admin'])
def pending_booking_details_page(booking_id):
    """View booking details page"""
    return render_template('common/booking_details.html', booking_id=booking_id)

# ========== BOOKING HISTORY PAGES ==========

@pages_bp.route('/booking-history')
@login_required_page
@role_required(['superadmin', 'admin'])
def booking_history_page():
    """Booking History page - accessible by both roles"""
    return render_template('common/booking_history.html')

@pages_bp.route('/booking-history/<booking_id>/details')
@login_required_page
@role_required(['superadmin', 'admin'])
def booking_history_details_page(booking_id):
    """View past booking details page"""
    return render_template('common/booking_details.html', booking_id=booking_id)

@pages_bp.route('/booking-history/<booking_id>/repeat')
@login_required_page
@role_required(['superadmin', 'admin'])
def booking_history_repeat_page(booking_id):
    """Repeat a past booking page"""
    return render_template('common/booking_repeat.html', booking_id=booking_id)

# ========== SUPERADMIN ONLY PAGES ==========

@pages_bp.route('/superadmin/admins')
@login_required_page
@role_required(['superadmin'])
def admins_page():
    """Manage Admins page - Superadmin only"""
    return render_template('superadmin/admins.html')

@pages_bp.route('/superadmin/admins/create')
@login_required_page
@role_required(['superadmin'])
def admin_create_page():
    """Create Admin page - Superadmin only"""
    return render_template('superadmin/admin_form.html')

@pages_bp.route('/superadmin/admins/<admin_id>/edit')
@login_required_page
@role_required(['superadmin'])
def admin_edit_page(admin_id):
    """Edit Admin page - Superadmin only"""
    return render_template('superadmin/admin_form.html', admin_id=admin_id)

@pages_bp.route('/superadmin/admins/<admin_id>/view')
@login_required_page
@role_required(['superadmin'])
def admin_view_page(admin_id):
    """View Admin details page - Superadmin only"""
    return render_template('superadmin/admin_details.html', admin_id=admin_id)

# ========== REDIRECTS FOR CLEAN URLS ==========

@pages_bp.route('/superadmin/users')
@login_required_page
@role_required(['superadmin'])
def superadmin_users_redirect():
    """Redirect old superadmin users URL to common users page"""
    return redirect(url_for('pages.users_page'))

@pages_bp.route('/admin/users')
@login_required_page
@role_required(['admin', 'superadmin'])
def admin_users_redirect():
    """Redirect old admin users URL to common users page"""
    return redirect(url_for('pages.users_page'))

@pages_bp.route('/superadmin/transport-units')
@login_required_page
@role_required(['superadmin'])
def superadmin_transport_units_redirect():
    """Redirect old superadmin transport units URL to common page"""
    return redirect(url_for('pages.transport_units_page'))

@pages_bp.route('/admin/transport-units')
@login_required_page
@role_required(['admin', 'superadmin'])
def admin_transport_units_redirect():
    """Redirect old admin transport units URL to common page"""
    return redirect(url_for('pages.transport_units_page'))

@pages_bp.route('/superadmin/pending-bookings')
@login_required_page
@role_required(['superadmin'])
def superadmin_pending_bookings_redirect():
    """Redirect old superadmin pending bookings URL to common page"""
    return redirect(url_for('pages.pending_bookings_page'))

@pages_bp.route('/admin/booking-history')
@login_required_page
@role_required(['admin', 'superadmin'])
def admin_booking_history_redirect():
    """Redirect old admin booking history URL to common page"""
    return redirect(url_for('pages.booking_history_page'))