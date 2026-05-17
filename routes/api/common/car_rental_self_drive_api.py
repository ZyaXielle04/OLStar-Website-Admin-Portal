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


def calculate_discounted_prices(original_price, discount_type, discount_value):
    """Calculate discounted price based on discount type and value"""
    try:
        original = float(original_price)
        
        if discount_type == 'percentage':
            discount_amount = original * (float(discount_value) / 100)
            discounted = original - discount_amount
        elif discount_type == 'fixed':
            discounted = original - float(discount_value)
        else:
            return original_price
        
        return max(0, round(discounted, 2))
    except (ValueError, TypeError):
        return original_price


def recalculate_all_discounted_prices(discount_data):
    """Recalculate discounted prices for ALL units based on current discount"""
    try:
        if not discount_data or not discount_data.get('active', True):
            return
        
        # Check if discount is expired
        valid_until = discount_data.get('validUntil')
        if valid_until:
            valid_date = datetime.fromisoformat(valid_until)
            if datetime.now() > valid_date:
                return
        
        discount_type = discount_data.get('discountType')
        discount_value = discount_data.get('value')
        
        # Get all original prices
        rates_ref = db.reference('rates/carRental/selfDrive/transportUnitRates')
        all_units = rates_ref.get() or {}
        
        for unit_id, unit_data in all_units.items():
            # Get prices from the /prices node
            prices_data = unit_data.get('prices', {})
            if not prices_data:
                continue
            
            # For each rate type (same_location, different_location)
            for rate_type, type_data in prices_data.items():
                for location_key, location_data in type_data.items():
                    for duration_key, price_str in location_data.items():
                        try:
                            original_price = float(price_str) if price_str else 0
                            discounted_price = calculate_discounted_prices(original_price, discount_type, discount_value)
                            
                            # Store discounted price under /discountedPrices
                            discounted_path = f'rates/carRental/selfDrive/transportUnitRates/{unit_id}/discountedPrices/{rate_type}/{location_key}/{duration_key}'
                            discounted_ref = db.reference(discounted_path)
                            discounted_ref.set(str(discounted_price))
                        except (ValueError, TypeError) as e:
                            print(f"Error calculating discounted price for {unit_id}/{rate_type}/{location_key}/{duration_key}: {e}")
                            continue
    except Exception as e:
        print(f"Error recalculating discounted prices: {str(e)}")


def recalculate_discounted_prices_for_unit(unit_id, discount_type, discount_value):
    """Recalculate discounted prices for a specific unit"""
    try:
        prices_ref = db.reference(f'rates/carRental/selfDrive/transportUnitRates/{unit_id}/prices')
        all_prices = prices_ref.get() or {}
        
        for rate_type, type_data in all_prices.items():
            for location_key, location_data in type_data.items():
                for duration_key, price_str in location_data.items():
                    original_price = float(price_str) if price_str else 0
                    discounted_price = calculate_discounted_prices(original_price, discount_type, discount_value)
                    
                    # Store discounted price
                    discounted_path = f'rates/carRental/selfDrive/transportUnitRates/{unit_id}/discountedPrices/{rate_type}/{location_key}/{duration_key}'
                    discounted_ref = db.reference(discounted_path)
                    discounted_ref.set(str(discounted_price))
                    
    except Exception as e:
        print(f"Error recalculating discounted prices for unit {unit_id}: {str(e)}")


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
            is_active = loc_data.get('isActive', True)
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            locations_list.append({
                'key': loc_key,
                'name': loc_data.get('name', loc_key),
                'deliveryFeeFromPasay': loc_data.get('deliveryFeeFromPasay', '0'),
                'isActive': is_active
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
            'isActive': True
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
            updates['isActive'] = data['isActive']
        
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
        
        current_status = existing.get('isActive', True)
        if isinstance(current_status, str):
            current_status = current_status.lower() == 'true'
        
        new_status = not current_status
        
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
            'isActive': True
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
        
        current_status = existing.get('isActive', True)
        if isinstance(current_status, str):
            current_status = current_status.lower() == 'true'
        
        new_status = not current_status
        
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


# ========== GLOBAL DISCOUNT MANAGEMENT ==========

@car_rental_self_drive_api_bp.route('/discount', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_global_discount():
    """Get global discount settings for self-drive"""
    try:
        discount_ref = db.reference('rates/carRental/selfDrive/globalDiscount')
        discount_data = discount_ref.get()
        
        if not discount_data:
            return jsonify({'hasDiscount': False})
        
        return jsonify({
            'hasDiscount': True,
            'discount': discount_data
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/discount', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def set_global_discount():
    """Set global discount - stores discount and recalculates discountedPrices node"""
    try:
        data = request.json
        discount_type = data.get('discountType')
        discount_value = data.get('value')
        description = data.get('description', '')
        valid_until = data.get('validUntil', '')
        apply_to_all = data.get('applyToAll', False)
        
        if not discount_type or discount_type not in ['percentage', 'fixed']:
            return jsonify({'error': 'Invalid discount type'}), 400
        
        if not discount_value:
            return jsonify({'error': 'Discount value is required'}), 400
        
        try:
            discount_float = float(discount_value)
            if discount_type == 'percentage' and (discount_float < 0 or discount_float > 100):
                return jsonify({'error': 'Percentage must be between 0 and 100'}), 400
            if discount_type == 'fixed' and discount_float < 0:
                return jsonify({'error': 'Fixed discount cannot be negative'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid discount value'}), 400
        
        # Store discount settings
        discount_ref = db.reference('rates/carRental/selfDrive/globalDiscount')
        discount_data = {
            'discountType': discount_type,
            'value': str(discount_value),
            'description': description,
            'createdAt': datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'unknown'),
            'active': True
        }
        
        if valid_until:
            discount_data['validUntil'] = valid_until
        
        discount_ref.set(discount_data)
        
        # Always recalculate all discounted prices when discount is set
        recalculate_all_discounted_prices(discount_data)
        
        log_activity(f"Set global discount for self-drive: {discount_type} - {discount_value}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Global discount set successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_self_drive_api_bp.route('/discount', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def remove_global_discount():
    """Remove global discount and clear discountedPrices node"""
    try:
        # Delete discount settings
        discount_ref = db.reference('rates/carRental/selfDrive/globalDiscount')
        discount_ref.delete()
        
        # Optionally clear all discountedPrices nodes
        remove_from_rates = request.args.get('removeFromRates', 'false').lower() == 'true'
        
        if remove_from_rates:
            rates_ref = db.reference('rates/carRental/selfDrive/transportUnitRates')
            all_units = rates_ref.get() or {}
            
            for unit_id in all_units.keys():
                discounted_ref = db.reference(f'rates/carRental/selfDrive/transportUnitRates/{unit_id}/discountedPrices')
                discounted_ref.delete()
        
        log_activity("Removed global discount from self-drive", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Global discount removed successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== SELF-DRIVE RATE MANAGEMENT ==========

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
    """Update rate for a specific transport unit under self-drive.
       Stores price under /prices and updates /discountedPrices if discount exists."""
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        rate_type = data.get('rateType')  # 'same_location' or 'different_location'
        location_key = data.get('locationKey')
        duration = str(data.get('duration'))
        price = data.get('price', '0')
        
        if not all([transport_unit_id, rate_type, location_key, duration, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Store price under /prices
        price_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/prices/{rate_type}/{location_key}/{duration}'
        price_ref = db.reference(price_path)
        
        if str(price) == '0' or price == 0:
            price_ref.delete()
        else:
            price_ref.set(str(price))
        
        # Check if discount exists and recalculate discounted price
        discount_ref = db.reference('rates/carRental/selfDrive/globalDiscount')
        discount_data = discount_ref.get()
        
        if discount_data and discount_data.get('active', True):
            # Check if discount is expired
            is_valid = True
            valid_until = discount_data.get('validUntil')
            if valid_until:
                try:
                    valid_date = datetime.fromisoformat(valid_until)
                    if datetime.now() > valid_date:
                        is_valid = False
                except:
                    pass
            
            if is_valid and str(price) != '0' and price != 0:
                discount_type = discount_data.get('discountType')
                discount_value = discount_data.get('value')
                discounted_price = calculate_discounted_prices(price, discount_type, discount_value)
                
                # Store discounted price under /discountedPrices
                discounted_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/discountedPrices/{rate_type}/{location_key}/{duration}'
                discounted_ref = db.reference(discounted_path)
                discounted_ref.set(str(discounted_price))
            else:
                # If price is 0 or discount expired, remove discounted price
                discounted_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/discountedPrices/{rate_type}/{location_key}/{duration}'
                discounted_ref = db.reference(discounted_path)
                discounted_ref.delete()
        else:
            # No discount active, ensure discounted price is removed
            discounted_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/discountedPrices/{rate_type}/{location_key}/{duration}'
            discounted_ref = db.reference(discounted_path)
            discounted_ref.delete()
        
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
    """Get complete data for rates table including original and discounted prices"""
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
        
        # Get original prices from /prices
        prices_ref = db.reference('rates/carRental/selfDrive/transportUnitRates')
        all_prices = prices_ref.get() or {}
        
        # Extract only the prices node (remove discountedPrices from the response)
        prices_data = {}
        for unit_id, unit_data in all_prices.items():
            if 'prices' in unit_data:
                prices_data[unit_id] = unit_data['prices']
            else:
                # If no 'prices' node, the unit data itself might be the prices (backward compatibility)
                # Check if it has same_location or different_location
                if 'same_location' in unit_data or 'different_location' in unit_data:
                    prices_data[unit_id] = unit_data
        
        # Get discounted prices from /discountedPrices
        discounted_prices_data = {}
        for unit_id, unit_data in all_prices.items():
            if 'discountedPrices' in unit_data:
                discounted_prices_data[unit_id] = unit_data['discountedPrices']
        
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
        
        # Get discount settings
        discount_ref = db.reference('rates/carRental/selfDrive/globalDiscount')
        discount_data = discount_ref.get()
        
        return jsonify({
            'transportUnits': transport_units,
            'unitTypes': unit_types,
            'durations': durations,
            'prices': prices_data,           # Original prices from /prices
            'discountedPrices': discounted_prices_data,  # Discounted prices from /discountedPrices
            'locations': locations,
            'discount': discount_data
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
        
        if rental_type != 'selfDrive':
            return jsonify({'error': 'Only selfDrive rental type is supported'}), 400
        
        transport_unit_id = data.get('transportUnitId')
        pickup_location = data.get('pickupLocation')
        dropoff_location = data.get('dropoffLocation')
        hours = str(data.get('hours'))
        
        if not all([transport_unit_id, pickup_location, dropoff_location, hours]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        is_different_location = pickup_location != dropoff_location
        rate_type = 'different_location' if is_different_location else 'same_location'
        location_key = f"{pickup_location}_to_{dropoff_location}" if is_different_location else pickup_location
        
        # Try to get discounted price first
        discounted_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/discountedPrices/{rate_type}/{location_key}/{hours}'
        discounted_ref = db.reference(discounted_path)
        discounted_str = discounted_ref.get()
        
        if discounted_str:
            rate = int(discounted_str) if discounted_str else 0
        else:
            # Fall back to original price
            price_path = f'rates/carRental/selfDrive/transportUnitRates/{transport_unit_id}/prices/{rate_type}/{location_key}/{hours}'
            price_ref = db.reference(price_path)
            price_str = price_ref.get()
            rate = int(price_str) if price_str else 0
        
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
        
        log_activity("Seeded car rental self-drive database", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Self-drive database seeded successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500