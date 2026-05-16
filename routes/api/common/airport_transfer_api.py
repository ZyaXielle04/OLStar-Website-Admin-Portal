from flask import Blueprint, request, jsonify, session, current_app
from firebase_admin import db
from datetime import datetime
from backend.decorators import login_required_api, role_required_api, no_rate_limit


airport_transfer_api_bp = Blueprint('airport_transfer_api', __name__, url_prefix='/common/airport-transfer')

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

# ========== CATEGORY MANAGEMENT ==========

@airport_transfer_api_bp.route('/categories', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_categories():
    """Get all categories with their areas and prices"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        all_categories = categories_ref.get()
        
        if not all_categories:
            return jsonify({'categories': []})
        
        categories_list = []
        for cat_key, cat_data in all_categories.items():
            categories_list.append({
                'key': cat_key,
                'name': cat_data.get('name', cat_key),
                'isActive': cat_data.get('isActive', True),
                'areas': cat_data.get('areas', {})
            })
        
        return jsonify({'categories': categories_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def add_category():
    """Add a new category with an initial area and all packages set to "0" as string"""
    try:
        data = request.json
        category_name = data.get('name', '').strip()
        area_name = data.get('area', '').strip()
        
        if not category_name:
            return jsonify({'error': 'Category name is required'}), 400
        
        if not area_name:
            return jsonify({'error': 'Area name is required'}), 400
        
        all_packages = get_all_packages()
        
        if not all_packages:
            return jsonify({'error': 'No packages found. Please create packages first.'}), 400
        
        initial_prices = {}
        for pkg in all_packages:
            initial_prices[pkg] = "0"
        
        category_key = category_name.lower().replace(' ', '_')
        area_key = area_name.lower().replace(' ', '_')
        
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key in current_data:
            return jsonify({'error': f'Category "{category_name}" already exists'}), 400
        
        current_data[category_key] = {
            'name': category_name,
            'isActive': True,
            'areas': {
                area_key: {
                    'name': area_name,
                    'prices': initial_prices
                }
            }
        }
        
        categories_ref.set(current_data)
        
        log_activity(f"Added category '{category_name}' with area '{area_name}'", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Category "{category_name}" with area "{area_name}" added successfully',
            'category_key': category_key
        }), 201
    except Exception as e:
        print(f"ERROR in add_category: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_category(category_key):
    """Delete a category and all its areas"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        del current_data[category_key]
        categories_ref.set(current_data)
        
        log_activity(f"Deleted category: {category_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Category deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def toggle_category(category_key):
    """Toggle category active status"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        current_status = current_data[category_key].get('isActive', True)
        new_status = not current_status
        
        current_data[category_key]['isActive'] = new_status
        categories_ref.set(current_data)
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} category: {category_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Category {status_text}', 'isActive': new_status}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== AREA MANAGEMENT ==========

@airport_transfer_api_bp.route('/categories/<category_key>/areas', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def add_area(category_key):
    """Add a new area to a category with all packages set to "0" as string"""
    try:
        data = request.json
        area_name = data.get('name', '').strip()
        
        if not area_name:
            return jsonify({'error': 'Area name is required'}), 400
        
        all_packages = get_all_packages()
        
        if not all_packages:
            return jsonify({'error': 'No packages found. Please create packages first.'}), 400
        
        initial_prices = {}
        for pkg in all_packages:
            initial_prices[pkg] = "0"
        
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': f'Category "{category_key}" not found'}), 404
        
        area_key = area_name.lower().replace(' ', '_')
        
        if 'areas' not in current_data[category_key]:
            current_data[category_key]['areas'] = {}
        
        if area_key in current_data[category_key]['areas']:
            return jsonify({'error': f'Area "{area_name}" already exists'}), 400
        
        current_data[category_key]['areas'][area_key] = {
            'name': area_name,
            'prices': initial_prices
        }
        
        categories_ref.set(current_data)
        
        log_activity(f"Added area '{area_name}' to category '{category_key}'", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Area "{area_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR in add_area: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/areas/<area_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_area(category_key, area_key):
    """Delete an area from a category"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        del current_data[category_key]['areas'][area_key]
        categories_ref.set(current_data)
        
        log_activity(f"Deleted area '{area_key}' from category '{category_key}'", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Area deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== PRICE MANAGEMENT ==========

@airport_transfer_api_bp.route('/categories/<category_key>/areas/<area_key>/prices', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_prices(category_key, area_key):
    """Get prices for a specific area"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        prices = current_data[category_key]['areas'][area_key].get('prices', {})
        
        return jsonify({'prices': prices}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/areas/<area_key>/prices', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def update_prices(category_key, area_key):
    """Update prices for a specific area - store as strings"""
    try:
        data = request.json
        prices = data.get('prices', {})
        
        prices_as_strings = {}
        for pkg_name, price_value in prices.items():
            prices_as_strings[pkg_name] = str(price_value)
        
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        current_data[category_key]['areas'][area_key]['prices'] = prices_as_strings
        
        # If there's an active discount, recalculate discounted prices
        if 'discountedPrices' in current_data[category_key]['areas'][area_key]:
            discount_data = current_data[category_key]['areas'][area_key]['discountedPrices']
            discount_type = discount_data.get('discountType')
            discount_value = discount_data.get('value')
            
            if discount_type and discount_value:
                # Check if discount is still valid
                is_valid = True
                valid_until = discount_data.get('validUntil')
                if valid_until:
                    try:
                        valid_date = datetime.fromisoformat(valid_until)
                        if datetime.now() > valid_date:
                            is_valid = False
                    except:
                        pass
                
                if is_valid:
                    discounted_prices = calculate_discounted_prices(prices_as_strings, discount_type, discount_value)
                    current_data[category_key]['areas'][area_key]['discountedPrices']['discountedPrice'] = discounted_prices
        
        categories_ref.set(current_data)
        
        log_activity(f"Updated prices for area '{area_key}' in category '{category_key}'", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Prices updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== DISCOUNTED PRICE MANAGEMENT ==========

@airport_transfer_api_bp.route('/categories/<category_key>/areas/<area_key>/discounted-prices', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_discounted_prices(category_key, area_key):
    """Get discounted prices for a specific area"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        discounted_prices = current_data[category_key]['areas'][area_key].get('discountedPrices', {})
        
        return jsonify({'discountedPrices': discounted_prices}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/areas/<area_key>/discounted-prices', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def set_discounted_prices(category_key, area_key):
    """Set discounted prices for a specific area"""
    try:
        data = request.json
        discount_type = data.get('discountType')  # 'percentage' or 'fixed'
        discount_value = data.get('value')  # e.g., "20" or "500"
        description = data.get('description', '')
        valid_until = data.get('validUntil', '')  # ISO date string
        
        if not discount_type or discount_type not in ['percentage', 'fixed']:
            return jsonify({'error': 'Invalid discount type. Must be "percentage" or "fixed"'}), 400
        
        if not discount_value:
            return jsonify({'error': 'Discount value is required'}), 400
        
        try:
            discount_value_float = float(discount_value)
            if discount_type == 'percentage' and (discount_value_float < 0 or discount_value_float > 100):
                return jsonify({'error': 'Percentage discount must be between 0 and 100'}), 400
            if discount_type == 'fixed' and discount_value_float < 0:
                return jsonify({'error': 'Fixed discount cannot be negative'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid discount value'}), 400
        
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        # Get current prices
        current_prices = current_data[category_key]['areas'][area_key].get('prices', {})
        
        # Calculate discounted prices
        discounted_prices = calculate_discounted_prices(current_prices, discount_type, str(discount_value))
        
        # Prepare discount data
        discount_data = {
            'discountType': discount_type,
            'value': str(discount_value),
            'discountedPrice': discounted_prices,
            'createdAt': datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'unknown')
        }
        
        if description:
            discount_data['description'] = description
        
        if valid_until:
            discount_data['validUntil'] = valid_until
        
        # Set discounted prices
        current_data[category_key]['areas'][area_key]['discountedPrices'] = discount_data
        categories_ref.set(current_data)
        
        log_activity(f"Set discounted prices for area '{area_key}' in category '{category_key}' with {discount_type} discount of {discount_value}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': 'Discounted prices set successfully',
            'discountedPrices': discounted_prices
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/areas/<area_key>/discounted-prices', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def remove_discounted_prices(category_key, area_key):
    """Remove discounted prices for a specific area"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        # Remove discounted prices if they exist
        if 'discountedPrices' in current_data[category_key]['areas'][area_key]:
            del current_data[category_key]['areas'][area_key]['discountedPrices']
            categories_ref.set(current_data)
            
            log_activity(f"Removed discounted prices for area '{area_key}' in category '{category_key}'", 
                        session.get('user_id'), session.get('display_name'))
            
            return jsonify({'message': 'Discounted prices removed successfully'}), 200
        else:
            return jsonify({'message': 'No discounted prices found'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/areas/<area_key>/discounted-prices/validate', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def validate_discount(category_key, area_key):
    """Check if a discount is still valid and return active discount info"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        discount_data = current_data[category_key]['areas'][area_key].get('discountedPrices')
        
        if not discount_data:
            return jsonify({'hasDiscount': False, 'message': 'No discount available'}), 200
        
        # Check validity
        is_valid = True
        valid_until = discount_data.get('validUntil')
        if valid_until:
            try:
                valid_date = datetime.fromisoformat(valid_until)
                if datetime.now() > valid_date:
                    is_valid = False
            except:
                pass
        
        if not is_valid:
            return jsonify({
                'hasDiscount': False,
                'message': 'Discount has expired',
                'expired': True
            }), 200
        
        return jsonify({
            'hasDiscount': True,
            'discount': discount_data
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== GET ALL PACKAGES ==========

@airport_transfer_api_bp.route('/packages')
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_packages():
    """Get all packages for the fare matrix"""
    try:
        packages_ref = db.reference('packages')
        all_packages = packages_ref.get()
        
        if not all_packages:
            return jsonify({'packages': []})
        
        packages_list = []
        for pkg_id, pkg_data in all_packages.items():
            packages_list.append({
                'id': pkg_id,
                'name': pkg_data.get('packageName', '')
            })
        
        return jsonify({'packages': packages_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== FULL MATRIX ==========

@airport_transfer_api_bp.route('/matrix')
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_matrix():
    """Get complete fare matrix for display including discounted prices"""
    try:
        packages_ref = db.reference('packages')
        all_packages = packages_ref.get() or {}
        
        packages_list = []
        for pkg_id, pkg_data in all_packages.items():
            packages_list.append({
                'id': pkg_id,
                'name': pkg_data.get('packageName', '')
            })
        
        categories_ref = db.reference('rates/airportTransfer')
        all_categories = categories_ref.get() or {}
        
        matrix = []
        for cat_key, cat_data in all_categories.items():
            areas_dict = {}
            areas_data = cat_data.get('areas', {})
            
            for area_key, area_data in areas_data.items():
                area_info = {
                    'name': area_data.get('name', area_key),
                    'prices': area_data.get('prices', {})
                }
                
                # Include discounted prices if they exist
                if 'discountedPrices' in area_data:
                    area_info['discountedPrices'] = area_data['discountedPrices']
                
                areas_dict[area_key] = area_info
            
            matrix.append({
                'key': cat_key,
                'name': cat_data.get('name', cat_key),
                'isActive': cat_data.get('isActive', True),
                'areas': areas_dict,
                'categoryDiscount': cat_data.get('categoryDiscount', None)
            })
        
        return jsonify({
            'packages': packages_list,
            'matrix': matrix
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== GLOBAL DISCOUNT ==========

@airport_transfer_api_bp.route('/global-discount', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_global_discount():
    """Get global discount settings"""
    try:
        settings_ref = db.reference('settings/airportTransfer')
        global_discount = settings_ref.child('globalDiscount').get()
        
        if not global_discount:
            return jsonify({'hasDiscount': False})
        
        return jsonify({
            'hasDiscount': True,
            'discount': global_discount
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/global-discount', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def set_global_discount():
    """Set global discount that applies to all areas"""
    try:
        data = request.json
        discount_type = data.get('discountType')  # 'percentage' or 'fixed'
        discount_value = data.get('value')
        description = data.get('description', '')
        valid_until = data.get('validUntil', '')
        apply_to_all = data.get('applyToAll', False)  # Whether to apply to all existing areas
        
        if not discount_type or discount_type not in ['percentage', 'fixed']:
            return jsonify({'error': 'Invalid discount type'}), 400
        
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
        
        # Save global discount settings
        settings_ref = db.reference('settings/airportTransfer')
        global_discount_data = {
            'discountType': discount_type,
            'value': str(discount_value),
            'description': description,
            'createdAt': datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'unknown')
        }
        
        if valid_until:
            global_discount_data['validUntil'] = valid_until
        
        settings_ref.child('globalDiscount').set(global_discount_data)
        
        # Optionally apply to all existing areas
        if apply_to_all:
            categories_ref = db.reference('rates/airportTransfer')
            current_data = categories_ref.get() or {}
            
            for cat_key, cat_data in current_data.items():
                areas = cat_data.get('areas', {})
                for area_key, area_data in areas.items():
                    current_prices = area_data.get('prices', {})
                    discounted_prices = calculate_discounted_prices(current_prices, discount_type, str(discount_value))
                    
                    area_discount_data = {
                        'discountType': discount_type,
                        'value': str(discount_value),
                        'discountedPrice': discounted_prices,
                        'createdAt': datetime.now().isoformat(),
                        'createdBy': session.get('user_id', 'unknown'),
                        'isGlobal': True
                    }
                    
                    if description:
                        area_discount_data['description'] = description
                    
                    if valid_until:
                        area_discount_data['validUntil'] = valid_until
                    
                    current_data[cat_key]['areas'][area_key]['discountedPrices'] = area_discount_data
            
            categories_ref.set(current_data)
            log_activity(f"Applied global discount of {discount_value}% to all areas", 
                        session.get('user_id'), session.get('display_name'))
        
        log_activity(f"Set global discount: {discount_type} - {discount_value}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Global discount set successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/global-discount', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def remove_global_discount():
    """Remove global discount"""
    try:
        settings_ref = db.reference('settings/airportTransfer')
        settings_ref.child('globalDiscount').delete()
        
        # Optionally remove all global discounts from areas
        remove_from_areas = request.args.get('removeFromAreas', 'false').lower() == 'true'
        
        if remove_from_areas:
            categories_ref = db.reference('rates/airportTransfer')
            current_data = categories_ref.get() or {}
            
            for cat_key, cat_data in current_data.items():
                areas = cat_data.get('areas', {})
                for area_key, area_data in areas.items():
                    if 'discountedPrices' in area_data and area_data['discountedPrices'].get('isGlobal'):
                        del current_data[cat_key]['areas'][area_key]['discountedPrices']
            
            categories_ref.set(current_data)
        
        log_activity("Removed global discount", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Global discount removed successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== SEED DATABASE ==========

@airport_transfer_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def seed_database():
    """Seed the database with sample data - prices as strings"""
    try:
        all_packages = get_all_packages()
        
        if not all_packages:
            return jsonify({'error': 'No packages found. Please create packages first.'}), 400
        
        initial_prices = {}
        for pkg in all_packages:
            initial_prices[pkg] = "0"
        
        sample_data = {
            "cavite": {
                "name": "Cavite",
                "isActive": True,
                "areas": {
                    "bacoor": {
                        "name": "Bacoor",
                        "prices": initial_prices
                    },
                    "dasmariñas": {
                        "name": "Dasmariñas",
                        "prices": initial_prices
                    },
                    "imus": {
                        "name": "Imus",
                        "prices": initial_prices
                    }
                }
            },
            "metro_manila": {
                "name": "Metro Manila",
                "isActive": True,
                "areas": {
                    "makati": {
                        "name": "Makati",
                        "prices": initial_prices
                    },
                    "taguig": {
                        "name": "Taguig",
                        "prices": initial_prices
                    },
                    "pasay": {
                        "name": "Pasay",
                        "prices": initial_prices
                    },
                    "parañaque": {
                        "name": "Parañaque",
                        "prices": initial_prices
                    }
                }
            },
            "laguna": {
                "name": "Laguna",
                "isActive": True,
                "areas": {
                    "santa_rosa": {
                        "name": "Santa Rosa",
                        "prices": initial_prices
                    },
                    "biñan": {
                        "name": "Biñan",
                        "prices": initial_prices
                    },
                    "calamba": {
                        "name": "Calamba",
                        "prices": initial_prices
                    }
                }
            }
        }
        
        categories_ref = db.reference('rates/airportTransfer')
        categories_ref.set(sample_data)
        
        log_activity("Seeded airport transfer database", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Database seeded successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
# ========== CATEGORY DISCOUNT MANAGEMENT ==========

@airport_transfer_api_bp.route('/categories/<category_key>/discount', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_category_discount(category_key):
    """Get discount for a specific category"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        # Check if category has a discount stored
        category_discount = current_data[category_key].get('categoryDiscount', None)
        
        if category_discount:
            return jsonify({
                'hasDiscount': True,
                'discount': category_discount
            })
        else:
            return jsonify({'hasDiscount': False})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/discount', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def set_category_discount(category_key):
    """Set discount for all areas in a category"""
    try:
        data = request.json
        discount_type = data.get('discountType')  # 'percentage' or 'fixed'
        discount_value = data.get('value')
        description = data.get('description', '')
        valid_until = data.get('validUntil', '')
        override_area_discounts = data.get('overrideAreaDiscounts', False)
        
        if not discount_type or discount_type not in ['percentage', 'fixed']:
            return jsonify({'error': 'Invalid discount type'}), 400
        
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
        
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        # Get all areas in this category
        areas = current_data[category_key].get('areas', {})
        
        if not areas:
            return jsonify({'error': 'No areas found in this category'}), 400
        
        # Prepare discount data to store at category level
        category_discount_data = {
            'discountType': discount_type,
            'value': str(discount_value),
            'description': description,
            'createdAt': datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'unknown')
        }
        
        if valid_until:
            category_discount_data['validUntil'] = valid_until
        
        # Store discount at category level
        current_data[category_key]['categoryDiscount'] = category_discount_data
        
        # Apply discount to all areas in the category
        for area_key, area_data in areas.items():
            current_prices = area_data.get('prices', {})
            
            # Calculate discounted prices
            discounted_prices = calculate_discounted_prices(current_prices, discount_type, str(discount_value))
            
            # Prepare area discount data
            area_discount_data = {
                'discountType': discount_type,
                'value': str(discount_value),
                'discountedPrice': discounted_prices,
                'createdAt': datetime.now().isoformat(),
                'createdBy': session.get('user_id', 'unknown'),
                'source': 'category',  # Mark this as coming from category discount
                'sourceCategory': category_key
            }
            
            if description:
                area_discount_data['description'] = description
            
            if valid_until:
                area_discount_data['validUntil'] = valid_until
            
            # Check if area already has a discount and whether to override
            if 'discountedPrices' in area_data and not override_area_discounts:
                # Skip if area has existing discount and we're not overriding
                continue
            
            # Apply the discount
            current_data[category_key]['areas'][area_key]['discountedPrices'] = area_discount_data
        
        categories_ref.set(current_data)
        
        log_activity(f"Set category discount for '{category_key}' - {discount_type}: {discount_value}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Category discount applied to all areas successfully',
            'areasAffected': len(areas)
        }), 200
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@airport_transfer_api_bp.route('/categories/<category_key>/discount', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def remove_category_discount(category_key):
    """Remove category discount from all areas in the category"""
    try:
        categories_ref = db.reference('rates/airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        # Remove category-level discount
        if 'categoryDiscount' in current_data[category_key]:
            del current_data[category_key]['categoryDiscount']
        
        # Remove area discounts that came from this category
        areas = current_data[category_key].get('areas', {})
        areas_affected = 0
        
        for area_key, area_data in areas.items():
            if 'discountedPrices' in area_data:
                discount_source = area_data['discountedPrices'].get('source')
                source_category = area_data['discountedPrices'].get('sourceCategory')
                
                # Only remove if the discount came from this category
                if discount_source == 'category' and source_category == category_key:
                    del current_data[category_key]['areas'][area_key]['discountedPrices']
                    areas_affected += 1
        
        categories_ref.set(current_data)
        
        log_activity(f"Removed category discount for '{category_key}', affected {areas_affected} areas", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Category discount removed from {areas_affected} areas',
            'areasAffected': areas_affected
        }), 200
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500