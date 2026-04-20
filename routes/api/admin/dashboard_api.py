from flask import Blueprint, jsonify, session
from functools import wraps
from firebase_admin import db
from datetime import datetime

admin_dashboard_api_bp = Blueprint('admin_dashboard_api', __name__, url_prefix='/admin/dashboard')

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

@admin_dashboard_api_bp.route('/stats')
@login_required_api
@role_required_api(['admin', 'superadmin'])
def get_admin_stats():
    """Get admin-specific dashboard statistics"""
    try:
        # Get today's schedule count (if you have schedules node)
        today_schedule_count = 0
        try:
            schedules_ref = db.reference('schedules')
            all_schedules = schedules_ref.get()
            if all_schedules:
                today = datetime.now().date().isoformat()
                for schedule_id, schedule_data in all_schedules.items():
                    if schedule_data.get('date') == today:
                        today_schedule_count += 1
        except:
            today_schedule_count = 0
        
        # Get completed tasks count
        completed_tasks = 0
        try:
            tasks_ref = db.reference('tasks')
            all_tasks = tasks_ref.get()
            if all_tasks:
                for task_id, task_data in all_tasks.items():
                    if task_data.get('status') == 'completed':
                        completed_tasks += 1
        except:
            completed_tasks = 0
        
        # Get pending approvals
        pending_approvals = 0
        try:
            approvals_ref = db.reference('approvals')
            all_approvals = approvals_ref.get()
            if all_approvals:
                for approval_id, approval_data in all_approvals.items():
                    if approval_data.get('status') == 'pending':
                        pending_approvals += 1
        except:
            pending_approvals = 0
        
        return jsonify({
            'today_schedule_count': today_schedule_count,
            'completed_tasks': completed_tasks,
            'pending_approvals': pending_approvals
        })
    except Exception as e:
        print(f"ERROR in get_admin_stats: {str(e)}")
        return jsonify({'error': str(e)}), 500