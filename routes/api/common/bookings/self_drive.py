# routes/api/common/bookings/self_drive.py

from flask import Blueprint, request, jsonify, session, make_response
from firebase_admin import db
from datetime import datetime, timedelta
import pytz
import hashlib
import json
import logging
from functools import wraps
from backend.decorators import login_required_api, role_required_api

self_drive_bp = Blueprint('self_drive', __name__)

# Constants
SERVICE_TYPE = 'selfDrive'
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

def is_self_drive_booking(booking_data):
    booking_type = booking_data.get('bookingType') or booking_data.get('serviceType') or booking_data.get('rentalType')
    return booking_type in {'selfDrive', 'self-drive', 'carRentalSelfDrive', 'selfDriveCarRental'}

def get_all_self_drive_bookings():
    """Fetch ALL self-drive bookings from pendingBooking"""
    try:
        pending_ref = db.reference('/pendingBooking')
        pending_data = pending_ref.get()
        
        if not pending_data:
            return []
        
        bookings = []
        for booking_id, booking_data in pending_data.items():
            if is_self_drive_booking(booking_data):
                booking_data['id'] = booking_id
                if 'status' not in booking_data:
                    booking_data['status'] = 'unassigned'
                bookings.append(booking_data)
        
        bookings.sort(key=lambda x: (x.get('pickupDate') or x.get('startDate') or x.get('date') or x.get('travelDate') or '', x.get('pickupTime') or x.get('time') or ''), reverse=True)
        return bookings
        
    except Exception as e:
        print(f"Error fetching self-drive bookings: {e}")
        return []

def get_self_drive_bookings_by_status(status_filter=None):
    """Fetch self-drive bookings filtered by status field"""
    try:
        pending_ref = db.reference('/pendingBooking')
        pending_data = pending_ref.get()
        
        if not pending_data:
            return []
        
        bookings = []
        for booking_id, booking_data in pending_data.items():
            if not is_self_drive_booking(booking_data):
                continue
            
            if status_filter and status_filter != 'all':
                if booking_data.get('status', 'unassigned') != status_filter:
                    continue
            
            booking_data['id'] = booking_id
            if 'status' not in booking_data:
                booking_data['status'] = 'unassigned'
            bookings.append(booking_data)
        
        bookings.sort(key=lambda x: (x.get('pickupDate') or x.get('startDate') or x.get('date') or x.get('travelDate') or '', x.get('pickupTime') or x.get('time') or ''), reverse=True)
        return bookings
        
    except Exception as e:
        print(f"Error fetching self-drive bookings by status: {e}")
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
    pickup_date = booking.get('pickupDate') or booking.get('startDate') or booking.get('date') or booking.get('travelDate') or ''
    return_date = booking.get('returnDate') or booking.get('endDate') or ''
    return_date_time = booking.get('returnDateTime', '')
    if not return_date and return_date_time:
        return_date = return_date_time.split(' at ')[0]
    pickup_time = booking.get('pickupTime') or booking.get('time') or ''
    pickup_location = booking.get('pickupLocation') or booking.get('pickup') or ''
    return_location = booking.get('returnLocation') or booking.get('dropoffLocation') or booking.get('dropoff') or pickup_location
    transport_unit = booking.get('transportUnit') or booking.get('transportUnitName') or booking.get('carType') or booking.get('vehicleType') or booking.get('vehicle') or 'N/A'
    duration = booking.get('duration') or booking.get('rentalDuration') or booking.get('durationHours') or booking.get('hours') or 'N/A'
    return {
        'id': booking.get('id'),
        'bookingType': booking.get('bookingType', SERVICE_TYPE),
        'clientName': booking.get('clientName', 'N/A'),
        'clientId': booking.get('clientId'),
        'contactNumber': booking.get('contactNumber', 'N/A'),
        'email': booking.get('email', 'N/A'),
        'amount': float(booking.get('amount', 0)),
        'originalAmount': float(booking.get('originalAmount', 0)) if booking.get('originalAmount') else None,
        'paymentStatus': booking.get('paymentStatus', 'pending'),
        'paymentMethod': booking.get('paymentMethod', 'N/A'),
        'status': booking.get('status', 'unassigned'),
        'date': pickup_date,
        'pickupDate': pickup_date,
        'returnDate': return_date,
        'returnDateTime': return_date_time,
        'time': pickup_time,
        'pickupTime': pickup_time,
        'pickup': pickup_location,
        'pickupLocation': pickup_location,
        'dropoff': return_location,
        'returnLocation': return_location,
        'packageType': booking.get('packageType', ''),
        'rateType': booking.get('rateType', ''),
        'duration': duration,
        'rentalDuration': booking.get('rentalDuration', duration),
        'transportUnit': transport_unit,
        'carType': booking.get('carType', transport_unit),
        'vehicleType': transport_unit,
        'driverLicenseNumber': booking.get('driverLicenseNumber', ''),
        'deliveryFee': float(booking.get('deliveryFee', 0)) if booking.get('deliveryFee') else 0,
        'pointsRedeemed': booking.get('pointsRedeemed', 0),
        'pointsDiscount': float(booking.get('pointsDiscount', 0)),
        'note': booking.get('note', ''),
        'timestamp': booking.get('timestamp', ''),
        'paidAt': booking.get('paidAt', ''),
        'assigned_driver': booking.get('assigned_driver'),
        'assigned_vehicle': booking.get('assigned_vehicle'),
        'assigned_at': booking.get('assigned_at'),
        'assigned_by': booking.get('assigned_by'),
        'assignment_notes': booking.get('assignment_notes'),
        'completed_at': booking.get('completed_at'),
        'completed_by': booking.get('completed_by'),
        'completion_notes': booking.get('completion_notes'),
        'cancelled_at': booking.get('cancelled_at'),
        'cancelled_by': booking.get('cancelled_by'),
        'cancellation_reason': booking.get('cancellation_reason')
    }

# ============================================
# API ROUTES WITH CACHING & POLLING OPTIMIZATIONS
# ============================================

@self_drive_bp.route('/common/self-drive/bookings', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@log_request
def get_self_drive_bookings():
    """Get self-drive bookings with conditional GET support for polling"""
    try:
        status = request.args.get('status', 'unassigned')
        
        # Get the If-None-Match header for cache validation
        if_none_match = request.headers.get('If-None-Match')
        
        if status == 'all':
            bookings = get_self_drive_bookings_by_status()
        else:
            bookings = get_self_drive_bookings_by_status(status)
        
        formatted_bookings = [format_booking_response(b) for b in bookings]
        
        # Generate ETag based on bookings data
        etag = hashlib.md5(json.dumps(formatted_bookings, sort_keys=True).encode()).hexdigest()
        
        # If ETag matches, return 304 Not Modified (saves bandwidth)
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

@self_drive_bp.route('/common/self-drive/bookings/counts', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_self_drive_counts():
    """Get counts for each status"""
    try:
        all_bookings = get_all_self_drive_bookings()
        
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

@self_drive_bp.route('/common/self-drive/bookings/<booking_id>', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_self_drive_booking(booking_id):
    """Get detailed information for a specific booking"""
    try:
        booking = get_booking_by_id(booking_id)
        
        if not booking:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        if not is_self_drive_booking(booking):
            return jsonify({'success': False, 'message': 'Not a self-drive booking'}), 400
        
        return jsonify({'success': True, 'booking': format_booking_response(booking)}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@self_drive_bp.route('/common/self-drive/bookings/<booking_id>/assign', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def assign_vehicle_to_self_drive_booking(booking_id):
    """Assign a vehicle to a self-drive booking - updates status to 'assigned'"""
    try:
        data = request.get_json()
        vehicle_id = data.get('vehicle_id')
        assignment_notes = data.get('assignment_notes', '')
        
        if not vehicle_id:
            return jsonify({'success': False, 'message': 'Vehicle ID is required'}), 400
        
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        if not is_self_drive_booking(booking_data):
            return jsonify({'success': False, 'message': 'Not a self-drive booking'}), 400
        
        current_status = booking_data.get('status', 'unassigned')
        if current_status != 'unassigned':
            return jsonify({'success': False, 'message': f'Booking status is {current_status}. Cannot assign.'}), 400
        
        # Get vehicle details
        vehicle_ref = db.reference(f'transportUnits/{vehicle_id}')
        vehicle_data = vehicle_ref.get()
        
        if not vehicle_data:
            return jsonify({'success': False, 'message': 'Vehicle not found'}), 404
        
        # Update the booking - change status to 'assigned'
        update_data = {
            'status': 'assigned',
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
        
        return jsonify({'success': True, 'message': 'Vehicle assigned successfully'}), 200
        
    except Exception as e:
        print(f"Error assigning vehicle: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@self_drive_bp.route('/common/self-drive/bookings/<booking_id>/cancel', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def cancel_self_drive_booking(booking_id):
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
        
        if not is_self_drive_booking(booking_data):
            return jsonify({'success': False, 'message': 'Not a self-drive booking'}), 400
        
        current_status = booking_data.get('status', 'unassigned')
        if current_status not in ['unassigned', 'assigned']:
            return jsonify({'success': False, 'message': f'Cannot cancel booking with status {current_status}'}), 400
        
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

@self_drive_bp.route('/common/self-drive/bookings/<booking_id>/complete', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def complete_self_drive_booking(booking_id):
    """Mark a booking as completed - updates status to 'completed'"""
    try:
        data = request.get_json()
        completion_notes = data.get('completion_notes', '')
        
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        if not is_self_drive_booking(booking_data):
            return jsonify({'success': False, 'message': 'Not a self-drive booking'}), 400
        
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

# ============================================
# VEHICLE ENDPOINTS
# ============================================

@self_drive_bp.route('/common/self-drive/vehicles/available', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_available_vehicles():
    """Get all available vehicles, not currently assigned to active bookings"""
    try:
        # Get current bookings to check which vehicles are already assigned
        all_bookings = get_all_self_drive_bookings()
        assigned_vehicle_ids = set()
        
        # Find vehicles currently assigned to active bookings
        for booking in all_bookings:
            status = booking.get('status')
            if status in ['assigned', 'in_progress']:  # Active bookings
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
            
            # Check if vehicle is already assigned to an active booking
            is_assigned = unit_id in assigned_vehicle_ids
            
            # Vehicle is available if: marked available AND not assigned to active booking
            if is_available and not is_assigned:
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

@self_drive_bp.route('/common/self-drive/last-updated', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_last_updated():
    """Get the last update timestamp for bookings (for polling optimization)"""
    try:
        all_bookings = get_all_self_drive_bookings()
        
        last_updated = None
        for booking in all_bookings:
            # Check various timestamp fields
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

@self_drive_bp.route('/common/self-drive/health', methods=['GET'])
def health_check():
    """Simple health check endpoint for monitoring"""
    try:
        # Check if Firebase is accessible
        pending_ref = db.reference('/pendingBooking')
        test = pending_ref.get(shallow=True)
        
        return jsonify({
            'success': True,
            'status': 'healthy',
            'service': 'self_drive',
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

@self_drive_bp.route('/common/self-drive/cache/clear', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def clear_cache():
    try:
        invalidate_cache()
        return jsonify({'success': True, 'message': 'Cache cleared successfully'}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
