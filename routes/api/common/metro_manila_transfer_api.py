from flask import Blueprint, request, jsonify, session
from functools import wraps
from firebase_admin import db
from datetime import datetime
from backend.decorators import login_required_api, role_required_api, no_rate_limit

metro_manila_transfer_api_bp = Blueprint('metro_manila_transfer_api', __name__, url_prefix='/common/metro-manila-transfer')

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

def get_all_packages():
    """Get all packages for price initialization"""
    try:
        packages_ref = db.reference('packages')
        all_packages = packages_ref.get()
        
        if not all_packages:
            return []
        
        packages_list = []
        for pkg_id, pkg_data in all_packages.items():
            packages_list.append(pkg_data.get('packageName', ''))
        
        return packages_list
    except Exception as e:
        print(f"Error getting packages: {str(e)}")
        return []

def get_route_key(origin, destination):
    """Generate a unique route key"""
    return f"{origin}_{destination}"

def calculate_discounted_prices(prices, discount_type, discount_value):
    """Calculate discounted prices based on discount type and value"""
    discounted_prices = {}
    
    for package_name, price_str in prices.items():
        try:
            original_price = float(price_str)
            
            if discount_type == 'percentage':
                discount_amount = original_price * (float(discount_value) / 100)
                discounted_price = original_price - discount_amount
            elif discount_type == 'fixed':
                discounted_price = original_price - float(discount_value)
            else:
                discounted_price = original_price
            
            # Ensure price doesn't go below 0
            discounted_price = max(0, discounted_price)
            
            # Store as string to maintain consistency
            discounted_prices[package_name] = str(round(discounted_price, 2))
            
        except (ValueError, TypeError):
            # If price is invalid, keep as is
            discounted_prices[package_name] = price_str
    
    return discounted_prices

# ========== CITY MANAGEMENT ==========

@metro_manila_transfer_api_bp.route('/cities', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_cities():
    """Get all cities"""
    try:
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        all_cities = cities_ref.get()
        
        if not all_cities:
            return jsonify({'cities': []})
        
        cities_list = []
        for city_key, city_data in all_cities.items():
            city_info = {
                'key': city_key,
                'name': city_data.get('name', city_key),
                'isActive': city_data.get('isActive', True)
            }
            
            # Include discount info if exists
            if 'discount' in city_data:
                city_info['discount'] = city_data['discount']
            
            cities_list.append(city_info)
        
        return jsonify({'cities': cities_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@metro_manila_transfer_api_bp.route('/cities', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def add_city():
    """Add a new city"""
    try:
        data = request.json
        city_name = data.get('name', '').strip()
        
        if not city_name:
            return jsonify({'error': 'City name is required'}), 400
        
        city_key = city_name.lower().replace(' ', '_')
        
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        current_data = cities_ref.get() or {}
        
        if city_key in current_data:
            return jsonify({'error': f'City "{city_name}" already exists'}), 400
        
        current_data[city_key] = {
            'name': city_name,
            'isActive': True
        }
        
        cities_ref.set(current_data)
        
        log_activity(f"Added city: {city_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'City "{city_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@metro_manila_transfer_api_bp.route('/cities/<city_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_city(city_key):
    """Delete a city and all associated routes"""
    try:
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        current_data = cities_ref.get() or {}
        
        if city_key not in current_data:
            return jsonify({'error': 'City not found'}), 404
        
        city_name = current_data[city_key].get('name', city_key)
        
        del current_data[city_key]
        cities_ref.set(current_data)
        
        # Also delete all routes involving this city
        rates_ref = db.reference('rates/metroManilaTransfer/rates')
        all_rates = rates_ref.get() or {}
        
        routes_to_delete = []
        for route_key, route_data in all_rates.items():
            if route_key.startswith(f"{city_key}_") or route_key.endswith(f"_{city_key}"):
                routes_to_delete.append(route_key)
        
        for route_key in routes_to_delete:
            del all_rates[route_key]
        
        if routes_to_delete:
            rates_ref.set(all_rates)
        
        log_activity(f"Deleted city: {city_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'City "{city_name}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@metro_manila_transfer_api_bp.route('/cities/<city_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def toggle_city(city_key):
    """Toggle city active status"""
    try:
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        current_data = cities_ref.get() or {}
        
        if city_key not in current_data:
            return jsonify({'error': 'City not found'}), 404
        
        current_status = current_data[city_key].get('isActive', True)
        new_status = not current_status
        
        current_data[city_key]['isActive'] = new_status
        cities_ref.set(current_data)
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} city: {city_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'City {status_text}', 'isActive': new_status}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== CITY DISCOUNT MANAGEMENT ==========

@metro_manila_transfer_api_bp.route('/cities/<city_key>/discount', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_city_discount(city_key):
    """Get discount for a specific city"""
    try:
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        current_data = cities_ref.get() or {}
        
        if city_key not in current_data:
            return jsonify({'error': 'City not found'}), 404
        
        city_discount = current_data[city_key].get('discount', None)
        
        if city_discount:
            # Check if discount is still valid
            is_valid = True
            if city_discount.get('validUntil'):
                try:
                    valid_date = datetime.fromisoformat(city_discount['validUntil'])
                    if datetime.now() > valid_date:
                        is_valid = False
                except:
                    pass
            
            return jsonify({
                'hasDiscount': is_valid,
                'discount': city_discount if is_valid else None
            })
        else:
            return jsonify({'hasDiscount': False})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@metro_manila_transfer_api_bp.route('/cities/<city_key>/discount', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def set_city_discount(city_key):
    """Set discount for all routes involving a city"""
    try:
        data = request.json
        discount_type = data.get('type')  # 'percentage' or 'fixed'
        discount_value = data.get('value')
        description = data.get('description', '')
        valid_until = data.get('validUntil', '')
        
        if not discount_type or discount_type not in ['percentage', 'fixed']:
            return jsonify({'error': 'Invalid discount type. Must be "percentage" or "fixed"'}), 400
        
        if not discount_value:
            return jsonify({'error': 'Discount value is required'}), 400
        
        # Validate discount value
        try:
            discount_float = float(discount_value)
            if discount_type == 'percentage' and (discount_float < 0 or discount_float > 100):
                return jsonify({'error': 'Percentage must be between 0 and 100'}), 400
            if discount_type == 'fixed' and discount_float < 0:
                return jsonify({'error': 'Fixed discount cannot be negative'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid discount value'}), 400
        
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        current_data = cities_ref.get() or {}
        
        if city_key not in current_data:
            return jsonify({'error': 'City not found'}), 404
        
        # Prepare discount data
        discount_data = {
            'type': discount_type,
            'value': str(discount_value),
            'active': True,
            'createdAt': datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'unknown')
        }
        
        if description:
            discount_data['description'] = description
        
        if valid_until:
            discount_data['validUntil'] = valid_until
        
        # Store discount at city level
        current_data[city_key]['discount'] = discount_data
        cities_ref.set(current_data)
        
        log_activity(f"Set discount for city '{city_key}' - {discount_type}: {discount_value}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Discount applied to all routes involving {current_data[city_key]["name"]}',
            'discount': discount_data
        }), 200
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@metro_manila_transfer_api_bp.route('/cities/<city_key>/discount', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def remove_city_discount(city_key):
    """Remove discount from a city"""
    try:
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        current_data = cities_ref.get() or {}
        
        if city_key not in current_data:
            return jsonify({'error': 'City not found'}), 404
        
        city_name = current_data[city_key].get('name', city_key)
        
        # Remove discount if exists
        if 'discount' in current_data[city_key]:
            del current_data[city_key]['discount']
            cities_ref.set(current_data)
            
            log_activity(f"Removed discount from city '{city_key}'", 
                        session.get('user_id'), session.get('display_name'))
            
            return jsonify({'message': f'Discount removed from {city_name}'}), 200
        else:
            return jsonify({'message': 'No discount found for this city'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== RATE MANAGEMENT ==========

@metro_manila_transfer_api_bp.route('/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_all_rates():
    """Get all rates"""
    try:
        rates_ref = db.reference('rates/metroManilaTransfer/rates')
        all_rates = rates_ref.get() or {}
        
        return jsonify({'rates': all_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@metro_manila_transfer_api_bp.route('/rates/<origin>/<destination>', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_rate(origin, destination):
    """Get rate for specific route"""
    try:
        route_key = get_route_key(origin, destination)
        rate_ref = db.reference(f'rates/metroManilaTransfer/rates/{route_key}')
        rate_data = rate_ref.get() or {}
        
        return jsonify({
            'origin': origin,
            'destination': destination,
            'prices': rate_data
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@metro_manila_transfer_api_bp.route('/rates/<origin>/<destination>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def update_rate(origin, destination):
    """Update rate for specific route"""
    try:
        data = request.json
        prices = data.get('prices', {})
        
        # Convert prices to strings
        prices_as_strings = {}
        for pkg_name, price_value in prices.items():
            prices_as_strings[pkg_name] = str(price_value)
        
        route_key = get_route_key(origin, destination)
        rate_ref = db.reference(f'rates/metroManilaTransfer/rates/{route_key}')
        rate_ref.set(prices_as_strings)
        
        log_activity(f"Updated rate for route {origin} → {destination}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== FULL MATRIX ==========

@metro_manila_transfer_api_bp.route('/matrix', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_matrix():
    """Get complete fare matrix for display including city discounts"""
    try:
        # Get all packages
        packages_ref = db.reference('packages')
        all_packages = packages_ref.get() or {}
        
        packages_list = []
        for pkg_id, pkg_data in all_packages.items():
            packages_list.append(pkg_data.get('packageName', ''))
        
        # Sort packages: Economy first, then Comfort, then Bus
        def get_package_order(name):
            if name.startswith('Economy'):
                return (0, int(name.split()[-1]) if name.split()[-1].isdigit() else 0)
            elif name.startswith('Comfort'):
                return (1, int(name.split()[-1]) if name.split()[-1].isdigit() else 0)
            elif name.startswith('Bus'):
                return (2, int(name.split()[-1]) if name.split()[-1].isdigit() else 0)
            return (3, 0)
        
        packages_list.sort(key=get_package_order)
        
        # Get all cities with their discounts
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        all_cities = cities_ref.get() or {}
        
        active_cities = []
        for city_key, city_data in all_cities.items():
            city_info = {
                'key': city_key,
                'name': city_data.get('name', city_key),
                'isActive': city_data.get('isActive', True)
            }
            
            # Include discount info if exists and valid
            if 'discount' in city_data:
                discount = city_data['discount']
                # Check if discount is still valid
                is_valid = True
                if discount.get('validUntil'):
                    try:
                        valid_date = datetime.fromisoformat(discount['validUntil'])
                        if datetime.now() > valid_date:
                            is_valid = False
                    except:
                        pass
                
                if is_valid:
                    city_info['discount'] = discount
            
            if city_info.get('isActive', True):
                active_cities.append(city_info)
        
        # Get all rates
        rates_ref = db.reference('rates/metroManilaTransfer/rates')
        all_rates = rates_ref.get() or {}
        
        return jsonify({
            'packages': packages_list,
            'cities': active_cities,
            'rates': all_rates
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== SEED DATABASE ==========

@metro_manila_transfer_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def seed_database():
    """Seed the database with sample cities and rates"""
    try:
        # Get all packages
        all_packages = get_all_packages()
        
        if not all_packages:
            return jsonify({'error': 'No packages found. Please create packages first.'}), 400
        
        # Initialize prices to "0" as STRINGS
        initial_prices = {}
        for pkg in all_packages:
            initial_prices[pkg] = "0"
        
        # Sample cities
        sample_cities = {
            "manila": {"name": "Manila", "isActive": True},
            "quezon_city": {"name": "Quezon City", "isActive": True},
            "makati": {"name": "Makati", "isActive": True},
            "taguig": {"name": "Taguig", "isActive": True},
            "pasay": {"name": "Pasay", "isActive": True},
            "pasig": {"name": "Pasig", "isActive": True},
            "muntinlupa": {"name": "Muntinlupa", "isActive": True},
            "mandaluyong": {"name": "Mandaluyong", "isActive": True},
            "san_juan": {"name": "San Juan", "isActive": True},
            "marikina": {"name": "Marikina", "isActive": True}
        }
        
        cities_ref = db.reference('rates/metroManilaTransfer/cities')
        cities_ref.set(sample_cities)
        
        # Generate sample rates for some routes
        city_keys = list(sample_cities.keys())
        rates_ref = db.reference('rates/metroManilaTransfer/rates')
        rates_data = {}
        
        for i, origin in enumerate(city_keys):
            for destination in city_keys[i+1:]:
                route_key = f"{origin}_{destination}"
                rates_data[route_key] = initial_prices.copy()
        
        rates_ref.set(rates_data)
        
        log_activity("Seeded metro Manila transfer database", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Database seeded successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500