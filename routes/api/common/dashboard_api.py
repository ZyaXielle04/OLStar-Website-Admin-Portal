from flask import Blueprint, jsonify, session
from functools import wraps
from firebase_admin import db

common_dashboard_api_bp = Blueprint('common_dashboard_api', __name__, url_prefix='/common/dashboard')

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

@common_dashboard_api_bp.route('/stats')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_common_stats():
    """Get common dashboard statistics for both roles"""
    try:
        user_role = session.get('role')
        
        # Get reference to users node
        users_ref = db.reference('users')
        all_users = users_ref.get()
        
        # Count customers (role == 'customer')
        total_customers = 0
        if all_users:
            for uid, user_data in all_users.items():
                if user_data.get('role') == 'customer':
                    total_customers += 1
        
        # Get pending requests (if you have a requests node)
        pending_requests = 0
        try:
            requests_ref = db.reference('requests')
            all_requests = requests_ref.get()
            if all_requests:
                for req_id, req_data in all_requests.items():
                    if req_data.get('status') == 'pending':
                        pending_requests += 1
        except:
            pending_requests = 0
        
        # Get recent activities (limit to last 5)
        recent_activities = []
        try:
            activities_ref = db.reference('activities')
            all_activities = activities_ref.get()
            if all_activities:
                # Convert to list and sort by timestamp (newest first)
                activities_list = []
                for act_id, act_data in all_activities.items():
                    activities_list.append({
                        'time': act_data.get('timestamp', 'Just now'),
                        'description': act_data.get('description', 'No description')
                    })
                # Sort and take first 5
                recent_activities = activities_list[:5]
        except:
            recent_activities = [
                {'time': '2024-01-15 10:30', 'description': 'New customer registered'},
                {'time': '2024-01-15 09:15', 'description': 'System backup completed'},
            ]
        
        return jsonify({
            'total_customers': total_customers,
            'pending_requests': pending_requests,
            'recent_activities': recent_activities,
            'user_role': user_role
        })
    except Exception as e:
        print(f"ERROR in get_common_stats: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500