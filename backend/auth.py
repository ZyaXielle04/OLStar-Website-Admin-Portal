import os
import requests
from flask import Blueprint, request, jsonify, session, current_app
from flask_limiter.util import get_remote_address
from firebase_admin import auth, db
from functools import wraps

# Create blueprint (NO local limiter instance here)
auth_bp = Blueprint('auth', __name__, url_prefix='/api/v1/auth')

# Get Firebase Web API Key from environment
FIREBASE_WEB_API_KEY = os.getenv("FIREBASE_API_KEY")
if not FIREBASE_WEB_API_KEY:
    raise RuntimeError("FIREBASE_API_KEY must be set in environment")

# ============================================
# HELPER FUNCTIONS FOR YOUR RTDB STRUCTURE
# ============================================

def get_user_role(uid):
    """Get user role from your Realtime Database structure"""
    try:
        # Reference to specific user in your RTDB
        user_ref = db.reference(f'users/{uid}')
        user_data = user_ref.get()
        
        if user_data and 'role' in user_data:
            role = user_data.get('role')
            # Allow all valid roles
            if role in ['superadmin', 'admin', 'customer']:
                return role
        
        # Default to customer (least privilege) if role not found or invalid
        return 'customer'
    except Exception as e:
        current_app.logger.error(f'Error getting user role from RTDB: {str(e)}')
        return 'customer'  # Default to customer on error


def is_user_active(uid):
    """Check if user is active in your database"""
    try:
        user_ref = db.reference(f'users/{uid}')
        user_data = user_ref.get()
        
        if user_data and 'isActive' in user_data:
            return user_data.get('isActive') == True
        
        # Default to True if isActive not set (as per your default)
        return True
    except Exception as e:
        current_app.logger.error(f'Error checking user active status: {str(e)}')
        return True  # Default to active on error


def get_user_full_name(uid):
    """Get user's full name from your database"""
    try:
        user_ref = db.reference(f'users/{uid}')
        user_data = user_ref.get()
        
        if user_data and 'fullName' in user_data:
            return user_data.get('fullName')
        
        return None
    except Exception as e:
        current_app.logger.error(f'Error getting user full name: {str(e)}')
        return None


def update_user_last_login(uid):
    """Update user's last login timestamp (optional - add to your schema)"""
    try:
        # If you have a lastLogin field, update it
        # If not, you can skip this or add it to your schema
        user_ref = db.reference(f'users/{uid}')
        user_ref.update({
            'lastLogin': {'.sv': 'timestamp'}  # Firebase server timestamp
        })
        return True
    except Exception as e:
        current_app.logger.error(f'Error updating last login: {str(e)}')
        return False


# ============================================
# CUSTOM DECORATORS
# ============================================

def login_required_api(f):
    """Decorator for API routes - returns JSON error if not authenticated"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'message': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function


def role_required(allowed_roles):
    """Decorator to check if user has allowed role"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'role' not in session:
                return jsonify({'message': 'Access denied'}), 403
            if session['role'] not in allowed_roles:
                return jsonify({'message': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ============================================
# AUTHENTICATION ROUTES
# ============================================

@auth_bp.route('/login', methods=['POST'])
def login():
    """Authenticate user with email and password"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400
            
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        # Validate input
        if not email:
            return jsonify({'message': 'Email is required'}), 400
        if not password:
            return jsonify({'message': 'Password is required'}), 400
        
        # Call Firebase REST API to sign in
        url = f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_WEB_API_KEY}'
        
        payload = {
            'email': email,
            'password': password,
            'returnSecureToken': True
        }
        
        response = requests.post(url, json=payload, timeout=10)
        user_data = response.json()
        
        if response.status_code == 200:
            # Get user record from Firebase Admin
            try:
                user_record = auth.get_user_by_email(email)
            except auth.UserNotFoundError:
                return jsonify({'message': 'Invalid credentials'}), 401
            
            # Check if user is active in your database
            if not is_user_active(user_record.uid):
                return jsonify({'message': 'Your account has been deactivated. Please contact your portal administrator for assistance.'}), 401
            
            # Get user role from your RTDB
            role = get_user_role(user_record.uid)
            
            # Get user's full name
            full_name = get_user_full_name(user_record.uid) or user_record.display_name or email.split('@')[0]
            
            # Update last login timestamp (if you have this field)
            update_user_last_login(user_record.uid)
            
            # Create server-side session
            session.clear()
            session['user_id'] = user_record.uid
            session['email'] = user_record.email
            session['display_name'] = full_name
            session['role'] = role
            session.permanent = True
            
            # Return success response
            return jsonify({
                'success': True,
                'sessionToken': user_data.get('idToken'),
                'user': {
                    'uid': user_record.uid,
                    'email': user_record.email,
                    'displayName': full_name,
                    'emailVerified': user_record.email_verified,
                    'role': role
                }
            }), 200
            
        else:
            # Handle Firebase authentication errors
            error_message = user_data.get('error', {}).get('message', 'Authentication failed')
            
            if 'INVALID_PASSWORD' in error_message:
                return jsonify({'message': 'Invalid email or password'}), 401
            elif 'EMAIL_NOT_FOUND' in error_message:
                return jsonify({'message': 'Invalid email or password'}), 401
            elif 'USER_DISABLED' in error_message:
                return jsonify({'message': 'Account is disabled in Firebase. Contact administrator'}), 403
            elif 'TOO_MANY_ATTEMPTS_TRY_LATER' in error_message:
                return jsonify({'message': 'Too many failed attempts. Please try again later'}), 429
            else:
                current_app.logger.error(f'Firebase auth error: {error_message}')
                return jsonify({'message': 'Authentication failed. Please try again'}), 401
                
    except requests.exceptions.Timeout:
        return jsonify({'message': 'Request timeout. Please try again'}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({'message': 'Network error. Please check your connection'}), 503
    except Exception as e:
        current_app.logger.error(f'Login error: {str(e)}')
        return jsonify({'message': 'An internal error occurred. Please try again'}), 500


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Logout user and clear session"""
    try:
        session.clear()
        return jsonify({'message': 'Logged out successfully'}), 200
    except Exception as e:
        current_app.logger.error(f'Logout error: {str(e)}')
        return jsonify({'message': 'Logout failed'}), 500


@auth_bp.route('/me', methods=['GET'])
@login_required_api
def get_current_user():
    """Get current authenticated user information"""
    try:
        user_id = session.get('user_id')
        user_record = auth.get_user(user_id)
        
        # Get additional data from your RTDB
        role = get_user_role(user_id)
        full_name = get_user_full_name(user_id)
        is_active = is_user_active(user_id)
        
        return jsonify({
            'uid': user_record.uid,
            'email': user_record.email,
            'displayName': full_name or user_record.display_name,
            'photoURL': user_record.photo_url,
            'emailVerified': user_record.email_verified,
            'role': role,
            'isActive': is_active,
            'createdAt': user_record.user_metadata.creation_timestamp,
            'lastLoginAt': user_record.user_metadata.last_sign_in_timestamp
        }), 200
    except auth.UserNotFoundError:
        session.clear()
        return jsonify({'message': 'User not found'}), 404
    except Exception as e:
        current_app.logger.error(f'Get user error: {str(e)}')
        return jsonify({'message': 'Failed to get user information'}), 500


@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    """Send password reset email to user"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400
            
        email = data.get('email', '').strip().lower()
        
        if not email:
            return jsonify({'message': 'Email is required'}), 400
        
        # Send password reset email via Firebase REST API
        url = f'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={FIREBASE_WEB_API_KEY}'
        
        payload = {
            'requestType': 'PASSWORD_RESET',
            'email': email
        }
        
        response = requests.post(url, json=payload, timeout=10)
        
        if response.status_code == 200:
            return jsonify({'message': 'If an account exists with this email, a password reset link has been sent'}), 200
        else:
            error_data = response.json()
            error_message = error_data.get('error', {}).get('message', '')
            
            # Don't reveal if email exists for security
            if 'EMAIL_NOT_FOUND' in error_message:
                return jsonify({'message': 'If an account exists with this email, a password reset link has been sent'}), 200
            
            current_app.logger.error(f'Password reset error: {error_message}')
            return jsonify({'message': 'Unable to send reset email. Please try again'}), 400
            
    except requests.exceptions.Timeout:
        return jsonify({'message': 'Request timeout. Please try again'}), 504
    except Exception as e:
        current_app.logger.error(f'Forgot password error: {str(e)}')
        return jsonify({'message': 'An internal error occurred. Please try again'}), 500


@auth_bp.route('/verify-token', methods=['POST'])
def verify_token():
    """Verify Firebase ID token for additional security checks"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400
            
        id_token = data.get('idToken')
        
        if not id_token:
            return jsonify({'message': 'Token is required'}), 400
        
        decoded_token = auth.verify_id_token(id_token)
        
        return jsonify({
            'valid': True,
            'uid': decoded_token['uid'],
            'email': decoded_token.get('email')
        }), 200
        
    except auth.InvalidIdTokenError:
        return jsonify({'valid': False, 'message': 'Invalid token'}), 401
    except auth.ExpiredIdTokenError:
        return jsonify({'valid': False, 'message': 'Token has expired'}), 401
    except Exception as e:
        current_app.logger.error(f'Token verification error: {str(e)}')
        return jsonify({'valid': False, 'message': 'Token verification failed'}), 500


@auth_bp.route('/change-password', methods=['POST'])
@login_required_api
def change_password():
    """Change user password (requires old password)"""
    try:
        data = request.get_json()
        old_password = data.get('oldPassword')
        new_password = data.get('newPassword')
        
        if not old_password or not new_password:
            return jsonify({'message': 'Old and new password are required'}), 400
        
        if len(new_password) < 8:
            return jsonify({'message': 'New password must be at least 8 characters'}), 400
        
        email = session.get('email')
        
        # First, verify old password by attempting to sign in
        url = f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_WEB_API_KEY}'
        
        verify_payload = {
            'email': email,
            'password': old_password,
            'returnSecureToken': True
        }
        
        verify_response = requests.post(url, json=verify_payload, timeout=10)
        
        if verify_response.status_code != 200:
            return jsonify({'message': 'Current password is incorrect'}), 401
        
        # Get ID token from verification
        id_token = verify_response.json().get('idToken')
        
        # Update password using Firebase REST API
        update_url = f'https://identitytoolkit.googleapis.com/v1/accounts:update?key={FIREBASE_WEB_API_KEY}'
        
        update_payload = {
            'idToken': id_token,
            'password': new_password,
            'returnSecureToken': True
        }
        
        update_response = requests.post(update_url, json=update_payload, timeout=10)
        
        if update_response.status_code == 200:
            return jsonify({'message': 'Password changed successfully'}), 200
        else:
            error_data = update_response.json()
            error_message = error_data.get('error', {}).get('message', 'Password change failed')
            return jsonify({'message': error_message}), 400
            
    except Exception as e:
        current_app.logger.error(f'Change password error: {str(e)}')
        return jsonify({'message': 'An internal error occurred'}), 500

@auth_bp.route('/session/check', methods=['GET'])
def check_session():
    """Check if current session is valid"""
    if 'user_id' in session:
        return jsonify({
            'authenticated': True,
            'user': {
                'uid': session['user_id'],
                'email': session.get('email'),
                'displayName': session.get('display_name'),
                'role': session.get('role')
            }
        }), 200
    else:
        return jsonify({'authenticated': False}), 200


# ============================================
# ADMIN API ROUTES (Optional - for user management)
# ============================================

@auth_bp.route('/admin/users', methods=['GET'])
@login_required_api
@role_required(['superadmin'])
def get_all_users():
    """Get all users from Realtime Database (Super Admin only)"""
    try:
        users_ref = db.reference('users')
        all_users = users_ref.get()
        
        if not all_users:
            return jsonify({'users': []}), 200
        
        # Format user data
        users_list = []
        for uid, user_data in all_users.items():
            users_list.append({
                'uid': uid,
                'email': user_data.get('email'),
                'fullName': user_data.get('fullName'),
                'role': user_data.get('role'),
                'isActive': user_data.get('isActive', True)
            })
        
        return jsonify({'users': users_list}), 200
    except Exception as e:
        current_app.logger.error(f'Error getting users: {str(e)}')
        return jsonify({'message': 'Failed to get users'}), 500


@auth_bp.route('/admin/users/<uid>/role', methods=['PUT'])
@login_required_api
@role_required(['superadmin'])
def update_user_role(uid):
    """Update user role (Super Admin only)"""
    try:
        data = request.get_json()
        new_role = data.get('role')
        
        # Allow customer role as well
        if new_role not in ['superadmin', 'admin', 'customer']:
            return jsonify({'message': 'Invalid role. Must be superadmin, admin, or customer'}), 400
        
        # Update role in Realtime Database
        user_ref = db.reference(f'users/{uid}')
        user_ref.update({'role': new_role})
        
        return jsonify({'message': f'User role updated to {new_role}'}), 200
    except Exception as e:
        current_app.logger.error(f'Error updating user role: {str(e)}')
        return jsonify({'message': 'Failed to update user role'}), 500


@auth_bp.route('/admin/users/<uid>/deactivate', methods=['POST'])
@login_required_api
@role_required(['superadmin'])
def deactivate_user(uid):
    """Deactivate a user account (Super Admin only)"""
    try:
        user_ref = db.reference(f'users/{uid}')
        user_ref.update({'isActive': False})
        
        return jsonify({'message': 'User account deactivated'}), 200
    except Exception as e:
        current_app.logger.error(f'Error deactivating user: {str(e)}')
        return jsonify({'message': 'Failed to deactivate user'}), 500


@auth_bp.route('/admin/users/<uid>/activate', methods=['POST'])
@login_required_api
@role_required(['superadmin'])
def activate_user(uid):
    """Activate a user account (Super Admin only)"""
    try:
        user_ref = db.reference(f'users/{uid}')
        user_ref.update({'isActive': True})
        
        return jsonify({'message': 'User account activated'}), 200
    except Exception as e:
        current_app.logger.error(f'Error activating user: {str(e)}')
        return jsonify({'message': 'Failed to activate user'}), 500