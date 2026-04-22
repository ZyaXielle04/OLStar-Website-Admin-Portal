# backend/decorators.py
from functools import wraps
from flask import session, jsonify, redirect, url_for

def login_required(f):
    """Decorator for page routes - redirects to login page"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('pages.login_page'))
        return f(*args, **kwargs)
    return decorated_function

def login_required_api(f):
    """Decorator for API routes - returns JSON error"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'message': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def no_rate_limit(f):
    """Decorator to mark a route as exempt from rate limiting"""
    f._limiter_exempt = True
    return f

def role_required_api(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'role' not in session or session['role'] not in allowed_roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator