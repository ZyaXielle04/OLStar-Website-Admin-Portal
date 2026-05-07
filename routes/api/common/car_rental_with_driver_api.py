from flask import Blueprint, request, jsonify, session
from functools import wraps
from firebase_admin import db
from datetime import datetime

# Import decorators from self-drive file (or redefine them)
# For now, let's redefine them to avoid circular imports
def login_required_api(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

def role_required_api(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'role' not in session or session['role'] not in allowed_roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def log_activity(description, user_id, user_name):
    try:
        activities_ref = db.reference('activities')
        activities_ref.push({
            'description': description,
            'timestamp': datetime.now().isoformat(),
            'user_id': user_id,
            'user_name': user_name
        })
        print(f"Activity logged: {description}")
    except Exception as e:
        print(f"Error logging activity: {str(e)}")

# Create blueprint
car_rental_with_driver_api_bp = Blueprint('car_rental_with_driver', __name__, url_prefix='/common/car-rental/with-driver')

# ========== LOCATION MANAGEMENT (Metro Manila Locations) ==========

@car_rental_with_driver_api_bp.route('/locations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_locations():
    """Get all locations for Metro Manila with-driver"""
    try:
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        all_locations = locations_ref.get()
        
        if not all_locations:
            return jsonify({'locations': []})
        
        locations_list = []
        for loc_key, loc_data in all_locations.items():
            locations_list.append({
                'key': loc_key,
                'name': loc_data.get('name', loc_key),
                'isActive': loc_data.get('isActive', 'true') == 'true'
            })
        
        return jsonify({'locations': locations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def add_location():
    """Add a new Metro Manila location - Superadmin only"""
    try:
        data = request.json
        location_name = data.get('name', '').strip()
        
        if not location_name:
            return jsonify({'error': 'Location name is required'}), 400
        
        location_key = location_name.lower().replace(' ', '_')
        
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        
        existing = locations_ref.child(location_key).get()
        if existing:
            return jsonify({'error': f'Location "{location_name}" already exists'}), 400
        
        locations_ref.child(location_key).set({
            'name': location_name,
            'isActive': 'true'
        })
        
        log_activity(f"Added with-driver location: {location_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations/<location_key>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_location(location_key):
    """Update Metro Manila location details - Superadmin only"""
    try:
        data = request.json
        locations_ref = db.reference(f'rates/carRental/withDriver/locations/{location_key}')
        
        existing = locations_ref.get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        updates = {}
        if 'name' in data:
            updates['name'] = data['name']
        if 'isActive' in data:
            updates['isActive'] = 'true' if data['isActive'] else 'false'
        
        locations_ref.update(updates)
        
        log_activity(f"Updated with-driver location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Location updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations/<location_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_location(location_key):
    """Delete a Metro Manila location - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        locations_ref.child(location_key).delete()
        
        log_activity(f"Deleted with-driver location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_key}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations/<location_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
def toggle_location(location_key):
    """Toggle Metro Manila location active status - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        current_status = existing.get('isActive', 'true') == 'true'
        new_status = not current_status
        
        locations_ref.child(location_key).update({'isActive': 'true' if new_status else 'false'})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} with-driver location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Location has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== DURATION MANAGEMENT ==========

@car_rental_with_driver_api_bp.route('/durations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_durations():
    """Get all durations for with-driver Metro Manila"""
    try:
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        all_durations = durations_ref.get()
        
        if not all_durations:
            return jsonify({'durations': []})
        
        durations_list = []
        for hours_key, dur_data in all_durations.items():
            # Handle both boolean and string values
            is_active = dur_data.get('isActive', True)
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            durations_list.append({
                'key': hours_key,
                'hours': int(hours_key),
                'name': dur_data.get('name', f"{hours_key} Hours"),
                'isActive': is_active
            })
        
        durations_list.sort(key=lambda x: x['hours'])
        
        return jsonify({'durations': durations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/durations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def add_duration():
    """Add a new duration - Superadmin only"""
    try:
        data = request.json
        duration_name = data.get('name', '').strip()
        hours = str(data.get('hours', '0'))
        
        if not duration_name:
            return jsonify({'error': 'Duration name is required'}), 400
        if not hours or int(hours) <= 0:
            return jsonify({'error': 'Valid hours are required'}), 400
        
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        
        existing = durations_ref.child(hours).get()
        if existing:
            return jsonify({'error': f'Duration with {hours} hours already exists'}), 400
        
        durations_ref.child(hours).set({
            'name': duration_name,
            'isActive': True  # Use boolean
        })
        
        log_activity(f"Added with-driver duration: {duration_name} ({hours} hours)", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{duration_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/durations/<int:hours_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_duration(hours_key):
    """Delete a duration - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        
        existing = durations_ref.child(str(hours_key)).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        durations_ref.child(str(hours_key)).delete()
        
        log_activity(f"Deleted with-driver duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{hours_key} hours" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/durations/<int:hours_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
def toggle_duration(hours_key):
    """Toggle duration active status - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        
        existing = durations_ref.child(str(hours_key)).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        # Handle both boolean and string when reading
        current_status = existing.get('isActive', True)
        if isinstance(current_status, str):
            current_status = current_status.lower() == 'true'
        
        new_status = not current_status
        
        # Store as boolean
        durations_ref.child(str(hours_key)).update({'isActive': new_status})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} with-driver duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Duration has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== METRO MANILA RATES ==========

@car_rental_with_driver_api_bp.route('/metro-manila/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_metro_manila_rates():
    """Get all Metro Manila rates for with-driver"""
    try:
        rates_ref = db.reference('rates/carRental/withDriver/metroManila')
        all_rates = rates_ref.get() or {}
        return jsonify({'rates': all_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/metro-manila/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_metro_manila_rate():
    """
    Update Metro Manila rate for with-driver.
    Structure: rates/carRental/withDriver/metroManila/{rateType}/{vehicleType}/{duration}
    """
    try:
        data = request.json
        vehicle_type = data.get('vehicleType')
        rate_type = data.get('rateType')  # 'regular' or 'all_in'
        duration = str(data.get('duration'))
        price = data.get('price', '0')
        
        if not all([vehicle_type, rate_type, duration, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        rate_path = f'rates/carRental/withDriver/metroManila/{rate_type}/{vehicle_type}/{duration}'
        rate_ref = db.reference(rate_path)
        
        if str(price) == '0' or price == 0:
            rate_ref.delete()
            log_activity(f"Deleted Metro Manila rate for {vehicle_type}: {rate_type}/{duration}hrs", 
                        session.get('user_id'), session.get('display_name'))
            return jsonify({'message': 'Rate deleted successfully'}), 200
        
        rate_ref.set(str(price))
        
        log_activity(f"Updated Metro Manila rate for {vehicle_type}: {rate_type}/{duration}hrs = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== PROVINCIAL DESTINATIONS MANAGEMENT ==========

@car_rental_with_driver_api_bp.route('/provincial/destinations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_provincial_destinations():
    """Get all provincial destinations"""
    try:
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        all_destinations = destinations_ref.get() or {}
        
        destinations_list = []
        for dest_key, dest_data in all_destinations.items():
            # Handle both boolean and string values for isActive
            is_active = dest_data.get('isActive', True)
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            elif isinstance(is_active, bool):
                is_active = is_active
            else:
                is_active = True
            
            destinations_list.append({
                'key': dest_key,
                'name': dest_data.get('name', dest_key),
                'isActive': is_active  # Return as boolean
            })
        
        return jsonify({'destinations': destinations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/provincial/destinations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def add_provincial_destination():
    """Add a new provincial destination - Superadmin only"""
    try:
        data = request.json
        destination_name = data.get('name', '').strip()
        
        if not destination_name:
            return jsonify({'error': 'Destination name is required'}), 400
        
        destination_key = destination_name.lower().replace(' ', '_')
        
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        
        existing = destinations_ref.child(destination_key).get()
        if existing:
            return jsonify({'error': f'Destination "{destination_name}" already exists'}), 400
        
        destinations_ref.child(destination_key).set({
            'name': destination_name,
            'isActive': True  # Use boolean, not string
        })
        
        log_activity(f"Added provincial destination: {destination_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Destination "{destination_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_with_driver_api_bp.route('/provincial/destinations/<destination_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_provincial_destination(destination_key):
    """Delete a provincial destination - Superadmin only"""
    try:
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        
        existing = destinations_ref.child(destination_key).get()
        if not existing:
            return jsonify({'error': 'Destination not found'}), 404
        
        destinations_ref.child(destination_key).delete()
        
        log_activity(f"Deleted provincial destination: {destination_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Destination "{destination_key}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== PROVINCIAL RATES ==========

@car_rental_with_driver_api_bp.route('/provincial/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_provincial_rates():
    """Get all Provincial rates for with-driver"""
    try:
        rates_ref = db.reference('rates/carRental/withDriver/provincial')
        all_rates = rates_ref.get() or {}
        return jsonify({'rates': all_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/provincial/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_provincial_rate():
    """
    Update Provincial rate for with-driver.
    Structure: rates/carRental/withDriver/provincial/{packageType}/{vehicleType}/{destination}
    """
    try:
        data = request.json
        vehicle_type = data.get('vehicleType')
        package_type = data.get('packageType')  # 'one_way', 'roundtrip', 'tour'
        destination = data.get('destination')
        price = data.get('price', '0')
        
        if not all([vehicle_type, package_type, destination, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        rate_path = f'rates/carRental/withDriver/provincial/{package_type}/{vehicle_type}/{destination}'
        rate_ref = db.reference(rate_path)
        
        if str(price) == '0' or price == 0:
            rate_ref.delete()
            log_activity(f"Deleted Provincial rate for {vehicle_type}: {package_type}/{destination}", 
                        session.get('user_id'), session.get('display_name'))
            return jsonify({'message': 'Rate deleted successfully'}), 200
        
        rate_ref.set(str(price))
        
        log_activity(f"Updated Provincial rate for {vehicle_type}: {package_type}/{destination} = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== GET ALL RATES (Combined) ==========

@car_rental_with_driver_api_bp.route('/rates/all', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_all_rates():
    """Get all with-driver rates (both Metro Manila and Provincial)"""
    try:
        metro_manila_ref = db.reference('rates/carRental/withDriver/metroManila')
        provincial_ref = db.reference('rates/carRental/withDriver/provincial')
        
        metro_manila_rates = metro_manila_ref.get() or {}
        provincial_rates = provincial_ref.get() or {}
        
        return jsonify({
            'metroManila': metro_manila_rates,
            'provincial': provincial_rates
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== SEED DATABASE ==========

@car_rental_with_driver_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def seed_database():
    """Seed the database with sample data for with-driver"""
    try:
        # Sample Metro Manila locations - use booleans
        sample_locations = {
            "pasay": {"name": "Pasay", "isActive": True},
            "manila": {"name": "Manila", "isActive": True},
            "makati": {"name": "Makati", "isActive": True},
            "taguig": {"name": "Taguig", "isActive": True},
            "quezon_city": {"name": "Quezon City", "isActive": True}
        }
        
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        locations_ref.set(sample_locations)
        
        # Sample durations - use booleans
        sample_durations = {
            "2": {"name": "2 Hours", "isActive": True},
            "4": {"name": "4 Hours", "isActive": True},
            "6": {"name": "6 Hours", "isActive": True},
            "8": {"name": "8 Hours", "isActive": True},
            "12": {"name": "12 Hours", "isActive": True},
            "24": {"name": "24 Hours (1 Day)", "isActive": True}
        }
        
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        durations_ref.set(sample_durations)
        
        # Sample provincial destinations - use booleans
        sample_destinations = {
            "batangas": {"name": "Batangas", "isActive": True},
            "cavite": {"name": "Cavite", "isActive": True},
            "laguna": {"name": "Laguna", "isActive": True},
            "pampanga": {"name": "Pampanga", "isActive": True},
            "tagaytay": {"name": "Tagaytay", "isActive": True}
        }
        
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        destinations_ref.set(sample_destinations)
        
        log_activity("Seeded car rental with-driver database", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'With-driver database seeded successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@car_rental_with_driver_api_bp.route('/provincial/destinations/<destination_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
def toggle_provincial_destination(destination_key):
    """Toggle provincial destination active status - Superadmin only"""
    try:
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        
        existing = destinations_ref.child(destination_key).get()
        if not existing:
            return jsonify({'error': 'Destination not found'}), 404
        
        # Handle both boolean and string when reading
        current_status = existing.get('isActive', True)
        if isinstance(current_status, str):
            current_status = current_status.lower() == 'true'
        
        new_status = not current_status
        
        # Store as boolean
        destinations_ref.child(destination_key).update({'isActive': new_status})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} provincial destination: {destination_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Destination has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500