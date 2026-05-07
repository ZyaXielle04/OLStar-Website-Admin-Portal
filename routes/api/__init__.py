from flask import Blueprint, app
from .common.dashboard_api import common_dashboard_api_bp
from .common.users_api import common_users_api_bp
from .common.transport_units_api import common_transport_units_api_bp
from .admin.dashboard_api import admin_dashboard_api_bp
from .superadmin.dashboard_api import superadmin_dashboard_api_bp
from .common.packages_api import common_packages_api_bp
from .common.airport_transfer_api import airport_transfer_api_bp
from .common.metro_manila_transfer_api import metro_manila_transfer_api_bp
from .common.car_rental_self_drive_api import car_rental_self_drive_api_bp
from .common.car_rental_with_driver_api import car_rental_with_driver_api_bp

# Create main API blueprint
api_bp = Blueprint('api', __name__, url_prefix='/api')

# Register common APIs (used by both roles)
api_bp.register_blueprint(common_dashboard_api_bp)
api_bp.register_blueprint(common_users_api_bp)
api_bp.register_blueprint(common_transport_units_api_bp)
api_bp.register_blueprint(common_packages_api_bp)
api_bp.register_blueprint(airport_transfer_api_bp)
api_bp.register_blueprint(metro_manila_transfer_api_bp)
api_bp.register_blueprint(car_rental_self_drive_api_bp)
api_bp.register_blueprint(car_rental_with_driver_api_bp)

# Register admin-only APIs
api_bp.register_blueprint(admin_dashboard_api_bp)

# Register superadmin-only APIs
api_bp.register_blueprint(superadmin_dashboard_api_bp)