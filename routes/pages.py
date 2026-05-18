from flask import Blueprint, render_template, session, redirect, url_for
from functools import wraps

pages_bp = Blueprint('pages', __name__)

# ============================================
# AUTH HELPERS
# ============================================

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


# ============================================
# ROOT
# ============================================

@pages_bp.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('pages.dashboard_redirect'))

    return redirect(url_for('pages.login_page'))


@pages_bp.route('/login')
def login_page():

    if 'user_id' in session:

        role = session.get('role', 'customer')

        if role == 'customer':
            session.clear()
        else:
            return redirect(url_for('pages.dashboard_redirect'))

    return render_template('index.html')


@pages_bp.route('/dashboard')
@login_required_page
def dashboard_redirect():

    role = session.get('role', 'customer')

    if role == 'customer':
        return redirect(url_for('pages.login_page'))

    if role == 'superadmin':
        return redirect(url_for('pages.superadmin_dashboard'))

    return redirect(url_for('pages.admin_dashboard'))


# ============================================
# DASHBOARDS
# ============================================

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


# ============================================
# USER MANAGEMENT
# ============================================

@pages_bp.route('/users/admins')
@login_required_page
@role_required(['superadmin'])
def users_admins_page():
    return render_template(
        'users/admins.html',
        page_title="Admins",
        user_type="admins",
        allow_add_user=True
    )


@pages_bp.route('/users/customers')
@login_required_page
@role_required(['superadmin', 'admin'])
def users_customers_page():
    return render_template(
        'users/customers.html',
        page_title="Customers",
        user_type="customers",
        allow_add_user=False
    )


@pages_bp.route('/users/drivers')
@login_required_page
@role_required(['superadmin', 'admin'])
def users_drivers_page():
    return render_template(
        'users/drivers.html',
        page_title="Drivers",
        user_type="drivers",
        allow_add_user=True
    )


@pages_bp.route('/users/create')
@login_required_page
@role_required(['superadmin'])
def user_create_page():
    return render_template('common/user_form.html')


@pages_bp.route('/users/<user_id>/edit')
@login_required_page
@role_required(['superadmin', 'admin'])
def user_edit_page(user_id):
    return render_template(
        'common/user_form.html',
        user_id=user_id
    )


# ============================================
# TRANSPORT UNITS
# ============================================

@pages_bp.route('/transport-units')
@login_required_page
@role_required(['superadmin', 'admin'])
def transport_units_page():
    return render_template('common/transport_units.html')


@pages_bp.route('/transport-units/create')
@login_required_page
@role_required(['superadmin'])
def transport_unit_create_page():
    return render_template('common/transport_unit_form.html')


@pages_bp.route('/transport-units/<unit_id>/edit')
@login_required_page
@role_required(['superadmin'])
def transport_unit_edit_page(unit_id):
    return render_template(
        'common/transport_unit_form.html',
        unit_id=unit_id
    )


@pages_bp.route('/transport-units/<unit_id>/view')
@login_required_page
@role_required(['superadmin', 'admin'])
def transport_unit_view_page(unit_id):
    return render_template(
        'common/transport_unit_details.html',
        unit_id=unit_id
    )


# ============================================
# PACKAGES
# ============================================

@pages_bp.route('/packages')
@login_required_page
@role_required(['superadmin', 'admin'])
def packages_page():
    return render_template('common/packages.html')


@pages_bp.route('/packages/create')
@login_required_page
@role_required(['superadmin'])
def package_create_page():
    return render_template('common/package_form.html')


@pages_bp.route('/packages/<package_id>/edit')
@login_required_page
@role_required(['superadmin'])
def package_edit_page(package_id):
    return render_template(
        'common/package_form.html',
        package_id=package_id
    )


@pages_bp.route('/packages/<package_id>/view')
@login_required_page
@role_required(['superadmin', 'admin'])
def package_view_page(package_id):
    return render_template(
        'common/package_details.html',
        package_id=package_id
    )


@pages_bp.route('/packages/<package_id>/units')
@login_required_page
@role_required(['superadmin'])
def package_units_page(package_id):
    return render_template(
        'common/package_units.html',
        package_id=package_id
    )


# ============================================
# RATES
# ============================================

@pages_bp.route('/rates/airport-transfer')
@login_required_page
@role_required(['superadmin', 'admin'])
def airport_transfer_page():
    return render_template('common/airport_transfer.html')


@pages_bp.route('/rates/metro-manila-transfer')
@login_required_page
@role_required(['superadmin', 'admin'])
def metro_manila_transfer_page():
    return render_template('common/metro_manila_transfer.html')


@pages_bp.route('/rates/car-rental/self-drive')
@login_required_page
@role_required(['superadmin', 'admin'])
def car_rental_self_drive_page():
    return render_template('common/car_rental.html')


@pages_bp.route('/rates/car-rental/with-driver')
@login_required_page
@role_required(['superadmin', 'admin'])
def car_rental_with_driver_page():
    return render_template('common/car_rental.html')


# ============================================
# BOOKINGS
# ============================================

@pages_bp.route('/bookings/unassigned')
@login_required_page
@role_required(['superadmin', 'admin'])
def unassigned_bookings_page():
    return render_template('bookings/unassigned.html')


@pages_bp.route('/bookings/assigned')
@login_required_page
@role_required(['superadmin', 'admin'])
def assigned_bookings_page():
    return render_template('bookings/assigned.html')


@pages_bp.route('/bookings/completed')
@login_required_page
@role_required(['superadmin', 'admin'])
def completed_bookings_page():
    return render_template('bookings/completed.html')


@pages_bp.route('/bookings/cancelled')
@login_required_page
@role_required(['superadmin', 'admin'])
def cancelled_bookings_page():
    return render_template('bookings/cancelled.html')


@pages_bp.route('/bookings/all')
@login_required_page
@role_required(['superadmin', 'admin'])
def all_bookings_page():
    return render_template('bookings/all.html')


# ============================================
# LEGACY REDIRECTS
# ============================================

@pages_bp.route('/users')
@login_required_page
@role_required(['superadmin', 'admin'])
def legacy_users_redirect():

    role = session.get('role')

    if role == 'superadmin':
        return redirect(url_for('pages.users_admins_page'))

    return redirect(url_for('pages.users_customers_page'))


@pages_bp.route('/superadmin/users')
@login_required_page
@role_required(['superadmin'])
def superadmin_users_redirect():
    return redirect(url_for('pages.users_admins_page'))


@pages_bp.route('/admin/users')
@login_required_page
@role_required(['admin', 'superadmin'])
def admin_users_redirect():
    return redirect(url_for('pages.users_customers_page'))


# ============================================
# TRANSPORT UNIT REDIRECTS
# ============================================

@pages_bp.route('/superadmin/transport-units')
@login_required_page
@role_required(['superadmin'])
def superadmin_transport_units_redirect():
    return redirect(url_for('pages.transport_units_page'))


@pages_bp.route('/admin/transport-units')
@login_required_page
@role_required(['admin', 'superadmin'])
def admin_transport_units_redirect():
    return redirect(url_for('pages.transport_units_page'))