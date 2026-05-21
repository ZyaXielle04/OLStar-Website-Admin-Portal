# backend/decorators.py
from functools import wraps
from flask import session, jsonify, redirect, url_for, current_app
from firebase_admin import db


def refresh_session_user():
    user_id = session.get('user_id')
    if not user_id:
        return False

    try:
        user_data = db.reference(f'users/{user_id}').get()
    except Exception as e:
        current_app.logger.error(f'Error refreshing session user: {str(e)}')
        return False

    if not user_data or user_data.get('isActive', True) is not True:
        session.clear()
        return False

    role = user_data.get('role')
    if role not in {'superadmin', 'admin', 'customer', 'driver'}:
        session.clear()
        return False

    session['role'] = role
    session['display_name'] = user_data.get('fullName') or session.get('display_name')
    session['email'] = user_data.get('email') or session.get('email')
    return True

def login_required(f):
    """Decorator for page routes - redirects to login page"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('pages.login_page'))
        if not refresh_session_user():
            return redirect(url_for('pages.login_page'))
        return f(*args, **kwargs)
    return decorated_function

def login_required_api(f):
    """Decorator for API routes - returns JSON error"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'message': 'Authentication required'}), 401
        if not refresh_session_user():
            return jsonify({'message': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def no_rate_limit(f):
    """Decorator to mark a route as exempt from rate limiting"""
    f._limiter_exempt = True
    return f

def rate_limit(limit):
    """Decorator to mark a route with a custom rate limit"""
    def decorator(f):
        f._rate_limit = limit
        return f
    return decorator

def role_required_api(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'role' not in session or session['role'] not in allowed_roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator
