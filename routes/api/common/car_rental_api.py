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


# ========== RATE MANAGEMENT WITH SAME/DIFFERENT LOCATION STRUCTURE ==========

@car_rental_api_bp.route('/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_rates():
    """Get all rates for transport units with same/different location structure"""
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
    """
    Update rate for a specific transport unit.
    
    Structure:
    - For same location: rateType = 'same', locationKey = the location (e.g., 'manila')
    - For different location: rateType = 'different', locationKey = 'manila_to_makati' (pickup_to_dropoff)
    """
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        rate_type = data.get('rateType')  # 'same' or 'different'
        location_key = data.get('locationKey')  # e.g., 'manila' or 'manila_to_makati'
        duration = data.get('duration')
        price = str(data.get('price', '0'))
        
        if not all([transport_unit_id, rate_type, location_key, duration, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Build path based on rate type
        rate_path = f'rates/carRental/transportUnitRates/{transport_unit_id}/{rate_type}_location/{location_key}/{duration}'
        rate_ref = db.reference(rate_path)
        rate_ref.set(price)
        
        log_activity(f"Updated {rate_type} location rate for unit {transport_unit_id} at {location_key}: {duration} = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_api_bp.route('/rates/bulk', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_bulk_rates():
    """
    Update multiple rates at once for a transport unit.
    
    Expected data format:
    {
        "transportUnitId": "unit_123",
        "rates": {
            "same_location": {
                "manila": {
                    "4_hours": "800",
                    "8_hours": "1200"
                },
                "makati": {
                    "4_hours": "900",
                    "8_hours": "1300"
                }
            },
            "different_location": {
                "manila_to_makati": {
                    "4_hours": "1600",
                    "8_hours": "2400"
                },
                "manila_to_pasay": {
                    "4_hours": "1400",
                    "8_hours": "2000"
                }
            }
        }
    }
    """
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        rates_data = data.get('rates', {})
        
        if not transport_unit_id:
            return jsonify({'error': 'Transport unit ID is required'}), 400
        
        base_path = f'rates/carRental/transportUnitRates/{transport_unit_id}'
        rates_ref = db.reference(base_path)
        
        # Convert the rates data to the proper format and save
        formatted_rates = {}
        
        if 'same_location' in rates_data:
            formatted_rates['same_location'] = rates_data['same_location']
        
        if 'different_location' in rates_data:
            formatted_rates['different_location'] = rates_data['different_location']
        
        rates_ref.set(formatted_rates)
        
        log_activity(f"Bulk updated rates for unit {transport_unit_id}", session.get('user_id'), session.get('display_name'))
        
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
            transport_units.append({
                'id': unit_id,
                'name': unit_data.get('transportUnit', ''),
                'unitType': unit_data.get('unitType', ''),
                'plateNumber': unit_data.get('plateNumber', ''),
                'color': unit_data.get('color', ''),
                'isAvailable': unit_data.get('isAvailable', 'true') == 'true'
            })
        
        # Get durations (sorted by hours)
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
        
        # Sort durations by hours ascending
        durations.sort(key=lambda x: x['hours'])
        
        # Get rates with same/different location structure
        rates_ref = db.reference('rates/carRental/transportUnitRates')
        all_rates = rates_ref.get() or {}
        
        # Get locations (active only)
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
        
        # Generate location pairs for different location rates
        location_pairs = []
        for i, pickup in enumerate(locations):
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
            'rates': all_rates,
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
    """
    Calculate the total rental price based on:
    - transport_unit_id: The selected vehicle
    - pickup_location: Where the customer picks up the vehicle
    - dropoff_location: Where the customer returns the vehicle
    - duration_key: The selected duration (e.g., '4_hours')
    
    Uses the stored rates:
    - If pickup == dropoff: uses same_location/{pickup}/{duration}
    - If pickup != dropoff: uses different_location/{pickup}_to_{dropoff}/{duration}
    
    Then adds delivery fee from Pasay to pickup location
    """
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        pickup_location = data.get('pickupLocation')
        dropoff_location = data.get('dropoffLocation')
        duration_key = data.get('duration')
        
        if not all([transport_unit_id, pickup_location, dropoff_location, duration_key]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        rates_ref = db.reference(f'rates/carRental/transportUnitRates/{transport_unit_id}')
        
        if pickup_location == dropoff_location:
            # Same location - use same_location path
            rate_path = f'same_location/{pickup_location}/{duration_key}'
            location_type = "same"
        else:
            # Different location - use different_location path with pickup_to_dropoff
            location_pair = f"{pickup_location}_to_{dropoff_location}"
            rate_path = f'different_location/{location_pair}/{duration_key}'
            location_type = "different"
        
        rate_ref = rates_ref.child(rate_path)
        rate_str = rate_ref.get()
        rate = int(rate_str) if rate_str else 0
        
        # Get the delivery fee for the pickup location
        delivery_fee_path = f'rates/carRental/locations/{pickup_location}/deliveryFeeFromPasay'
        delivery_fee_ref = db.reference(delivery_fee_path)
        delivery_fee_str = delivery_fee_ref.get()
        delivery_fee = int(delivery_fee_str) if delivery_fee_str else 0
        
        # Calculate total (rate already includes the multiplier for different locations)
        total = rate + delivery_fee
        
        log_activity(f"Price calculated for unit {transport_unit_id}: {location_type} location, total = ₱{total}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'transportUnitId': transport_unit_id,
            'pickupLocation': pickup_location,
            'dropoffLocation': dropoff_location,
            'duration': duration_key,
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
        
        # Sample durations (all values as strings) - sorted by hours
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
        
        # Sample rates with the new same/different location structure
        sample_rates = {
            "sample_unit_1": {
                "same_location": {
                    "manila": {
                        "2_hours": "500",
                        "4_hours": "800",
                        "6_hours": "1000",
                        "8_hours": "1200",
                        "12_hours": "1500",
                        "24_hours": "2000"
                    },
                    "makati": {
                        "2_hours": "450",
                        "4_hours": "750",
                        "6_hours": "950",
                        "8_hours": "1150",
                        "12_hours": "1450",
                        "24_hours": "1900"
                    },
                    "pasay": {
                        "2_hours": "400",
                        "4_hours": "700",
                        "6_hours": "900",
                        "8_hours": "1100",
                        "12_hours": "1400",
                        "24_hours": "1800"
                    }
                },
                "different_location": {
                    "manila_to_makati": {
                        "2_hours": "900",
                        "4_hours": "1500",
                        "6_hours": "1800",
                        "8_hours": "2200",
                        "12_hours": "2800",
                        "24_hours": "3800"
                    },
                    "manila_to_pasay": {
                        "2_hours": "850",
                        "4_hours": "1400",
                        "6_hours": "1700",
                        "8_hours": "2100",
                        "12_hours": "2700",
                        "24_hours": "3600"
                    },
                    "makati_to_manila": {
                        "2_hours": "900",
                        "4_hours": "1500",
                        "6_hours": "1800",
                        "8_hours": "2200",
                        "12_hours": "2800",
                        "24_hours": "3800"
                    },
                    "makati_to_pasay": {
                        "2_hours": "800",
                        "4_hours": "1300",
                        "6_hours": "1600",
                        "8_hours": "2000",
                        "12_hours": "2600",
                        "24_hours": "3500"
                    }
                }
            }
        }
        
        # Uncomment to seed sample rates
        rates_ref = db.reference('rates/carRental/transportUnitRates')
        rates_ref.set(sample_rates)
        
        log_activity("Seeded car rental database with same/different location structure", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Database seeded successfully with same/different location structure'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500