from flask import Blueprint, request, jsonify, session
from functools import wraps
from firebase_admin import db
from datetime import datetime

car_rental_api_bp = Blueprint('car_rental_api', __name__, url_prefix='/common/car-rental')

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

# ========== LOCATION MANAGEMENT ==========

@car_rental_api_bp.route('/locations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_locations():
    """Get all locations for car rental"""
    try:
        locations_ref = db.reference('rates/carRental/locations')
        all_locations = locations_ref.get()
        
        if not all_locations:
            return jsonify({'locations': []})
        
        locations_list = []
        for loc_key, loc_data in all_locations.items():
            locations_list.append({
                'key': loc_key,
                'name': loc_data.get('name', loc_key),
                'deliveryFeeFromPasay': loc_data.get('deliveryFeeFromPasay', '0'),
                'isActive': loc_data.get('isActive', 'true') == 'true'
            })
        
        return jsonify({'locations': locations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/locations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def add_location():
    """Add a new location - Superadmin only"""
    try:
        data = request.json
        location_name = data.get('name', '').strip()
        delivery_fee_from_pasay = str(data.get('deliveryFeeFromPasay', '0'))
        
        if not location_name:
            return jsonify({'error': 'Location name is required'}), 400
        
        location_key = location_name.lower().replace(' ', '_')
        
        locations_ref = db.reference('rates/carRental/locations')
        
        existing = locations_ref.child(location_key).get()
        if existing:
            return jsonify({'error': f'Location "{location_name}" already exists'}), 400
        
        locations_ref.child(location_key).set({
            'name': location_name,
            'deliveryFeeFromPasay': delivery_fee_from_pasay,
            'isActive': 'true'
        })
        
        log_activity(f"Added car rental location: {location_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/locations/<location_key>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_location(location_key):
    """Update location details - Superadmin only"""
    try:
        data = request.json
        locations_ref = db.reference(f'rates/carRental/locations/{location_key}')
        
        existing = locations_ref.get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        updates = {}
        if 'name' in data:
            updates['name'] = data['name']
        if 'deliveryFeeFromPasay' in data:
            updates['deliveryFeeFromPasay'] = str(data['deliveryFeeFromPasay'])
        if 'isActive' in data:
            updates['isActive'] = 'true' if data['isActive'] else 'false'
        
        locations_ref.update(updates)
        
        log_activity(f"Updated location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Location updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/locations/<location_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_location(location_key):
    """Delete a location - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        locations_ref.child(location_key).delete()
        
        log_activity(f"Deleted car rental location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_key}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/locations/<location_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
def toggle_location(location_key):
    """Toggle location active status - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        current_status = existing.get('isActive', 'true') == 'true'
        new_status = not current_status
        
        locations_ref.child(location_key).update({'isActive': 'true' if new_status else 'false'})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} car rental location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Location has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== TRANSPORT UNITS ==========

@car_rental_api_bp.route('/transport-units', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_transport_units():
    """Get all transport units"""
    try:
        transport_ref = db.reference('transportUnits')
        all_units = transport_ref.get() or {}
        
        units_list = []
        for unit_id, unit_data in all_units.items():
            units_list.append({
                'id': unit_id,
                'name': unit_data.get('transportUnit', ''),
                'unitType': unit_data.get('unitType', ''),
                'plateNumber': unit_data.get('plateNumber', ''),
                'color': unit_data.get('color', ''),
                'isAvailable': unit_data.get('isAvailable', 'true') == 'true'
            })
        
        return jsonify({'transportUnits': units_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== DURATION MANAGEMENT ==========

@car_rental_api_bp.route('/durations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_durations():
    """Get all durations for car rental"""
    try:
        durations_ref = db.reference('rates/carRental/durations')
        all_durations = durations_ref.get()
        
        if not all_durations:
            return jsonify({'durations': []})
        
        durations_list = []
        for dur_key, dur_data in all_durations.items():
            durations_list.append({
                'key': dur_key,
                'name': dur_data.get('name', dur_key),
                'hours': int(dur_data.get('hours', '0')),
                'isActive': dur_data.get('isActive', 'true') == 'true'
            })
        
        return jsonify({'durations': durations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/durations', methods=['POST'])
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
        
        duration_key = duration_name.lower().replace(' ', '_')
        
        durations_ref = db.reference('rates/carRental/durations')
        
        existing = durations_ref.child(duration_key).get()
        if existing:
            return jsonify({'error': f'Duration "{duration_name}" already exists'}), 400
        
        durations_ref.child(duration_key).set({
            'name': duration_name,
            'hours': hours,
            'isActive': 'true'
        })
        
        log_activity(f"Added car rental duration: {duration_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{duration_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/durations/<duration_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_duration(duration_key):
    """Delete a duration - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/durations')
        
        existing = durations_ref.child(duration_key).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        durations_ref.child(duration_key).delete()
        
        log_activity(f"Deleted car rental duration: {duration_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{duration_key}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/durations/<duration_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
def toggle_duration(duration_key):
    """Toggle duration active status - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/durations')
        
        existing = durations_ref.child(duration_key).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        current_status = existing.get('isActive', 'true') == 'true'
        new_status = not current_status
        
        durations_ref.child(duration_key).update({'isActive': 'true' if new_status else 'false'})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} car rental duration: {duration_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Duration has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== RATE MANAGEMENT (PER TRANSPORT UNIT PER LOCATION) ==========

@car_rental_api_bp.route('/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_rates():
    """Get all rates for transport units"""
    try:
        rates_ref = db.reference('rates/carRental/transportUnitRates')
        all_rates = rates_ref.get() or {}
        
        return jsonify({'rates': all_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@car_rental_api_bp.route('/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_rate():
    """Update rate for a specific transport unit at a specific location"""
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        location = data.get('location')  # location key
        duration = data.get('duration')
        price = str(data.get('price', '0'))
        
        if not all([transport_unit_id, location, duration, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        rate_path = f'rates/carRental/transportUnitRates/{transport_unit_id}/{location}/{duration}'
        rate_ref = db.reference(rate_path)
        rate_ref.set(price)
        
        log_activity(f"Updated rate for unit {transport_unit_id} at {location}: {duration} = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== GET FULL TABLE DATA ==========

@car_rental_api_bp.route('/table-data', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_table_data():
    """Get complete data for rates table"""
    try:
        # Get transport units
        transport_ref = db.reference('transportUnits')
        all_units = transport_ref.get() or {}
        
        transport_units = []
        for unit_id, unit_data in all_units.items():
            transport_units.append({
                'id': unit_id,
                'name': unit_data.get('transportUnit', ''),
                'unitType': unit_data.get('unitType', ''),
                'plateNumber': unit_data.get('plateNumber', ''),
                'color': unit_data.get('color', ''),
                'isAvailable': unit_data.get('isAvailable', 'true') == 'true'
            })
        
        # Get durations
        durations_ref = db.reference('rates/carRental/durations')
        all_durations = durations_ref.get() or {}
        
        durations = []
        for dur_key, dur_data in all_durations.items():
            if dur_data.get('isActive', 'true') == 'true':
                durations.append({
                    'key': dur_key,
                    'name': dur_data.get('name', dur_key),
                    'hours': int(dur_data.get('hours', '0'))
                })
        
        # Get rates
        rates_ref = db.reference('rates/carRental/transportUnitRates')
        all_rates = rates_ref.get() or {}
        
        # Get locations
        locations_ref = db.reference('rates/carRental/locations')
        all_locations = locations_ref.get() or {}
        
        locations = []
        for loc_key, loc_data in all_locations.items():
            if loc_data.get('isActive', 'true') == 'true':
                locations.append({
                    'key': loc_key,
                    'name': loc_data.get('name', loc_key),
                    'deliveryFeeFromPasay': int(loc_data.get('deliveryFeeFromPasay', '0'))
                })
        
        return jsonify({
            'transportUnits': transport_units,
            'durations': durations,
            'rates': all_rates,
            'locations': locations
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== SEED DATABASE ==========

@car_rental_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def seed_database():
    """Seed the database with sample data"""
    try:
        # Sample locations with delivery fees from Pasay (all values as strings)
        sample_locations = {
            "pasay": {"name": "Pasay", "deliveryFeeFromPasay": "0", "isActive": "true"},
            "manila": {"name": "Manila", "deliveryFeeFromPasay": "500", "isActive": "true"},
            "makati": {"name": "Makati", "deliveryFeeFromPasay": "400", "isActive": "true"},
            "taguig": {"name": "Taguig", "deliveryFeeFromPasay": "600", "isActive": "true"},
            "quezon_city": {"name": "Quezon City", "deliveryFeeFromPasay": "800", "isActive": "true"},
            "paranaque": {"name": "Parañaque", "deliveryFeeFromPasay": "300", "isActive": "true"},
            "las_pinas": {"name": "Las Piñas", "deliveryFeeFromPasay": "500", "isActive": "true"},
            "muntinlupa": {"name": "Muntinlupa", "deliveryFeeFromPasay": "700", "isActive": "true"}
        }
        
        locations_ref = db.reference('rates/carRental/locations')
        locations_ref.set(sample_locations)
        
        # Sample durations (all values as strings)
        sample_durations = {
            "2_hours": {"name": "2 Hours", "hours": "2", "isActive": "true"},
            "4_hours": {"name": "4 Hours", "hours": "4", "isActive": "true"},
            "6_hours": {"name": "6 Hours", "hours": "6", "isActive": "true"},
            "8_hours": {"name": "8 Hours", "hours": "8", "isActive": "true"},
            "12_hours": {"name": "12 Hours", "hours": "12", "isActive": "true"},
            "24_hours": {"name": "24 Hours", "hours": "24", "isActive": "true"}
        }
        
        durations_ref = db.reference('rates/carRental/durations')
        durations_ref.set(sample_durations)
        
        log_activity("Seeded car rental database", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Database seeded successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500