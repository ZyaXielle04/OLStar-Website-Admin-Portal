from flask import Blueprint, request, jsonify, session
from firebase_admin import db
from datetime import datetime
from backend.decorators import login_required_api, role_required_api, no_rate_limit

car_rental_self_drive_api_bp = Blueprint('car_rental_self_drive', __name__, url_prefix='/common/car-rental')

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

@car_rental_self_drive_api_bp.route('/locations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_locations():
    """Get all locations for car rental self-drive"""
    try:
        locations_ref = db.reference('rates/carRental/selfDrive/locations')
        all_locations = locations_ref.get()
        
        if not all_locations:
            return jsonify({'locations': []})
        
        locations_list = []
        for loc_key, loc_data in all_locations.items():
            # Handle both boolean and string for backward compatibility
            is_active = loc_data.get('isActive', True)
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            locations_list.append({
                'key': loc_key,
                'name': loc_data.get('name', loc_key),
                'deliveryFeeFromPasay': loc_data.get('deliveryFeeFromPasay', '0'),
                'isActive': is_active  # Return as boolean
            })
        
        return jsonify({'locations': locations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/locations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def add_location():
    """Add a new location - Superadmin only"""
    try:
        data = request.json
        location_name = data.get('name', '').strip()
        delivery_fee_from_pasay = str(data.get('deliveryFeeFromPasay', '0'))
        
        if not location_name:
            return jsonify({'error': 'Location name is required'}), 400
        
        location_key = location_name.lower().replace(' ', '_')
        
        locations_ref = db.reference('rates/carRental/selfDrive/locations')
        
        existing = locations_ref.child(location_key).get()
        if existing:
            return jsonify({'error': f'Location "{location_name}" already exists'}), 400
        
        locations_ref.child(location_key).set({
            'name': location_name,
            'deliveryFeeFromPasay': delivery_fee_from_pasay,
            'isActive': True  # Use boolean, not string
        })
        
        log_activity(f"Added car rental self-drive location: {location_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/locations/<location_key>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def update_location(location_key):
    """Update location details - Superadmin only"""
    try:
        data = request.json
        locations_ref = db.reference(f'rates/carRental/selfDrive/locations/{location_key}')
        
        existing = locations_ref.get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        updates = {}
        if 'name' in data:
            updates['name'] = data['name']
        if 'deliveryFeeFromPasay' in data:
            updates['deliveryFeeFromPasay'] = str(data['deliveryFeeFromPasay'])
        if 'isActive' in data:
            updates['isActive'] = data['isActive']  # Keep as boolean
        
        locations_ref.update(updates)
        
        log_activity(f"Updated self-drive location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Location updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/locations/<location_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_location(location_key):
    """Delete a location - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/selfDrive/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        locations_ref.child(location_key).delete()
        
        log_activity(f"Deleted self-drive location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_key}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/locations/<location_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def toggle_location(location_key):
    """Toggle location active status - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/selfDrive/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        # Handle both boolean and string when reading
        current_status = existing.get('isActive', True)
        if isinstance(current_status, str):
            current_status = current_status.lower() == 'true'
        
        new_status = not current_status
        
        # Store as boolean
        locations_ref.child(location_key).update({'isActive': new_status})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} self-drive location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Location has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== TRANSPORT UNITS ==========

@car_rental_self_drive_api_bp.route('/transport-units', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_transport_units():
    """Get all transport units and extract unit types"""
    try:
        transport_ref = db.reference('transportUnits')
        all_units = transport_ref.get() or {}
        
        units_list = []
        unit_types_set = set()
        
        for unit_id, unit_data in all_units.items():
            unit_type = unit_data.get('unitType', '')
            if unit_type:
                unit_types_set.add(unit_type)
            
            # Handle isAvailable as boolean
            is_available = unit_data.get('isAvailable', True)
            if isinstance(is_available, str):
                is_available = is_available.lower() == 'true'
            
            units_list.append({
                'id': unit_id,
                'name': unit_data.get('transportUnit', ''),
                'unitType': unit_type,
                'plateNumber': unit_data.get('plateNumber', ''),
                'color': unit_data.get('color', ''),
                'isAvailable': is_available
            })
        
        return jsonify({
            'transportUnits': units_list,
            'unitTypes': sorted(list(unit_types_set))
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== DURATION MANAGEMENT ==========

@car_rental_self_drive_api_bp.route('/durations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_durations():
    """Get all durations for car rental self-drive - using numeric keys (hours)"""
    try:
        durations_ref = db.reference('rates/carRental/selfDrive/durations')
        all_durations = durations_ref.get()
        
        if not all_durations:
            return jsonify({'durations': []})
        
        durations_list = []
        for hours_key, dur_data in all_durations.items():
            # Handle both boolean and string
            is_active = dur_data.get('isActive', True)
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            durations_list.append({
                'key': hours_key,
                'hours': int(hours_key),
                'name': dur_data.get('name', f"{hours_key} Hours"),
                'isActive': is_active  # Return as boolean
            })
        
        durations_list.sort(key=lambda x: x['hours'])
        
        return jsonify({'durations': durations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/durations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
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
        
        durations_ref = db.reference('rates/carRental/selfDrive/durations')
        
        existing = durations_ref.child(hours).get()
        if existing:
            return jsonify({'error': f'Duration with {hours} hours already exists'}), 400
        
        durations_ref.child(hours).set({
            'name': duration_name,
            'isActive': True  # Use boolean
        })
        
        log_activity(f"Added car rental self-drive duration: {duration_name} ({hours} hours)", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{duration_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/durations/<int:hours_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_duration(hours_key):
    """Delete a duration - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/selfDrive/durations')
        
        existing = durations_ref.child(str(hours_key)).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        durations_ref.child(str(hours_key)).delete()
        
        log_activity(f"Deleted self-drive duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{hours_key} hours" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/durations/<int:hours_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def toggle_duration(hours_key):
    """Toggle duration active status - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/selfDrive/durations')
        
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
        log_activity(f"{status_text.capitalize()} self-drive duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Duration has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== SELF-DRIVE RATE MANAGEMENT (Per Transport Unit) ==========

@car_rental_self_drive_api_bp.route('/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_rates():
    """Get all rates for self-drive transport units"""
    try:
        rates_ref = db.reference('rates/carRental/selfDrive/transportUnitRates')
        all_rates = rates_ref.get() or {}
        
        return jsonify({'rates': all_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def update_rate():
    """
    Update rate for a specific transport unit under self-drive.
    If price is 0 or "0", the node will be deleted.
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
        
        rate_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/{rate_type}/{location_key}/{duration}'
        rate_ref = db.reference(rate_path)
        
        if str(price) == '0' or price == 0:
            rate_ref.delete()
            log_activity(f"Deleted self-drive rate for unit {transport_unit_id}: {rate_type}/{location_key}/{duration}hrs", 
                        session.get('user_id'), session.get('display_name'))
            return jsonify({'message': 'Rate deleted successfully (price set to 0)'}), 200
        
        rate_ref.set(str(price))
        
        log_activity(f"Updated self-drive rate for unit {transport_unit_id}: {rate_type}/{location_key}/{duration}hrs = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== GET FULL TABLE DATA ==========

@car_rental_self_drive_api_bp.route('/table-data', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_table_data():
    """Get complete data for rates table"""
    try:
        # Get transport units
        transport_ref = db.reference('transportUnits')
        all_units = transport_ref.get() or {}
        
        transport_units = []
        unit_types_set = set()
        
        for unit_id, unit_data in all_units.items():
            unit_type = unit_data.get('unitType', '')
            if unit_type:
                unit_types_set.add(unit_type)
            
            is_available = unit_data.get('isAvailable', True)
            if isinstance(is_available, str):
                is_available = is_available.lower() == 'true'
            
            transport_units.append({
                'id': unit_id,
                'name': unit_data.get('transportUnit', ''),
                'unitType': unit_type,
                'plateNumber': unit_data.get('plateNumber', ''),
                'color': unit_data.get('color', ''),
                'isAvailable': is_available
            })
        
        # Get unit types as list
        unit_types = sorted(list(unit_types_set))
        
        # Get durations
        durations_ref = db.reference('rates/carRental/selfDrive/durations')
        all_durations = durations_ref.get() or {}
        
        durations = []
        for hours_key, dur_data in all_durations.items():
            is_active = dur_data.get('isActive', True)
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
        
        # Get self-drive rates (per transport unit)
        self_drive_rates_ref = db.reference('rates/carRental/selfDrive/transportUnitRates')
        self_drive_rates = self_drive_rates_ref.get() or {}
        
        # Get locations
        locations_ref = db.reference('rates/carRental/selfDrive/locations')
        all_locations = locations_ref.get() or {}
        
        locations = []
        for loc_key, loc_data in all_locations.items():
            is_active = loc_data.get('isActive', True)
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
            'unitTypes': unit_types,
            'durations': durations,
            'rates': self_drive_rates,
            'locations': locations,
            'locationPairs': location_pairs
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== PRICE CALCULATION HELPER ==========

@car_rental_self_drive_api_bp.route('/calculate-price', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def calculate_price():
    """Calculate the total rental price for self-drive"""
    try:
        data = request.json
        rental_type = data.get('rentalType', 'selfDrive')
        
        # Only self-drive is supported now
        if rental_type != 'selfDrive':
            return jsonify({'error': 'Only selfDrive rental type is supported'}), 400
        
        transport_unit_id = data.get('transportUnitId')
        pickup_location = data.get('pickupLocation')
        dropoff_location = data.get('dropoffLocation')
        hours = str(data.get('hours'))
        
        if not all([transport_unit_id, pickup_location, dropoff_location, hours]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        is_different_location = pickup_location != dropoff_location
        location_type = 'different_location' if is_different_location else 'same_location'
        location_key = f"{pickup_location}_to_{dropoff_location}" if is_different_location else pickup_location
        
        rate_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/{location_type}/{location_key}/{hours}'
        rate_ref = db.reference(rate_path)
        rate_str = rate_ref.get()
        rate = int(rate_str) if rate_str else 0
        
        # Get delivery fee
        delivery_fee_path = f'rates/carRental/selfDrive/locations/{pickup_location}/deliveryFeeFromPasay'
        delivery_fee_ref = db.reference(delivery_fee_path)
        delivery_fee_str = delivery_fee_ref.get()
        delivery_fee = int(delivery_fee_str) if delivery_fee_str else 0
        
        total = rate + delivery_fee
        
        return jsonify({
            'rentalType': 'selfDrive',
            'baseRate': rate,
            'deliveryFee': delivery_fee,
            'totalPrice': total
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== SEED DATABASE ==========

@car_rental_self_drive_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def seed_database():
    """Seed the database with sample data for self-drive"""
    try:
        sample_locations = {
            "pasay": {"name": "Pasay", "deliveryFeeFromPasay": "0", "isActive": True},
            "manila": {"name": "Manila", "deliveryFeeFromPasay": "500", "isActive": True},
            "makati": {"name": "Makati", "deliveryFeeFromPasay": "400", "isActive": True},
            "taguig": {"name": "Taguig", "deliveryFeeFromPasay": "600", "isActive": True},
            "quezon_city": {"name": "Quezon City", "deliveryFeeFromPasay": "800", "isActive": True}
        }
        
        locations_ref = db.reference('rates/carRental/selfDrive/locations')
        locations_ref.set(sample_locations)
        
        sample_durations = {
            "2": {"name": "2 Hours", "isActive": True},
            "4": {"name": "4 Hours", "isActive": True},
            "6": {"name": "6 Hours", "isActive": True},
            "8": {"name": "8 Hours", "isActive": True},
            "12": {"name": "12 Hours", "isActive": True},
            "24": {"name": "24 Hours (1 Day)", "isActive": True}
        }
        
        durations_ref = db.reference('rates/carRental/selfDrive/durations')
        durations_ref.set(sample_durations)
        
        log_activity("Seeded car rental self-drive database with new structure", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Self-drive database seeded successfully with new structure'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500