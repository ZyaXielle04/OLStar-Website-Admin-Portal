from flask import Blueprint, render_template, request, jsonify, session
from functools import wraps
from firebase_admin import db
from datetime import datetime
import re
import random
import string
import cloudinary.uploader
import cloudinary.utils

common_transport_units_api_bp = Blueprint('common_transport_units_api', __name__, url_prefix='/common/transport-units')

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

def generate_unit_id():
    """Generate a unique Unit ID in format: XXXYYY (3 uppercase letters + 3 numbers)"""
    while True:
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))
        numbers = ''.join(random.choices(string.digits, k=3))
        unit_id = f"{letters}{numbers}"
        
        unit_ref = db.reference(f'transportUnits/{unit_id}')
        existing = unit_ref.get()
        
        if not existing:
            return unit_id

def upload_image_to_cloudinary(file, unit_id):
    """Upload image to Cloudinary directly (no preset needed)"""
    try:
        print(f"Uploading image for unit: {unit_id}")
        print(f"File name: {file.filename}")
        
        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        if file.content_type not in allowed_types:
            raise ValueError('Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.')
        
        # Validate file size (max 5MB)
        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > 5 * 1024 * 1024:
            raise ValueError('File size too large. Maximum 5MB allowed.')
        
        # Direct upload to Cloudinary
        upload_result = cloudinary.uploader.upload(
            file,
            folder=f"transport_units/{unit_id}",
            public_id=f"unit_image",
            overwrite=True
        )
        
        secure_url = upload_result.get('secure_url')
        print(f"Upload successful! URL: {secure_url}")
        return secure_url
        
    except Exception as e:
        print(f"Error uploading to Cloudinary: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

@common_transport_units_api_bp.route('')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_transport_units():
    """Get all transport units - Both roles can read"""
    try:
        units_ref = db.reference('transportUnits')
        all_units = units_ref.get()
        
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
                'isAvailable': unit_data.get('isAvailable', True),
                'imageUrl': unit_data.get('imageUrl', None),
                'created_at': unit_data.get('created_at'),
                'created_by': unit_data.get('created_by'),
                'created_by_name': unit_data.get('created_by_name'),
                'updated_at': unit_data.get('updated_at'),
                'updated_by': unit_data.get('updated_by'),
                'updated_by_name': unit_data.get('updated_by_name')
            })
        
        return jsonify({'units': units_list})
        
    except Exception as e:
        print(f"ERROR in get_transport_units: {str(e)}")
        return jsonify({'error': str(e)}), 500

@common_transport_units_api_bp.route('/<unit_id>')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_transport_unit(unit_id):
    """Get a single transport unit - Both roles can read"""
    try:
        unit_ref = db.reference(f'transportUnits/{unit_id}')
        unit_data = unit_ref.get()
        
        if not unit_data:
            return jsonify({'error': 'Transport unit not found'}), 404
        
        unit_data['id'] = unit_id
        
        return jsonify({'unit': unit_data})
        
    except Exception as e:
        print(f"ERROR in get_transport_unit: {str(e)}")
        return jsonify({'error': str(e)}), 500

@common_transport_units_api_bp.route('', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def create_transport_unit():
    """Create a new transport unit - Superadmin only (Unit ID auto-generated)"""
    try:
        print("=== CREATE TRANSPORT UNIT ===")
        
        # Handle FormData with file upload
        if request.files and 'image' in request.files:
            data = request.form
            image_file = request.files.get('image')
            print("Processing FormData with image")
        else:
            data = request.json if request.is_json else request.form
            image_file = None
            print("Processing JSON or empty form data")
        
        # Validate required fields
        required_fields = ['color', 'plateNumber', 'transportUnit', 'unitType']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'error': f'{field} is required'}), 400
        
        # Auto-generate unique Unit ID
        unit_id = generate_unit_id()
        print(f"Generated Unit ID: {unit_id}")
        
        # Validate unit type
        valid_unit_types = ['Van', 'SUV', 'Sedan']
        if data['unitType'] not in valid_unit_types:
            return jsonify({'error': f'Unit type must be one of: {", ".join(valid_unit_types)}'}), 400
        
        # Upload image to Cloudinary if provided
        image_url = None
        if image_file and image_file.filename:
            print(f"Image file detected: {image_file.filename}")
            try:
                image_url = upload_image_to_cloudinary(image_file, unit_id)
                if image_url:
                    print(f"Image uploaded successfully: {image_url}")
                else:
                    print("Image upload failed")
            except ValueError as e:
                return jsonify({'error': str(e)}), 400
        else:
            print("No image file provided")
        
        # Create new transport unit
        new_unit = {
            'color': data['color'].strip(),
            'plateNumber': data['plateNumber'].strip().upper(),
            'transportUnit': data['transportUnit'].strip(),
            'unitType': data['unitType'],
            'isAvailable': data.get('isAvailable', 'true') == 'true',
            'imageUrl': image_url,
            'created_at': datetime.now().isoformat(),
            'created_by': session.get('user_id'),
            'created_by_name': session.get('display_name')
        }
        
        print(f"Saving to RTDB: {new_unit}")
        
        # Save to database
        unit_ref = db.reference(f'transportUnits/{unit_id}')
        unit_ref.set(new_unit)
        
        # Log activity - ADD THIS
        log_activity(
            f"Created transport unit: {unit_id} - {data['transportUnit']}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({
            'message': 'Transport unit created successfully',
            'unit_id': unit_id,
            'unit': new_unit,
            'image_url': image_url
        }), 201
        
    except Exception as e:
        print(f"ERROR in create_transport_unit: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_transport_units_api_bp.route('/<unit_id>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_transport_unit(unit_id):
    """Update a transport unit - Superadmin only"""
    try:
        print(f"=== UPDATE TRANSPORT UNIT: {unit_id} ===")
        
        # Handle FormData with file upload
        if request.files and 'image' in request.files:
            data = request.form
            image_file = request.files.get('image')
            print("Processing FormData with image")
        else:
            data = request.json if request.is_json else request.form
            image_file = None
            print("Processing JSON or empty form data")
        
        unit_ref = db.reference(f'transportUnits/{unit_id}')
        existing = unit_ref.get()
        
        if not existing:
            return jsonify({'error': 'Transport unit not found'}), 404
        
        # Prepare update data
        update_data = {}
        
        if 'color' in data:
            update_data['color'] = data['color'].strip()
        
        if 'plateNumber' in data:
            update_data['plateNumber'] = data['plateNumber'].strip().upper()
        
        if 'transportUnit' in data:
            update_data['transportUnit'] = data['transportUnit'].strip()
        
        if 'unitType' in data:
            valid_unit_types = ['Van', 'SUV', 'Sedan']
            if data['unitType'] not in valid_unit_types:
                return jsonify({'error': f'Unit type must be one of: {", ".join(valid_unit_types)}'}), 400
            update_data['unitType'] = data['unitType']
        
        if 'isAvailable' in data:
            update_data['isAvailable'] = data['isAvailable'] == 'true' or data['isAvailable'] == True
        
        # Handle image upload
        if image_file and image_file.filename:
            print(f"Image file detected: {image_file.filename}")
            try:
                image_url = upload_image_to_cloudinary(image_file, unit_id)
                if image_url:
                    update_data['imageUrl'] = image_url
                    print(f"Image uploaded successfully: {image_url}")
                else:
                    print("Image upload failed")
            except ValueError as e:
                return jsonify({'error': str(e)}), 400
        
        # Handle image removal
        if 'removeImage' in data and data['removeImage'] == 'true':
            update_data['imageUrl'] = None
            print("Removing image")
        
        update_data['updated_at'] = datetime.now().isoformat()
        update_data['updated_by'] = session.get('user_id')
        update_data['updated_by_name'] = session.get('display_name')
        
        print(f"Updating RTDB with: {update_data}")
        
        # Update the unit
        unit_ref.update(update_data)
        
        # Log activity - ADD THIS
        log_activity(
            f"Updated transport unit: {unit_id} - {update_data.get('transportUnit', existing.get('transportUnit', ''))}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({'message': 'Transport unit updated successfully'})
        
    except Exception as e:
        print(f"ERROR in update_transport_unit: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_transport_units_api_bp.route('/<unit_id>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_transport_unit(unit_id):
    """Delete a transport unit - Superadmin only"""
    try:
        unit_ref = db.reference(f'transportUnits/{unit_id}')
        existing = unit_ref.get()
        
        if not existing:
            return jsonify({'error': 'Transport unit not found'}), 404
        
        unit_name = existing.get('transportUnit', unit_id)
        
        unit_ref.delete()
        
        # Log activity - ADD THIS
        log_activity(
            f"Deleted transport unit: {unit_id} - {unit_name}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({'message': 'Transport unit deleted successfully'})
        
    except Exception as e:
        print(f"ERROR in delete_transport_unit: {str(e)}")
        return jsonify({'error': str(e)}), 500

@common_transport_units_api_bp.route('/<unit_id>/toggle-availability', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
def toggle_availability(unit_id):
    """Toggle unit availability - Superadmin only"""
    try:
        unit_ref = db.reference(f'transportUnits/{unit_id}')
        existing = unit_ref.get()
        
        if not existing:
            return jsonify({'error': 'Transport unit not found'}), 404
        
        new_status = not existing.get('isAvailable', True)
        
        unit_ref.update({
            'isAvailable': new_status,
            'updated_at': datetime.now().isoformat(),
            'updated_by': session.get('user_id'),
            'updated_by_name': session.get('display_name')
        })
        
        status_text = "available" if new_status else "unavailable"
        
        # Log activity - ADD THIS
        log_activity(
            f"Marked transport unit {unit_id} as {status_text}",
            session.get('user_id'),
            session.get('display_name')
        )
        
        return jsonify({
            'message': f'Transport unit is now {status_text}',
            'isAvailable': new_status
        })
        
    except Exception as e:
        print(f"ERROR in toggle_availability: {str(e)}")
        return jsonify({'error': str(e)}), 500