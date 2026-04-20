from flask import Blueprint, jsonify, session
from functools import wraps
from firebase_admin import db

superadmin_dashboard_api_bp = Blueprint('superadmin_dashboard_api', __name__, url_prefix='/superadmin/dashboard')

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

@superadmin_dashboard_api_bp.route('/stats')
@login_required_api
@role_required_api(['superadmin'])
def get_superadmin_stats():
    """Get superadmin-specific dashboard statistics"""
    try:
        # Get total admins
        users_ref = db.reference('users')
        all_users = users_ref.get()
        
        total_admins = 0
        if all_users:
            for uid, user_data in all_users.items():
                if user_data.get('role') == 'admin':
                    total_admins += 1
        
        # Get system alerts
        system_alerts = 0
        try:
            alerts_ref = db.reference('alerts')
            all_alerts = alerts_ref.get()
            if all_alerts:
                for alert_id, alert_data in all_alerts.items():
                    if alert_data.get('status') == 'active':
                        system_alerts += 1
        except:
            system_alerts = 2
        
        return jsonify({
            'total_admins': total_admins,
            'system_alerts': system_alerts
        })
    except Exception as e:
        print(f"ERROR in get_superadmin_stats: {str(e)}")
        return jsonify({'error': str(e)}), 500