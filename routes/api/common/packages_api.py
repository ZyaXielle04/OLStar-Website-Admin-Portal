from flask import Blueprint, request, jsonify, session
from functools import wraps
from firebase_admin import db
from datetime import datetime
import random
import string

common_packages_api_bp = Blueprint('common_packages_api', __name__, url_prefix='/common/packages')

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

def generate_package_id():
    """Generate a unique Package ID in format: PKGXXX (PKG + 3 random uppercase letters)"""
    while True:
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))
        package_id = f"PKG{letters}"
        
        package_ref = db.reference(f'packages/{package_id}')
        existing = package_ref.get()
        
        if not existing:
            return package_id

def log_activity(description, user_id, user_name):
    """Helper function to log activities to Realtime Database"""
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

@common_packages_api_bp.route('')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_packages():
    """Get all packages - Both roles can read"""
    try:
        packages_ref = db.reference('packages')
        all_packages = packages_ref.get()
        
        if not all_packages:
            return jsonify({'packages': []})
        
        packages_list = []
        for package_id, package_data in all_packages.items():
            # Get transport units - ensure it's a list
            transport_units = package_data.get('transportUnits', [])
            
            # Convert dict to list if needed
            if isinstance(transport_units, dict):
                new_list = []
                for key, unit_data in transport_units.items():
                    if isinstance(unit_data, dict):
                        new_list.append(unit_data)
                transport_units = new_list
            elif transport_units is None:
                transport_units = []
            elif not isinstance(transport_units, list):
                transport_units = []
            
            packages_list.append({
                'id': package_id,
                'packageName': package_data.get('packageName', ''),
                'maxPax': package_data.get('maxPax', 0),
                'maxLuggage': package_data.get('maxLuggage', 0),
                'transportUnits': transport_units,
                'unitCount': len(transport_units),
                'created_at': package_data.get('created_at'),
                'created_by': package_data.get('created_by'),
                'created_by_name': package_data.get('created_by_name'),
                'updated_at': package_data.get('updated_at'),
                'updated_by': package_data.get('updated_by'),
                'updated_by_name': package_data.get('updated_by_name')
            })
        
        return jsonify({'packages': packages_list})
        
    except Exception as e:
        print(f"ERROR in get_packages: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_packages_api_bp.route('/<package_id>')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_package(package_id):
    """Get a single package - Both roles can read"""
    try:
        package_ref = db.reference(f'packages/{package_id}')
        package_data = package_ref.get()
        
        if not package_data:
            return jsonify({'error': 'Package not found'}), 404
        
        # Get transport units - ensure it's a list
        transport_units = package_data.get('transportUnits', [])
        
        # Convert dict to list if needed
        if isinstance(transport_units, dict):
            new_list = []
            for key, unit_data in transport_units.items():
                if isinstance(unit_data, dict):
                    new_list.append(unit_data)
            transport_units = new_list
        elif transport_units is None:
            transport_units = []
        elif not isinstance(transport_units, list):
            transport_units = []
        
        package_data['id'] = package_id
        package_data['transportUnits'] = transport_units
        package_data['unitCount'] = len(transport_units)
        
        return jsonify({'package': package_data})
        
    except Exception as e:
        print(f"ERROR in get_package: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_packages_api_bp.route('', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def create_package():
    """Create a new package - Superadmin only"""
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['packageName', 'maxPax', 'maxLuggage']
        for field in required_fields:
            if data.get(field) is None:
                return jsonify({'error': f'{field} is required'}), 400
        
        # Validate maxPax
        try:
            max_pax = int(data['maxPax'])
            if max_pax < 1:
                return jsonify({'error': 'Max Pax must be at least 1'}), 400
        except ValueError:
            return jsonify({'error': 'Max Pax must be a valid number'}), 400
        
        # Validate maxLuggage
        try:
            max_luggage = int(data['maxLuggage'])
            if max_luggage < 0:
                return jsonify({'error': 'Max Luggage cannot be negative'}), 400
        except ValueError:
            return jsonify({'error': 'Max Luggage must be a valid number'}), 400
        
        # Auto-generate unique Package ID
        package_id = generate_package_id()
        
        # Create new package
        new_package = {
            'packageName': data['packageName'].strip(),
            'maxPax': max_pax,
            'maxLuggage': max_luggage,
            'transportUnits': {},
            'created_at': datetime.now().isoformat(),
            'created_by': session.get('user_id'),
            'created_by_name': session.get('display_name')
        }
        
        # Save to database
        package_ref = db.reference(f'packages/{package_id}')
        package_ref.set(new_package)
        
        # Log activity
        log_activity(
            f"Created package: {package_id} - {data['packageName']} (Max Pax: {max_pax}, Max Luggage: {max_luggage})",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({
            'message': 'Package created successfully',
            'package_id': package_id,
            'package': new_package
        }), 201
        
    except Exception as e:
        print(f"ERROR in create_package: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_packages_api_bp.route('/<package_id>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_package(package_id):
    """Update a package - Superadmin only"""
    try:
        data = request.json
        
        package_ref = db.reference(f'packages/{package_id}')
        existing = package_ref.get()
        
        if not existing:
            return jsonify({'error': 'Package not found'}), 404
        
        # Prepare update data
        update_data = {}
        
        if 'packageName' in data:
            update_data['packageName'] = data['packageName'].strip()
        
        if 'maxPax' in data:
            try:
                max_pax = int(data['maxPax'])
                if max_pax < 1:
                    return jsonify({'error': 'Max Pax must be at least 1'}), 400
                update_data['maxPax'] = max_pax
            except ValueError:
                return jsonify({'error': 'Max Pax must be a valid number'}), 400
        
        if 'maxLuggage' in data:
            try:
                max_luggage = int(data['maxLuggage'])
                if max_luggage < 0:
                    return jsonify({'error': 'Max Luggage cannot be negative'}), 400
                update_data['maxLuggage'] = max_luggage
            except ValueError:
                return jsonify({'error': 'Max Luggage must be a valid number'}), 400
        
        update_data['updated_at'] = datetime.now().isoformat()
        update_data['updated_by'] = session.get('user_id')
        update_data['updated_by_name'] = session.get('display_name')
        
        # Update the package
        package_ref.update(update_data)
        
        # Log activity
        log_activity(
            f"Updated package: {package_id}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({'message': 'Package updated successfully'})
        
    except Exception as e:
        print(f"ERROR in update_package: {str(e)}")
        return jsonify({'error': str(e)}), 500

@common_packages_api_bp.route('/<package_id>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_package(package_id):
    """Delete a package - Superadmin only"""
    try:
        package_ref = db.reference(f'packages/{package_id}')
        existing = package_ref.get()
        
        if not existing:
            return jsonify({'error': 'Package not found'}), 404
        
        package_name = existing.get('packageName', package_id)
        
        package_ref.delete()
        
        # Log activity
        log_activity(
            f"Deleted package: {package_id} - {package_name}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({'message': 'Package deleted successfully'})
        
    except Exception as e:
        print(f"ERROR in delete_package: {str(e)}")
        return jsonify({'error': str(e)}), 500

@common_packages_api_bp.route('/<package_id>/add-unit', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def add_transport_unit_to_package(package_id):
    """Add a transport unit to a package - Superadmin only"""
    try:
        data = request.json
        transport_unit_id = data.get('transportUnitId')
        
        if not transport_unit_id:
            return jsonify({'error': 'Transport Unit ID is required'}), 400
        
        print(f"Adding unit {transport_unit_id} to package {package_id}")
        
        # Check if package exists
        package_ref = db.reference(f'packages/{package_id}')
        package_data = package_ref.get()
        
        if not package_data:
            return jsonify({'error': 'Package not found'}), 404
        
        # Check if transport unit exists
        unit_ref = db.reference(f'transportUnits/{transport_unit_id}')
        unit_data = unit_ref.get()
        
        if not unit_data:
            return jsonify({'error': 'Transport unit not found'}), 404
        
        # Get current transport units - force to list
        transport_units = package_data.get('transportUnits', [])
        
        # If it's None, make it an empty list
        if transport_units is None:
            transport_units = []
        
        # If it's a dictionary, convert to list
        if isinstance(transport_units, dict):
            new_list = []
            for key, unit in transport_units.items():
                if isinstance(unit, dict):
                    new_list.append(unit)
            transport_units = new_list
        
        # If it's not a list, make it an empty list
        if not isinstance(transport_units, list):
            transport_units = []
        
        # Check if unit already exists in package
        already_exists = False
        for unit in transport_units:
            if isinstance(unit, dict) and unit.get('transportUnitId') == transport_unit_id:
                already_exists = True
                break
        
        if already_exists:
            return jsonify({'error': 'Transport unit already added to this package'}), 400
        
        # Create new unit entry
        new_unit_entry = {
            'transportUnitId': transport_unit_id,
            'color': unit_data.get('color', ''),
            'transportUnit': unit_data.get('transportUnit', ''),
            'plateNumber': unit_data.get('plateNumber', ''),
            'unitType': unit_data.get('unitType', ''),
            'isAvailable': unit_data.get('isAvailable', True)
        }
        
        # Add to list
        transport_units.append(new_unit_entry)
        
        # Save back to database
        package_ref.child('transportUnits').set(transport_units)
        
        # Log activity
        log_activity(
            f"Added transport unit {transport_unit_id} to package {package_id}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({
            'message': 'Transport unit added to package successfully',
            'unit': new_unit_entry
        }), 200
        
    except Exception as e:
        print(f"ERROR in add_transport_unit_to_package: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_packages_api_bp.route('/<package_id>/remove-unit/<transport_unit_id>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def remove_transport_unit_from_package(package_id, transport_unit_id):
    """Remove a transport unit from a package - Superadmin only"""
    try:
        print(f"Removing unit {transport_unit_id} from package {package_id}")
        
        package_ref = db.reference(f'packages/{package_id}')
        package_data = package_ref.get()
        
        if not package_data:
            return jsonify({'error': 'Package not found'}), 404
        
        # Get transport units - force to list
        transport_units = package_data.get('transportUnits', [])
        
        # If it's None, make it an empty list
        if transport_units is None:
            transport_units = []
        
        # If it's a dictionary, convert to list
        if isinstance(transport_units, dict):
            new_list = []
            for key, unit in transport_units.items():
                if isinstance(unit, dict):
                    new_list.append(unit)
            transport_units = new_list
        
        # If it's not a list, make it an empty list
        if not isinstance(transport_units, list):
            transport_units = []
        
        if not transport_units:
            return jsonify({'error': 'No transport units found in this package'}), 404
        
        # Find and remove the unit
        unit_index_to_remove = None
        for index, unit in enumerate(transport_units):
            if isinstance(unit, dict) and unit.get('transportUnitId') == transport_unit_id:
                unit_index_to_remove = index
                break
        
        if unit_index_to_remove is None:
            return jsonify({'error': f'Transport unit {transport_unit_id} not found in this package'}), 404
        
        # Remove from list
        removed_unit = transport_units.pop(unit_index_to_remove)
        
        # Save back to database
        package_ref.child('transportUnits').set(transport_units)
        
        # Log activity
        log_activity(
            f"Removed transport unit {transport_unit_id} from package {package_id}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({'message': 'Transport unit removed from package successfully'}), 200
        
    except Exception as e:
        print(f"ERROR in remove_transport_unit_from_package: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_packages_api_bp.route('/available-units')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_available_transport_units():
    """Get all transport units for assigning to packages - Both roles can read"""
    try:
        transport_ref = db.reference('transportUnits')
        all_units = transport_ref.get()
        
        if not all_units:
            return jsonify({'units': []})
        
        units_list = []
        for unit_id, unit_data in all_units.items():
            units_list.append({
                'id': unit_id,
                'color': unit_data.get('color', ''),
                'plateNumber': unit_data.get('plateNumber', ''),
                'transportUnit': unit_data.get('transportUnit', ''),
                'unitType': unit_data.get('unitType', ''),
                'isAvailable': unit_data.get('isAvailable', True)
            })
        
        return jsonify({'units': units_list})
        
    except Exception as e:
        print(f"ERROR in get_available_transport_units: {str(e)}")
        return jsonify({'error': str(e)}), 500