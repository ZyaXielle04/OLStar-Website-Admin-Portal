# routes/api/common/bookings/with_driver_metro.py

from flask import Blueprint, request, jsonify, session, make_response
from firebase_admin import db
from datetime import datetime, timedelta
import pytz
import hashlib
import json
import logging
from functools import wraps
from backend.decorators import login_required_api, role_required_api

with_driver_metro_bp = Blueprint('with_driver_metro', __name__)

# Constants
SERVICE_TYPE = 'withDriverMetro'
PH_TIMEZONE = pytz.timezone('Asia/Manila')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Simple in-memory cache
cache = {}
CACHE_DURATION = 30

def cached(timeout=30):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            cache_key = request.full_path + str(session.get('user_id', ''))
            cache_key = hashlib.md5(cache_key.encode()).hexdigest()
            
            if cache_key in cache:
                cache_data, timestamp = cache[cache_key]
                if datetime.now(PH_TIMEZONE) - timestamp < timedelta(seconds=timeout):
                    response = make_response(jsonify(cache_data))
                    response.headers['X-Cache'] = 'HIT'
                    response.headers['Cache-Control'] = f'public, max-age={timeout}'
                    return response
            
            result = f(*args, **kwargs)
            
            if isinstance(result, tuple):
                response_data = result[0].get_json() if hasattr(result[0], 'get_json') else result[0]
                status_code = result[1]
            else:
                response_data = result.get_json() if hasattr(result, 'get_json') else result
                status_code = 200
            
            cache[cache_key] = (response_data, datetime.now(PH_TIMEZONE))
            
            response = make_response(jsonify(response_data), status_code)
            response.headers['X-Cache'] = 'MISS'
            response.headers['Cache-Control'] = f'public, max-age={timeout}'
            return response
            
        return decorated_function
    return decorator

def invalidate_cache():
    global cache
    cache.clear()
    print(f"Cache cleared at {datetime.now(PH_TIMEZONE)}")

def log_request(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        logger.info(f"Request: {request.method} {request.path} - User: {session.get('user_id', 'anonymous')}")
        start_time = datetime.now(PH_TIMEZONE)
        result = f(*args, **kwargs)
        duration = (datetime.now(PH_TIMEZONE) - start_time).total_seconds()
        logger.info(f"Response: {request.method} {request.path} - Duration: {duration:.3f}s")
        return result
    return decorated_function

# ============================================
# HELPER FUNCTIONS
# ============================================

def get_all_metro_bookings():
    """Fetch ALL metro point-to-point bookings from pendingBooking"""
    try:
        pending_ref = db.reference('/pendingBooking')
        pending_data = pending_ref.get()
        
        if not pending_data:
            return []
        
        bookings = []
        for booking_id, booking_data in pending_data.items():
            booking_type = booking_data.get('bookingType') or booking_data.get('serviceType')
            if booking_type == 'withDriverMetro' or booking_data.get('package') in ['all-inclusive', 'point-to-point']:
                booking_data['id'] = booking_id
                if 'status' not in booking_data:
                    booking_data['status'] = 'unassigned'
                bookings.append(booking_data)
        
        bookings.sort(key=lambda x: x.get('travelDate', ''), reverse=False)
        return bookings
        
    except Exception as e:
        print(f"Error fetching metro bookings: {e}")
        return []

def get_metro_bookings_by_status(status_filter=None):
    """Fetch metro bookings filtered by status field"""
    try:
        pending_ref = db.reference('/pendingBooking')
        pending_data = pending_ref.get()
        
        if not pending_data:
            return []
        
        bookings = []
        for booking_id, booking_data in pending_data.items():
            booking_type = booking_data.get('bookingType') or booking_data.get('serviceType')
            if booking_type != 'withDriverMetro' and booking_data.get('package') not in ['all-inclusive', 'point-to-point']:
                continue
            
            if status_filter and status_filter != 'all':
                booking_status = booking_data.get('status', 'unassigned')
                if booking_status != status_filter:
                    continue
            
            booking_data['id'] = booking_id
            if 'status' not in booking_data:
                booking_data['status'] = 'unassigned'
            bookings.append(booking_data)
        
        bookings.sort(key=lambda x: x.get('travelDate', ''), reverse=False)
        return bookings
        
    except Exception as e:
        print(f"Error fetching metro bookings by status: {e}")
        return []

def get_booking_by_id(booking_id):
    """Fetch a specific booking by ID"""
    try:
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return None
        
        booking_data['id'] = booking_id
        if 'status' not in booking_data:
            booking_data['status'] = 'unassigned'
        return booking_data
        
    except Exception as e:
        print(f"Error fetching booking {booking_id}: {e}")
        return None

def format_booking_response(booking):
    """Format booking data for API response"""
    travel_date = booking.get('travelDate', '')
    if travel_date and '-' in travel_date:
        parts = travel_date.split('-')
        if len(parts) == 3 and len(parts[2]) == 4:
            travel_date = f"{parts[2]}-{parts[0]}-{parts[1]}"
    
    return {
        'id': booking.get('id'),
        'bookingType': booking.get('bookingType', 'withDriverMetro'),
        'clientName': booking.get('clientName', 'N/A'),
        'clientId': booking.get('clientId'),
        'contactNumber': booking.get('contactNumber', 'N/A'),
        'email': booking.get('email', 'N/A'),
        'amount': float(booking.get('amount', 0)),
        'paymentStatus': booking.get('paymentStatus', 'pending'),
        'paymentMethod': booking.get('paymentMethod', 'N/A'),
        'status': booking.get('status', 'unassigned'),
        'travelDate': travel_date,
        'duration': booking.get('duration', 'N/A'),
        'pickupLocation': booking.get('pickupLocation', ''),
        'dropoffLocation': booking.get('dropoffLocation', ''),
        'package': booking.get('package', ''),
        'packageType': booking.get('packageType', ''),
        'vehicleType': booking.get('vehicleType', 'N/A'),
        'pickupTime': booking.get('pickupTime', ''),
        'plannedItinerary': booking.get('plannedItinerary', ''),
        'note': booking.get('note', ''),
        'contacts': booking.get('contacts', []),
        'timestamp': booking.get('timestamp', ''),
        'paidAt': booking.get('paidAt', ''),
        'source': booking.get('source', 'pending'),
        'assigned_driver': booking.get('assigned_driver'),
        'assigned_vehicle': booking.get('assigned_vehicle'),
        'assigned_at': booking.get('assigned_at'),
        'assigned_by': booking.get('assigned_by'),
        'assigned_by_name': booking.get('assigned_by_name'),
        'assignment_notes': booking.get('assignment_notes'),
        'completed_at': booking.get('completed_at'),
        'completed_by': booking.get('completed_by'),
        'completed_by_name': booking.get('completed_by_name'),
        'completion_notes': booking.get('completion_notes'),
        'cancelled_at': booking.get('cancelled_at'),
        'cancelled_by': booking.get('cancelled_by'),
        'cancelled_by_name': booking.get('cancelled_by_name'),
        'cancellation_reason': booking.get('cancellation_reason'),
        'reassigned_at': booking.get('reassigned_at'),
        'reassigned_by': booking.get('reassigned_by'),
        'reassign_reason': booking.get('reassign_reason')
    }

# ============================================
# API ROUTES WITH CACHING & POLLING OPTIMIZATIONS
# ============================================

@with_driver_metro_bp.route('/common/with-driver-metro/bookings', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@log_request
def get_metro_bookings():
    """Get metro point-to-point bookings with conditional GET support for polling"""
    try:
        status = request.args.get('status', 'unassigned')
        if_none_match = request.headers.get('If-None-Match')
        
        if status == 'all':
            bookings = get_metro_bookings_by_status()
        else:
            bookings = get_metro_bookings_by_status(status)
        
        formatted_bookings = [format_booking_response(b) for b in bookings]
        etag = hashlib.md5(json.dumps(formatted_bookings, sort_keys=True).encode()).hexdigest()
        
        if if_none_match and if_none_match.strip('"') == etag:
            return '', 304
        
        response = jsonify({
            'success': True,
            'bookings': formatted_bookings,
            'total': len(formatted_bookings),
            'status': status,
            'timestamp': datetime.now(PH_TIMEZONE).isoformat(),
            'etag': etag
        })
        
        response.headers['ETag'] = f'"{etag}"'
        response.headers['Cache-Control'] = 'max-age=30, must-revalidate'
        response.headers['Last-Modified'] = datetime.now(PH_TIMEZONE).strftime('%a, %d %b %Y %H:%M:%S GMT')
        
        return response, 200
        
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/bookings/counts', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_metro_counts():
    """Get counts for each status"""
    try:
        all_bookings = get_all_metro_bookings()
        
        counts = {
            'unassigned': sum(1 for b in all_bookings if b.get('status') == 'unassigned'),
            'assigned': sum(1 for b in all_bookings if b.get('status') == 'assigned'),
            'completed': sum(1 for b in all_bookings if b.get('status') == 'completed'),
            'cancelled': sum(1 for b in all_bookings if b.get('status') == 'cancelled'),
            'all': len(all_bookings)
        }
        
        return jsonify({'success': True, 'counts': counts}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/bookings/<booking_id>', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_metro_booking(booking_id):
    """Get detailed information for a specific booking"""
    try:
        booking = get_booking_by_id(booking_id)
        
        if not booking:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        return jsonify({'success': True, 'booking': format_booking_response(booking)}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/bookings/<booking_id>/assign', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def assign_driver_to_metro_booking(booking_id):
    """Assign a driver and vehicle to a booking - updates status to 'assigned'"""
    try:
        data = request.get_json()
        driver_id = data.get('driver_id')
        vehicle_id = data.get('vehicle_id')
        assignment_notes = data.get('assignment_notes', '')
        
        if not driver_id or not vehicle_id:
            return jsonify({'success': False, 'message': 'Driver ID and Vehicle ID are required'}), 400
        
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        current_status = booking_data.get('status', 'unassigned')
        if current_status != 'unassigned':
            return jsonify({'success': False, 'message': f'Booking status is {current_status}. Cannot assign.'}), 400
        
        driver_ref = db.reference(f'users/{driver_id}')
        driver_data = driver_ref.get()
        
        if not driver_data:
            return jsonify({'success': False, 'message': 'Driver not found'}), 404
        
        vehicle_ref = db.reference(f'transportUnits/{vehicle_id}')
        vehicle_data = vehicle_ref.get()
        
        if not vehicle_data:
            return jsonify({'success': False, 'message': 'Vehicle not found'}), 404
        
        update_data = {
            'status': 'assigned',
            'assigned_driver': {
                'id': driver_id,
                'name': driver_data.get('fullName', 'N/A'),
                'contact': driver_data.get('contactNumber', 'N/A')
            },
            'assigned_vehicle': {
                'id': vehicle_id,
                'name': vehicle_data.get('transportUnit', 'N/A'),
                'plate_number': vehicle_data.get('plateNumber', 'N/A'),
                'type': vehicle_data.get('unitType', 'N/A'),
                'color': vehicle_data.get('color', 'N/A')
            },
            'assignment_notes': assignment_notes,
            'assigned_by': session.get('user_id'),
            'assigned_by_name': session.get('display_name', session.get('email')),
            'assigned_at': datetime.now(PH_TIMEZONE).isoformat()
        }
        
        booking_ref.update(update_data)
        invalidate_cache()
        
        return jsonify({'success': True, 'message': 'Driver assigned successfully'}), 200
        
    except Exception as e:
        print(f"Error assigning driver: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/bookings/<booking_id>/complete', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def complete_metro_booking(booking_id):
    """Mark a booking as completed - updates status to 'completed'"""
    try:
        data = request.get_json()
        completion_notes = data.get('completion_notes', '')
        
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        if booking_data.get('status') != 'assigned':
            return jsonify({'success': False, 'message': 'Only assigned bookings can be completed'}), 400
        
        update_data = {
            'status': 'completed',
            'completion_notes': completion_notes,
            'completed_by': session.get('user_id'),
            'completed_by_name': session.get('display_name', session.get('email')),
            'completed_at': datetime.now(PH_TIMEZONE).isoformat()
        }
        
        booking_ref.update(update_data)
        invalidate_cache()
        
        return jsonify({'success': True, 'message': 'Booking marked as completed'}), 200
        
    except Exception as e:
        print(f"Error completing booking: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/bookings/<booking_id>/cancel', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def cancel_metro_booking(booking_id):
    """Cancel a booking - updates status to 'cancelled'"""
    try:
        data = request.get_json()
        cancellation_reason = data.get('cancellation_reason', '')
        
        if not cancellation_reason:
            return jsonify({'success': False, 'message': 'Cancellation reason is required'}), 400
        
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        current_status = booking_data.get('status', 'unassigned')
        if current_status == 'completed':
            return jsonify({'success': False, 'message': 'Cannot cancel completed booking'}), 400
        
        update_data = {
            'status': 'cancelled',
            'cancellation_reason': cancellation_reason,
            'cancelled_by': session.get('user_id'),
            'cancelled_by_name': session.get('display_name', session.get('email')),
            'cancelled_at': datetime.now(PH_TIMEZONE).isoformat()
        }
        
        booking_ref.update(update_data)
        invalidate_cache()
        
        return jsonify({'success': True, 'message': 'Booking cancelled successfully'}), 200
        
    except Exception as e:
        print(f"Error cancelling booking: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/bookings/<booking_id>/reassign', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def reassign_metro_booking(booking_id):
    """Reassign driver and vehicle to a booking"""
    try:
        data = request.get_json()
        driver_id = data.get('driver_id')
        vehicle_id = data.get('vehicle_id')
        reassign_reason = data.get('reassign_reason', '')
        
        if not driver_id or not vehicle_id:
            return jsonify({'success': False, 'message': 'Driver ID and Vehicle ID are required'}), 400
        
        if not reassign_reason:
            return jsonify({'success': False, 'message': 'Reassignment reason is required'}), 400
        
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        driver_ref = db.reference(f'users/{driver_id}')
        driver_data = driver_ref.get()
        
        if not driver_data:
            return jsonify({'success': False, 'message': 'Driver not found'}), 404
        
        vehicle_ref = db.reference(f'transportUnits/{vehicle_id}')
        vehicle_data = vehicle_ref.get()
        
        if not vehicle_data:
            return jsonify({'success': False, 'message': 'Vehicle not found'}), 404
        
        update_data = {
            'assigned_driver': {
                'id': driver_id,
                'name': driver_data.get('fullName', 'N/A'),
                'contact': driver_data.get('contactNumber', 'N/A')
            },
            'assigned_vehicle': {
                'id': vehicle_id,
                'name': vehicle_data.get('transportUnit', 'N/A'),
                'plate_number': vehicle_data.get('plateNumber', 'N/A'),
                'type': vehicle_data.get('unitType', 'N/A'),
                'color': vehicle_data.get('color', 'N/A')
            },
            'reassign_reason': reassign_reason,
            'reassigned_by': session.get('user_id'),
            'reassigned_by_name': session.get('display_name', session.get('email')),
            'reassigned_at': datetime.now(PH_TIMEZONE).isoformat()
        }
        
        booking_ref.update(update_data)
        invalidate_cache()
        
        return jsonify({'success': True, 'message': 'Reassignment completed successfully'}), 200
        
    except Exception as e:
        print(f"Error reassigning: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# DRIVER AND VEHICLE ENDPOINTS
# ============================================

@with_driver_metro_bp.route('/common/with-driver-metro/drivers/available', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_available_drivers_metro():
    """Get all available drivers"""
    try:
        users_ref = db.reference("users")
        all_users = users_ref.get() or {}
        
        available_drivers = []
        
        for uid, user_data in all_users.items():
            if user_data.get('role') == 'driver':
                available_drivers.append({
                    'id': uid,
                    'name': user_data.get('fullName', 'N/A'),
                    'email': user_data.get('email', 'N/A'),
                    'contact_number': user_data.get('contactNumber', 'N/A'),
                    'status': 'available'
                })
        
        return jsonify({'success': True, 'drivers': available_drivers}), 200
        
    except Exception as e:
        print(f"Error getting drivers: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/vehicles/available', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_available_vehicles_metro():
    """Get all available vehicles, optionally filtered by type and not currently assigned"""
    try:
        vehicle_type = request.args.get('type', '').lower()
        
        all_bookings = get_all_metro_bookings()
        assigned_vehicle_ids = set()
        
        for booking in all_bookings:
            status = booking.get('status')
            if status == 'assigned':
                assigned_vehicle = booking.get('assigned_vehicle')
                if assigned_vehicle and assigned_vehicle.get('id'):
                    assigned_vehicle_ids.add(assigned_vehicle.get('id'))
        
        units_ref = db.reference('transportUnits')
        all_units = units_ref.get()
        
        if not all_units:
            return jsonify({'success': True, 'vehicles': []}), 200
        
        available_vehicles = []
        
        for unit_id, unit_data in all_units.items():
            is_available = unit_data.get('isAvailable', True)
            unit_type = unit_data.get('unitType', '').lower()
            is_assigned = unit_id in assigned_vehicle_ids
            
            if is_available and not is_assigned:
                if vehicle_type and unit_type != vehicle_type:
                    continue
                    
                available_vehicles.append({
                    'id': unit_id,
                    'vehicle_name': unit_data.get('transportUnit', 'N/A'),
                    'plate_number': unit_data.get('plateNumber', 'N/A'),
                    'type': unit_data.get('unitType', 'N/A'),
                    'color': unit_data.get('color', 'N/A'),
                    'status': 'available'
                })
        
        return jsonify({'success': True, 'vehicles': available_vehicles}), 200
        
    except Exception as e:
        print(f"Error getting vehicles: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# POLLING OPTIMIZATION ENDPOINTS
# ============================================

@with_driver_metro_bp.route('/common/with-driver-metro/last-updated', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_last_updated():
    """Get the last update timestamp for bookings (for polling optimization)"""
    try:
        all_bookings = get_all_metro_bookings()
        
        last_updated = None
        for booking in all_bookings:
            booking_time = (booking.get('timestamp') or 
                          booking.get('assigned_at') or 
                          booking.get('completed_at') or
                          booking.get('cancelled_at'))
            
            if booking_time:
                if not last_updated or booking_time > last_updated:
                    last_updated = booking_time
        
        return jsonify({
            'success': True,
            'last_updated': last_updated,
            'server_time': datetime.now(PH_TIMEZONE).isoformat(),
            'total_bookings': len(all_bookings)
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@with_driver_metro_bp.route('/common/with-driver-metro/health', methods=['GET'])
def health_check():
    """Simple health check endpoint for monitoring"""
    try:
        pending_ref = db.reference('/pendingBooking')
        test = pending_ref.get(shallow=True)
        
        return jsonify({
            'success': True,
            'status': 'healthy',
            'service': 'with_driver_metro',
            'timestamp': datetime.now(PH_TIMEZONE).isoformat(),
            'firebase_connected': test is not None
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now(PH_TIMEZONE).isoformat()
        }), 500

# ============================================
# CACHE MANAGEMENT
# ============================================

@with_driver_metro_bp.route('/common/with-driver-metro/cache/clear', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def clear_cache_metro():
    try:
        invalidate_cache()
        return jsonify({'success': True, 'message': 'Cache cleared successfully'}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500