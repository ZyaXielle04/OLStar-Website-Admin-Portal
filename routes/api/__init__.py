from flask import Blueprint

# ============================================
# MAIN API BLUEPRINT (ROOT)
# ============================================
api_bp = Blueprint("api", __name__, url_prefix="/api")

# ============================================
# IMPORT SUB-BLUEPRINTS
# ============================================
from .common.dashboard_api import common_dashboard_api_bp
from .common.users import users_bp
from .common.transport_units_api import common_transport_units_api_bp
from .common.packages_api import common_packages_api_bp
from .common.airport_transfer_api import airport_transfer_api_bp
from .common.metro_manila_transfer_api import metro_manila_transfer_api_bp
from .common.car_rental_self_drive_api import car_rental_self_drive_api_bp
from .common.car_rental_with_driver_api import car_rental_with_driver_api_bp
from .common.bookings.airport_transfer import airport_transfer_bp
from .common.bookings.self_drive import self_drive_bp
from .common.bookings.with_driver_metro import with_driver_metro_bp
from .common.bookings.provincial_car_rental import provincial_car_rental_bp

from .admin.dashboard_api import admin_dashboard_api_bp
from .superadmin.dashboard_api import superadmin_dashboard_api_bp

# ============================================
# REGISTER COMMON APIs
# ============================================
api_bp.register_blueprint(common_dashboard_api_bp)
api_bp.register_blueprint(users_bp)
api_bp.register_blueprint(common_transport_units_api_bp)
api_bp.register_blueprint(common_packages_api_bp)
api_bp.register_blueprint(airport_transfer_api_bp)
api_bp.register_blueprint(metro_manila_transfer_api_bp)
api_bp.register_blueprint(car_rental_self_drive_api_bp)
api_bp.register_blueprint(car_rental_with_driver_api_bp)
api_bp.register_blueprint(airport_transfer_bp)
api_bp.register_blueprint(self_drive_bp)
api_bp.register_blueprint(with_driver_metro_bp)
api_bp.register_blueprint(provincial_car_rental_bp)  # ← Provincial Car Rental Blueprint

# ============================================
# REGISTER DASHBOARD APIs
# ============================================
api_bp.register_blueprint(admin_dashboard_api_bp)
api_bp.register_blueprint(superadmin_dashboard_api_bp)
