from flask import Blueprint, request, jsonify, session
from functools import wraps
from firebase_admin import db, auth
from datetime import datetime
from backend.decorators import login_required_api, role_required_api

common_users_api_bp = Blueprint('common_users_api', __name__, url_prefix='/common/users')

def get_user_creation_date(uid):
    """Get user creation date from Firebase Auth"""
    try:
        user_record = auth.get_user(uid)
        if user_record.user_metadata.creation_timestamp:
            return datetime.fromtimestamp(user_record.user_metadata.creation_timestamp / 1000).isoformat()
        return None
    except Exception as e:
        print(f"Error getting user creation date for {uid}: {str(e)}")
        return None

@common_users_api_bp.route('')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_users():
    """Get users based on role permissions - Smart created_at fetching"""
    try:
        user_role = session.get('role')
        
        # Get all users from Realtime Database
        users_ref = db.reference('users')
        all_users = users_ref.get()
        
        if not all_users:
            return jsonify({'users': []})
        
        # Track which users need created_at from Auth
        users_needing_auth = []
        users_list = []
        
        # First pass: build list and identify missing created_at
        for uid, user_data in all_users.items():
            user_obj = {
                'id': uid,
                'fullName': user_data.get('fullName', ''),
                'display_name': user_data.get('display_name', ''),
                'email': user_data.get('email', ''),
                'role': user_data.get('role', 'customer'),
                'created_at': user_data.get('created_at', None)
            }
            
            # If created_at is missing, mark for Auth fetch
            if not user_obj['created_at']:
                users_needing_auth.append(uid)
            
            users_list.append(user_obj)
        
        # Batch fetch missing created_at from Firebase Auth
        if users_needing_auth:
            # Process in batches of 10 to respect rate limits
            batch_size = 10
            auth_cache = {}
            
            for i in range(0, len(users_needing_auth), batch_size):
                batch_uids = users_needing_auth[i:i+batch_size]
                for uid in batch_uids:
                    try:
                        user_record = auth.get_user(uid)
                        if user_record.user_metadata.creation_timestamp:
                            created_at = datetime.fromtimestamp(
                                user_record.user_metadata.creation_timestamp / 1000
                            ).isoformat()
                            auth_cache[uid] = created_at
                            
                            # Optional: Backfill the database for future requests
                            # This will update the user record with created_at
                            try:
                                users_ref.child(uid).update({'created_at': created_at})
                                print(f"Backfilled created_at for {uid}")
                            except Exception as backfill_error:
                                print(f"Failed to backfill {uid}: {str(backfill_error)}")
                                
                    except Exception as e:
                        print(f"Error fetching user {uid} from Auth: {str(e)}")
                        auth_cache[uid] = None
            
            # Update users_list with fetched created_at
            for user in users_list:
                if user['id'] in auth_cache and auth_cache[user['id']]:
                    user['created_at'] = auth_cache[user['id']]
        
        # Filter based on role
        if user_role != 'superadmin':
            users_list = [u for u in users_list if u.get('role') == 'customer']
        
        # Add cache headers
        response = jsonify({'users': users_list})
        response.headers['Cache-Control'] = 'private, max-age=30'
        response.headers['Vary'] = 'Cookie'
        
        return response
        
    except Exception as e:
        print(f"ERROR in get_users: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_users_api_bp.route('/<user_id>')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_user(user_id):
    """Get a single user by ID"""
    try:
        user_ref = db.reference(f'users/{user_id}')
        user_data = user_ref.get()
        
        if not user_data:
            return jsonify({'error': 'User not found'}), 404
        
        current_user_role = session.get('role')
        
        # Admin cannot view admin user details
        if current_user_role == 'admin' and user_data.get('role') == 'admin':
            return jsonify({'error': 'Forbidden'}), 403
        
        user_data['id'] = user_id
        user_data.pop('password_hash', None)
        
        # Get creation date from Firebase Auth
        created_at = get_user_creation_date(user_id)
        if created_at:
            user_data['created_at'] = created_at
        
        return jsonify({'user': user_data})
        
    except Exception as e:
        print(f"ERROR in get_user: {str(e)}")
        return jsonify({'error': str(e)}), 500

@common_users_api_bp.route('', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def create_user():
    """Create a new user (customer or admin) - Superadmin only"""
    try:
        data = request.json
        
        if not data.get('email'):
            return jsonify({'error': 'Email is required'}), 400
        if not data.get('fullName'):
            return jsonify({'error': 'Full name is required'}), 400
        if not data.get('role'):
            return jsonify({'error': 'Role is required'}), 400
        if not data.get('password'):
            return jsonify({'error': 'Password is required'}), 400
        
        # RESTRICTION: Cannot create superadmin accounts
        if data['role'] == 'superadmin':
            return jsonify({'error': 'Cannot create Super Administrator accounts'}), 403
        
        if data['role'] not in ['customer', 'admin']:
            return jsonify({'error': 'Role must be "customer" or "admin"'}), 400
        
        if len(data['password']) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        # Check if email already exists
        try:
            existing_user = auth.get_user_by_email(data['email'])
            if existing_user:
                return jsonify({'error': 'Email already exists'}), 400
        except auth.UserNotFoundError:
            pass
        
        # Create user in Firebase Authentication
        user_record = auth.create_user(
            email=data['email'],
            password=data['password'],
            display_name=data['fullName'],
            email_verified=False
        )
        
        # Get creation timestamp
        created_at = datetime.fromtimestamp(
            user_record.user_metadata.creation_timestamp / 1000
        ).isoformat()
        
        # Store user data in Realtime Database WITH created_at
        users_ref = db.reference('users')
        users_ref.child(user_record.uid).set({
            'fullName': data['fullName'],
            'email': data['email'],
            'role': data['role'],
            'created_at': created_at,  # Store created_at in DB
            'created_by': session.get('user_id'),
            'created_by_name': session.get('display_name'),
            'created_at_db': datetime.now().isoformat()
        })
        
        # Log activity
        activities_ref = db.reference('activities')
        activities_ref.push({
            'description': f"Created new {data['role']}: {data['fullName']}",
            'timestamp': datetime.now().isoformat(),
            'user_id': session.get('user_id'),
            'user_name': session.get('display_name')
        })
        
        return jsonify({
            'message': 'User created successfully',
            'user_id': user_record.uid,
            'created_at': created_at
        }), 201
        
    except auth.EmailAlreadyExistsError:
        return jsonify({'error': 'Email already exists'}), 400
    except Exception as e:
        print(f"ERROR in create_user: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@common_users_api_bp.route('/<user_id>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def update_user(user_id):
    """Update a user"""
    try:
        data = request.json
        current_user_role = session.get('role')
        
        user_ref = db.reference(f'users/{user_id}')
        user_data = user_ref.get()
        
        if not user_data:
            return jsonify({'error': 'User not found'}), 404
        
        # Permission check: Admin cannot edit other admin users
        if current_user_role == 'admin' and user_data.get('role') == 'admin':
            return jsonify({'error': 'Admins cannot edit other admin users'}), 403
        
        # Don't allow editing your own role
        if user_id == session.get('user_id') and 'role' in data:
            return jsonify({'error': 'Cannot change your own role'}), 400
        
        # Prepare update data
        update_data = {}
        
        # Handle name update
        if 'fullName' in data:
            update_data['fullName'] = data['fullName']
            # Also update display name in Firebase Auth
            try:
                auth.update_user(user_id, display_name=data['fullName'])
            except Exception as e:
                print(f"Error updating Auth display name: {str(e)}")
        
        # Handle email update
        if 'email' in data:
            update_data['email'] = data['email']
            # Update email in Firebase Auth
            try:
                auth.update_user(user_id, email=data['email'])
            except Exception as e:
                print(f"Error updating Auth email: {str(e)}")
        
        # ========== ROLE CHANGE HANDLING ==========
        # Only process role changes if:
        # 1. The request includes a 'role' field
        # 2. The role value is different from the current role
        # 3. The user making the request is superadmin
        if 'role' in data and data['role'] is not None:
            new_role = data['role']
            current_target_role = user_data.get('role')
            
            # Only superadmin can change roles
            if current_user_role != 'superadmin':
                return jsonify({'error': 'Only Super Administrators can change user roles'}), 403
            
            # Validate role is allowed
            if new_role not in ['customer', 'admin']:
                return jsonify({'error': 'Role must be "customer" or "admin"'}), 400
            
            # Cannot change a superadmin's role
            if current_target_role == 'superadmin':
                return jsonify({'error': 'Cannot change the role of a Super Administrator'}), 403
            
            # Cannot promote to superadmin
            if new_role == 'superadmin':
                return jsonify({'error': 'Cannot promote users to Super Administrator'}), 403
            
            # Only update if role actually changed
            if new_role != current_target_role:
                update_data['role'] = new_role
        
        # Only proceed with update if there's something to update
        if update_data:
            update_data['updated_at'] = datetime.now().isoformat()
            update_data['updated_by'] = session.get('user_id')
            update_data['updated_by_name'] = session.get('display_name')
            
            # Update user in Realtime Database
            user_ref.update(update_data)
            
            # Log activity
            activities_ref = db.reference('activities')
            activities_ref.push({
                'description': f"Updated user: {user_data.get('fullName', user_id)}",
                'timestamp': datetime.now().isoformat(),
                'user_id': session.get('user_id'),
                'user_name': session.get('display_name')
            })
            
            return jsonify({'message': 'User updated successfully'})
        else:
            return jsonify({'message': 'No changes to apply'}), 200
        
    except Exception as e:
        print(f"ERROR in update_user: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@common_users_api_bp.route('/<user_id>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def delete_user(user_id):
    """Delete a user"""
    try:
        # Don't allow deleting yourself
        if user_id == session.get('user_id'):
            return jsonify({'error': 'Cannot delete your own account'}), 400
        
        user_ref = db.reference(f'users/{user_id}')
        user_data = user_ref.get()
        
        if not user_data:
            return jsonify({'error': 'User not found'}), 404
        
        current_user_role = session.get('role')
        
        # Admin cannot delete admin users
        if current_user_role == 'admin' and user_data.get('role') == 'admin':
            return jsonify({'error': 'Admins cannot delete other admin users'}), 403
        
        user_name = user_data.get('fullName', 'Unknown')
        
        # Delete user from Firebase Auth
        try:
            auth.delete_user(user_id)
        except Exception as e:
            print(f"Error deleting user from Auth: {str(e)}")
            # Continue with database deletion even if Auth fails
        
        # Delete user from Realtime Database
        user_ref.delete()
        
        # Log activity
        activities_ref = db.reference('activities')
        activities_ref.push({
            'description': f"Deleted user: {user_name}",
            'timestamp': datetime.now().isoformat(),
            'user_id': session.get('user_id'),
            'user_name': session.get('display_name')
        })
        
        return jsonify({'message': 'User deleted'})
        
    except Exception as e:
        print(f"ERROR in delete_user: {str(e)}")
        return jsonify({'error': str(e)}), 500

@common_users_api_bp.route('/<user_id>/reset-password', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def reset_user_password(user_id):
    """Reset user password - Superadmin only"""
    try:
        data = request.json
        new_password = data.get('password')
        
        if not new_password:
            return jsonify({'error': 'New password is required'}), 400
        
        if len(new_password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        # Update password in Firebase Auth
        auth.update_user(user_id, password=new_password)
        
        # Log activity
        activities_ref = db.reference('activities')
        activities_ref.push({
            'description': f"Reset password for user: {user_id}",
            'timestamp': datetime.now().isoformat(),
            'user_id': session.get('user_id'),
            'user_name': session.get('display_name')
        })
        
        return jsonify({'message': 'Password reset successfully'}), 200
        
    except Exception as e:
        print(f"ERROR in reset_user_password: {str(e)}")
        return jsonify({'error': str(e)}), 500