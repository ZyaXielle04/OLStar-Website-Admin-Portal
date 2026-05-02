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
    """Get all durations for car rental - using numeric keys (hours)"""
    try:
        durations_ref = db.reference('rates/carRental/durations')
        all_durations = durations_ref.get()
        
        if not all_durations:
            return jsonify({'durations': []})
        
        durations_list = []
        for hours_key, dur_data in all_durations.items():
            durations_list.append({
                'key': hours_key,
                'hours': int(hours_key),
                'name': dur_data.get('name', f"{hours_key} Hours"),
                'isActive': dur_data.get('isActive', 'true') == 'true'
            })
        
        durations_list.sort(key=lambda x: x['hours'])
        
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
        
        durations_ref = db.reference('rates/carRental/durations')
        
        existing = durations_ref.child(hours).get()
        if existing:
            return jsonify({'error': f'Duration with {hours} hours already exists'}), 400
        
        durations_ref.child(hours).set({
            'name': duration_name,
            'isActive': 'true'
        })
        
        log_activity(f"Added car rental duration: {duration_name} ({hours} hours)", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{duration_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_api_bp.route('/durations/<int:hours_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_duration(hours_key):
    """Delete a duration - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/durations')
        
        existing = durations_ref.child(str(hours_key)).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        durations_ref.child(str(hours_key)).delete()
        
        log_activity(f"Deleted car rental duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{hours_key} hours" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_api_bp.route('/durations/<int:hours_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
def toggle_duration(hours_key):
    """Toggle duration active status - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/durations')
        
        existing = durations_ref.child(str(hours_key)).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        current_status = existing.get('isActive', 'true') == 'true'
        new_status = not current_status
        
        durations_ref.child(str(hours_key)).update({'isActive': 'true' if new_status else 'false'})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} car rental duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Duration has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== SELF-DRIVE RATE MANAGEMENT ==========

@car_rental_api_bp.route('/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_rates():
    """Get all rates for self-drive transport units"""
    try:
        rates_ref = db.reference('rates/carRental/transportUnitRates/selfDrive')
        all_rates = rates_ref.get() or {}
        
        return jsonify({'rates': all_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_api_bp.route('/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_rate():
    """
    Update rate for a specific transport unit under self-drive.
    If price is 0 or "0", the node will be deleted.
    
    Expected JSON:
    {
        "transportUnitId": "BQM911",
        "rateType": "same_location",
        "locationKey": "manila",
        "duration": "2",
        "price": "500"
    }
    """
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        rate_type = data.get('rateType')  # 'same_location' or 'different_location'
        location_key = data.get('locationKey')
        duration = str(data.get('duration'))
        price = data.get('price', '0')
        
        if not all([transport_unit_id, rate_type, location_key, duration, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        rate_path = f'rates/carRental/transportUnitRates/selfDrive/{transport_unit_id}/{rate_type}/{location_key}/{duration}'
        rate_ref = db.reference(rate_path)
        
        # Check if price is 0 - delete the node
        if str(price) == '0' or price == 0:
            rate_ref.delete()
            log_activity(f"Deleted self-drive rate for unit {transport_unit_id}: {rate_type}/{location_key}/{duration}hrs (price set to 0)", 
                        session.get('user_id'), session.get('display_name'))
            return jsonify({'message': 'Rate deleted successfully (price set to 0)'}), 200
        
        # Otherwise save the price as string
        rate_ref.set(str(price))
        
        log_activity(f"Updated self-drive rate for unit {transport_unit_id}: {rate_type}/{location_key}/{duration}hrs = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== WITH DRIVER RATE MANAGEMENT ==========

@car_rental_api_bp.route('/with-driver/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_with_driver_rates():
    """
    Get all rates for with-driver transport units.
    Structure includes rateType (regular/all_in) as an additional level.
    """
    try:
        rates_ref = db.reference('rates/carRental/transportUnitRates/withDriver')
        all_rates = rates_ref.get() or {}
        
        return jsonify({'rates': all_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_api_bp.route('/with-driver/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_with_driver_rate():
    """
    Update rate for a specific transport unit under with-driver.
    If price is 0 or "0", the node will be deleted.
    
    Expected JSON:
    {
        "transportUnitId": "BQM911",
        "rateType": "regular",           # 'regular' or 'all_in'
        "locationType": "same_location", # 'same_location' or 'different_location'
        "locationKey": "manila",         # or 'manila_to_makati' for different location
        "duration": "2",
        "price": "500"
    }
    """
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        rate_type = data.get('rateType')          # 'regular' or 'all_in'
        location_type = data.get('locationType')   # 'same_location' or 'different_location'
        location_key = data.get('locationKey')     # 'manila' or 'manila_to_makati'
        duration = str(data.get('duration'))
        price = data.get('price', '0')
        
        if not all([transport_unit_id, rate_type, location_type, location_key, duration, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        rate_path = f'rates/carRental/transportUnitRates/withDriver/{transport_unit_id}/{rate_type}/{location_type}/{location_key}/{duration}'
        rate_ref = db.reference(rate_path)
        
        # Check if price is 0 - delete the node
        if str(price) == '0' or price == 0:
            rate_ref.delete()
            log_activity(f"Deleted with-driver rate for unit {transport_unit_id}: {rate_type}/{location_type}/{location_key}/{duration}hrs (price set to 0)", 
                        session.get('user_id'), session.get('display_name'))
            return jsonify({'message': 'Rate deleted successfully (price set to 0)'}), 200
        
        rate_ref.set(str(price))
        
        log_activity(f"Updated with-driver rate for unit {transport_unit_id}: {rate_type}/{location_type}/{location_key}/{duration}hrs = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_api_bp.route('/with-driver/rates/bulk', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_bulk_with_driver_rates():
    """
    Update multiple with-driver rates at once for a transport unit.
    """
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        rate_type = data.get('rateType')
        rates_data = data.get('rates', {})
        
        if not transport_unit_id or not rate_type:
            return jsonify({'error': 'Transport unit ID and rate type are required'}), 400
        
        base_path = f'rates/carRental/transportUnitRates/withDriver/{transport_unit_id}/{rate_type}'
        rates_ref = db.reference(base_path)
        
        formatted_rates = {}
        if 'same_location' in rates_data:
            formatted_rates['same_location'] = {}
            for loc, durations in rates_data['same_location'].items():
                formatted_rates['same_location'][loc] = {}
                for dur, price in durations.items():
                    if str(price) != '0' and price != 0:
                        formatted_rates['same_location'][loc][dur] = str(price)
        
        if 'different_location' in rates_data:
            formatted_rates['different_location'] = {}
            for pair, durations in rates_data['different_location'].items():
                formatted_rates['different_location'][pair] = {}
                for dur, price in durations.items():
                    if str(price) != '0' and price != 0:
                        formatted_rates['different_location'][pair][dur] = str(price)
        
        rates_ref.set(formatted_rates)
        
        log_activity(f"Bulk updated with-driver {rate_type} rates for unit {transport_unit_id}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Bulk rates updated successfully'}), 200
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
            is_available = unit_data.get('isAvailable', 'true')
            if isinstance(is_available, str):
                is_available = is_available.lower() == 'true'
            
            transport_units.append({
                'id': unit_id,
                'name': unit_data.get('transportUnit', ''),
                'unitType': unit_data.get('unitType', ''),
                'plateNumber': unit_data.get('plateNumber', ''),
                'color': unit_data.get('color', ''),
                'isAvailable': is_available
            })
        
        # Get durations
        durations_ref = db.reference('rates/carRental/durations')
        all_durations = durations_ref.get() or {}
        
        durations = []
        for hours_key, dur_data in all_durations.items():
            is_active = dur_data.get('isActive', 'true')
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            if is_active:
                durations.append({
                    'key': hours_key,
                    'hours': int(hours_key),
                    'name': dur_data.get('name', f"{hours_key} Hours"),
                    'isActive': is_active
                })
        
        durations.sort(key=lambda x: x['hours'])
        
        # Get self-drive rates
        self_drive_rates_ref = db.reference('rates/carRental/transportUnitRates/selfDrive')
        self_drive_rates = self_drive_rates_ref.get() or {}
        
        # Get with-driver rates
        with_driver_rates_ref = db.reference('rates/carRental/transportUnitRates/withDriver')
        with_driver_rates = with_driver_rates_ref.get() or {}
        
        # Get locations
        locations_ref = db.reference('rates/carRental/locations')
        all_locations = locations_ref.get() or {}
        
        locations = []
        for loc_key, loc_data in all_locations.items():
            is_active = loc_data.get('isActive', 'true')
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            if is_active:
                locations.append({
                    'key': loc_key,
                    'name': loc_data.get('name', loc_key),
                    'deliveryFeeFromPasay': int(loc_data.get('deliveryFeeFromPasay', '0'))
                })
        
        # Generate location pairs
        location_pairs = []
        for pickup in locations:
            for dropoff in locations:
                if pickup['key'] != dropoff['key']:
                    location_pairs.append({
                        'key': f"{pickup['key']}_to_{dropoff['key']}",
                        'pickup': pickup['name'],
                        'dropoff': dropoff['name'],
                        'pickupKey': pickup['key'],
                        'dropoffKey': dropoff['key']
                    })
        
        return jsonify({
            'transportUnits': transport_units,
            'durations': durations,
            'rates': self_drive_rates,  # <- FIXED: Use 'rates' key for self-drive (matches frontend)
            'withDriverRates': with_driver_rates,
            'locations': locations,
            'locationPairs': location_pairs
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== PRICE CALCULATION HELPER ==========

@car_rental_api_bp.route('/calculate-price', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def calculate_price():
    """Calculate the total rental price for either self-drive or with-driver"""
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        pickup_location = data.get('pickupLocation')
        dropoff_location = data.get('dropoffLocation')
        hours = str(data.get('hours'))
        rental_type = data.get('rentalType', 'selfDrive')
        rate_type = data.get('rateType', 'regular')
        
        if not all([transport_unit_id, pickup_location, dropoff_location, hours]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        is_different_location = pickup_location != dropoff_location
        location_type = 'different_location' if is_different_location else 'same_location'
        location_key = f"{pickup_location}_to_{dropoff_location}" if is_different_location else pickup_location
        
        if rental_type == 'selfDrive':
            rate_path = f'rates/carRental/transportUnitRates/selfDrive/{transport_unit_id}/{location_type}/{location_key}/{hours}'
            rate_ref = db.reference(rate_path)
            rate_str = rate_ref.get()
            rate = int(rate_str) if rate_str else 0
        else:
            rate_path = f'rates/carRental/transportUnitRates/withDriver/{transport_unit_id}/{rate_type}/{location_type}/{location_key}/{hours}'
            rate_ref = db.reference(rate_path)
            rate_str = rate_ref.get()
            rate = int(rate_str) if rate_str else 0
        
        delivery_fee_path = f'rates/carRental/locations/{pickup_location}/deliveryFeeFromPasay'
        delivery_fee_ref = db.reference(delivery_fee_path)
        delivery_fee_str = delivery_fee_ref.get()
        delivery_fee = int(delivery_fee_str) if delivery_fee_str else 0
        
        total = rate + delivery_fee
        
        return jsonify({
            'transportUnitId': transport_unit_id,
            'pickupLocation': pickup_location,
            'dropoffLocation': dropoff_location,
            'hours': int(hours),
            'rentalType': rental_type,
            'rateType': rate_type if rental_type == 'withDriver' else None,
            'baseRate': rate,
            'deliveryFee': delivery_fee,
            'locationType': location_type,
            'totalPrice': total
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== SEED DATABASE ==========

@car_rental_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def seed_database():
    """Seed the database with sample data for both self-drive and with-driver"""
    try:
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
        
        sample_durations = {
            "2": {"name": "2 Hours", "isActive": "true"},
            "4": {"name": "4 Hours", "isActive": "true"},
            "6": {"name": "6 Hours", "isActive": "true"},
            "8": {"name": "8 Hours", "isActive": "true"},
            "12": {"name": "12 Hours", "isActive": "true"},
            "24": {"name": "24 Hours (1 Day)", "isActive": "true"},
            "48": {"name": "48 Hours (2 Days)", "isActive": "true"},
            "72": {"name": "72 Hours (3 Days)", "isActive": "true"}
        }
        
        durations_ref = db.reference('rates/carRental/durations')
        durations_ref.set(sample_durations)
        
        sample_self_drive_rates = {
            "BQM911": {
                "same_location": {
                    "manila": {
                        "2": "500",
                        "4": "800",
                        "6": "1000",
                        "8": "1200",
                        "12": "1500",
                        "24": "2000",
                        "48": "3500",
                        "72": "5000"
                    },
                    "makati": {
                        "2": "450",
                        "4": "750",
                        "6": "950",
                        "8": "1150",
                        "12": "1450",
                        "24": "1900",
                        "48": "3300",
                        "72": "4700"
                    },
                    "pasay": {
                        "2": "400",
                        "4": "700",
                        "6": "900",
                        "8": "1100",
                        "12": "1400",
                        "24": "1800",
                        "48": "3100",
                        "72": "4400"
                    }
                },
                "different_location": {
                    "manila_to_makati": {
                        "2": "900",
                        "4": "1500",
                        "6": "1800",
                        "8": "2200",
                        "12": "2800",
                        "24": "3800",
                        "48": "6600",
                        "72": "9400"
                    },
                    "manila_to_pasay": {
                        "2": "850",
                        "4": "1400",
                        "6": "1700",
                        "8": "2100",
                        "12": "2700",
                        "24": "3600",
                        "48": "6200",
                        "72": "8800"
                    },
                    "makati_to_manila": {
                        "2": "900",
                        "4": "1500",
                        "6": "1800",
                        "8": "2200",
                        "12": "2800",
                        "24": "3800",
                        "48": "6600",
                        "72": "9400"
                    },
                    "makati_to_pasay": {
                        "2": "800",
                        "4": "1300",
                        "6": "1600",
                        "8": "2000",
                        "12": "2600",
                        "24": "3500",
                        "48": "6000",
                        "72": "8500"
                    }
                }
            }
        }
        
        self_drive_rates_ref = db.reference('rates/carRental/transportUnitRates/selfDrive')
        self_drive_rates_ref.set(sample_self_drive_rates)
        
        sample_with_driver_rates = {
            "BQM911": {
                "regular": {
                    "same_location": {
                        "manila": {
                            "2": "800",
                            "4": "1200",
                            "6": "1500",
                            "8": "1800",
                            "12": "2200",
                            "24": "3000",
                            "48": "5200",
                            "72": "7500"
                        },
                        "makati": {
                            "2": "750",
                            "4": "1150",
                            "6": "1450",
                            "8": "1750",
                            "12": "2150",
                            "24": "2900",
                            "48": "5000",
                            "72": "7200"
                        },
                        "pasay": {
                            "2": "700",
                            "4": "1100",
                            "6": "1400",
                            "8": "1700",
                            "12": "2100",
                            "24": "2800",
                            "48": "4800",
                            "72": "6900"
                        }
                    },
                    "different_location": {
                        "manila_to_makati": {
                            "2": "1400",
                            "4": "2200",
                            "6": "2700",
                            "8": "3300",
                            "12": "4200",
                            "24": "5700",
                            "48": "9900",
                            "72": "14100"
                        },
                        "manila_to_pasay": {
                            "2": "1300",
                            "4": "2100",
                            "6": "2600",
                            "8": "3200",
                            "12": "4100",
                            "24": "5400",
                            "48": "9300",
                            "72": "13200"
                        }
                    }
                },
                "all_in": {
                    "same_location": {
                        "manila": {
                            "2": "1000",
                            "4": "1500",
                            "6": "1900",
                            "8": "2300",
                            "12": "2800",
                            "24": "3800",
                            "48": "6500",
                            "72": "9400"
                        },
                        "makati": {
                            "2": "950",
                            "4": "1450",
                            "6": "1850",
                            "8": "2250",
                            "12": "2750",
                            "24": "3700",
                            "48": "6300",
                            "72": "9000"
                        },
                        "pasay": {
                            "2": "900",
                            "4": "1400",
                            "6": "1800",
                            "8": "2200",
                            "12": "2700",
                            "24": "3600",
                            "48": "6100",
                            "72": "8700"
                        }
                    },
                    "different_location": {
                        "manila_to_makati": {
                            "2": "1800",
                            "4": "2800",
                            "6": "3400",
                            "8": "4200",
                            "12": "5300",
                            "24": "7200",
                            "48": "12400",
                            "72": "17700"
                        },
                        "manila_to_pasay": {
                            "2": "1700",
                            "4": "2700",
                            "6": "3300",
                            "8": "4100",
                            "12": "5200",
                            "24": "6900",
                            "48": "11700",
                            "72": "16600"
                        }
                    }
                }
            }
        }
        
        with_driver_rates_ref = db.reference('rates/carRental/transportUnitRates/withDriver')
        with_driver_rates_ref.set(sample_with_driver_rates)
        
        log_activity("Seeded car rental database with both self-drive and with-driver rates", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Database seeded successfully with self-drive and with-driver rates'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500