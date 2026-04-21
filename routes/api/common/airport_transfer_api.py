from flask import Blueprint, request, jsonify, session
from functools import wraps
from firebase_admin import db
from datetime import datetime

airport_transfer_api_bp = Blueprint('airport_transfer_api', __name__, url_prefix='/common/airport-transfer')

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

# ========== CATEGORY MANAGEMENT ==========

@airport_transfer_api_bp.route('/categories', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_categories():
    """Get all categories with their areas and prices"""
    try:
        categories_ref = db.reference('airportTransfer')
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
        
        # Get all packages
        all_packages = get_all_packages()
        
        if not all_packages:
            return jsonify({'error': 'No packages found. Please create packages first.'}), 400
        
        # Initialize prices for all packages to "0" as STRING
        initial_prices = {}
        for pkg in all_packages:
            initial_prices[pkg] = "0"  # ← Store as string
        
        # Create category with area and prices
        category_key = category_name.lower().replace(' ', '_')
        area_key = area_name.lower().replace(' ', '_')
        
        categories_ref = db.reference('airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key in current_data:
            return jsonify({'error': f'Category "{category_name}" already exists'}), 400
        
        # Build the structure
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
def delete_category(category_key):
    """Delete a category and all its areas"""
    try:
        categories_ref = db.reference('airportTransfer')
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
def toggle_category(category_key):
    """Toggle category active status"""
    try:
        categories_ref = db.reference('airportTransfer')
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
def add_area(category_key):
    """Add a new area to a category with all packages set to "0" as string"""
    try:
        data = request.json
        area_name = data.get('name', '').strip()
        
        if not area_name:
            return jsonify({'error': 'Area name is required'}), 400
        
        # Get all packages
        all_packages = get_all_packages()
        
        if not all_packages:
            return jsonify({'error': 'No packages found. Please create packages first.'}), 400
        
        # Initialize prices for all packages to "0" as STRING
        initial_prices = {}
        for pkg in all_packages:
            initial_prices[pkg] = "0"  # ← Store as string
        
        categories_ref = db.reference('airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': f'Category "{category_key}" not found'}), 404
        
        area_key = area_name.lower().replace(' ', '_')
        
        if 'areas' not in current_data[category_key]:
            current_data[category_key]['areas'] = {}
        
        if area_key in current_data[category_key]['areas']:
            return jsonify({'error': f'Area "{area_name}" already exists'}), 400
        
        # Add new area with prices as strings
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
def delete_area(category_key, area_key):
    """Delete an area from a category"""
    try:
        categories_ref = db.reference('airportTransfer')
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
def get_prices(category_key, area_key):
    """Get prices for a specific area"""
    try:
        categories_ref = db.reference('airportTransfer')
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
def update_prices(category_key, area_key):
    """Update prices for a specific area - store as strings"""
    try:
        data = request.json
        prices = data.get('prices', {})
        
        # Convert all prices to strings
        prices_as_strings = {}
        for pkg_name, price_value in prices.items():
            prices_as_strings[pkg_name] = str(price_value)  # ← Store as string
        
        categories_ref = db.reference('airportTransfer')
        current_data = categories_ref.get() or {}
        
        if category_key not in current_data:
            return jsonify({'error': 'Category not found'}), 404
        
        if 'areas' not in current_data[category_key]:
            return jsonify({'error': 'Area not found'}), 404
        
        if area_key not in current_data[category_key]['areas']:
            return jsonify({'error': 'Area not found'}), 404
        
        current_data[category_key]['areas'][area_key]['prices'] = prices_as_strings
        categories_ref.set(current_data)
        
        log_activity(f"Updated prices for area '{area_key}' in category '{category_key}'", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Prices updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== GET ALL PACKAGES ==========

@airport_transfer_api_bp.route('/packages')
@login_required_api
@role_required_api(['superadmin', 'admin'])
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
def get_matrix():
    """Get complete fare matrix for display"""
    try:
        # Get packages
        packages_ref = db.reference('packages')
        all_packages = packages_ref.get() or {}
        
        packages_list = []
        for pkg_id, pkg_data in all_packages.items():
            packages_list.append({
                'id': pkg_id,
                'name': pkg_data.get('packageName', '')
            })
        
        # Get categories
        categories_ref = db.reference('airportTransfer')
        all_categories = categories_ref.get() or {}
        
        matrix = []
        for cat_key, cat_data in all_categories.items():
            areas_dict = {}
            areas_data = cat_data.get('areas', {})
            
            for area_key, area_data in areas_data.items():
                areas_dict[area_key] = {
                    'name': area_data.get('name', area_key),
                    'prices': area_data.get('prices', {})
                }
            
            matrix.append({
                'key': cat_key,
                'name': cat_data.get('name', cat_key),
                'isActive': cat_data.get('isActive', True),
                'areas': areas_dict
            })
        
        return jsonify({
            'packages': packages_list,
            'matrix': matrix
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ========== SEED DATABASE ==========

@airport_transfer_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def seed_database():
    """Seed the database with sample data - prices as strings"""
    try:
        # Get all packages
        all_packages = get_all_packages()
        
        if not all_packages:
            return jsonify({'error': 'No packages found. Please create packages first.'}), 400
        
        # Initialize prices to "0" as STRINGS
        initial_prices = {}
        for pkg in all_packages:
            initial_prices[pkg] = "0"  # ← Store as string
        
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
        
        categories_ref = db.reference('airportTransfer')
        categories_ref.set(sample_data)
        
        log_activity("Seeded airport transfer database", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Database seeded successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500