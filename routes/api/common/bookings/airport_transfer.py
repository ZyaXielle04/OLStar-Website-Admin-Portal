# routes/api/common/bookings/airport_transfer.py

from flask import Blueprint, request, jsonify, session, make_response
from firebase_admin import db
from datetime import datetime, timedelta
import pytz
import hashlib
import json
from functools import wraps
from backend.decorators import login_required_api, role_required_api

airport_transfer_bp = Blueprint('airport_transfer', __name__)

# Constants
SERVICE_TYPE = 'airportTransfer'
PH_TIMEZONE = pytz.timezone('Asia/Manila')

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

# ============================================
# HELPER FUNCTIONS
# ============================================

def get_all_airport_transfer_bookings():
    """Fetch ALL airport transfer bookings from pendingBooking"""
    try:
        pending_ref = db.reference('/pendingBooking')
        pending_data = pending_ref.get()
        
        if not pending_data:
            return []
        
        bookings = []
        for booking_id, booking_data in pending_data.items():
            if booking_data.get('bookingType') == SERVICE_TYPE:
                booking_data['id'] = booking_id
                bookings.append(booking_data)
        
        bookings.sort(key=lambda x: (x.get('date', ''), x.get('time', '')), reverse=True)
        return bookings
        
    except Exception as e:
        print(f"Error fetching airport transfer bookings: {e}")
        return []

def get_airport_transfer_bookings_by_status(status_filter=None):
    """Fetch airport transfer bookings filtered by status field"""
    try:
        pending_ref = db.reference('/pendingBooking')
        pending_data = pending_ref.get()
        
        if not pending_data:
            return []
        
        bookings = []
        for booking_id, booking_data in pending_data.items():
            if booking_data.get('bookingType') != SERVICE_TYPE:
                continue
            
            if status_filter and status_filter != 'all':
                if booking_data.get('status') != status_filter:
                    continue
            
            booking_data['id'] = booking_id
            bookings.append(booking_data)
        
        bookings.sort(key=lambda x: (x.get('date', ''), x.get('time', '')), reverse=True)
        return bookings
        
    except Exception as e:
        print(f"Error fetching airport transfer bookings by status: {e}")
        return []

def get_booking_by_id(booking_id):
    """Fetch a specific booking by ID"""
    try:
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return None
        
        booking_data['id'] = booking_id
        return booking_data
        
    except Exception as e:
        print(f"Error fetching booking {booking_id}: {e}")
        return None

def format_booking_response(booking):
    """Format booking data for API response"""
    return {
        'id': booking.get('id'),
        'bookingType': booking.get('bookingType'),
        'clientName': booking.get('clientName', 'N/A'),
        'clientId': booking.get('clientId'),
        'contactNumber': booking.get('contactNumber', 'N/A'),
        'email': booking.get('email', 'N/A'),
        'amount': float(booking.get('amount', 0)),
        'paymentStatus': booking.get('paymentStatus', 'pending'),
        'paymentMethod': booking.get('paymentMethod', 'N/A'),
        'status': booking.get('status', 'unassigned'),  # Use status field directly
        'date': booking.get('date', ''),
        'time': booking.get('time', ''),
        'pickup': booking.get('pickup', ''),
        'dropoff': booking.get('dropoff', ''),
        'packageType': booking.get('packageType', ''),
        'flight_number': booking.get('flight_number', 'N/A'),
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
# API ROUTES WITH CACHING
# ============================================

@airport_transfer_bp.route('/common/airport-transfer/bookings', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=30)
def get_airport_transfer_bookings():
    """Get airport transfer bookings filtered by status field"""
    try:
        status = request.args.get('status', 'unassigned')
        
        if status == 'all':
            bookings = get_airport_transfer_bookings_by_status()
        else:
            bookings = get_airport_transfer_bookings_by_status(status)
        
        formatted_bookings = [format_booking_response(b) for b in bookings]
        
        return jsonify({
            'success': True,
            'bookings': formatted_bookings,
            'total': len(formatted_bookings),
            'status': status
        }), 200
        
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@airport_transfer_bp.route('/common/airport-transfer/bookings/counts', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_airport_transfer_counts():
    """Get counts for each status"""
    try:
        all_bookings = get_all_airport_transfer_bookings()
        
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

@airport_transfer_bp.route('/common/airport-transfer/bookings/<booking_id>', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=60)
def get_airport_transfer_booking(booking_id):
    """Get detailed information for a specific booking"""
    try:
        booking = get_booking_by_id(booking_id)
        
        if not booking:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        if booking.get('bookingType') != SERVICE_TYPE:
            return jsonify({'success': False, 'message': 'Not an airport transfer booking'}), 400
        
        return jsonify({'success': True, 'booking': format_booking_response(booking)}), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@airport_transfer_bp.route('/common/airport-transfer/bookings/<booking_id>/assign', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def assign_driver_to_airport_transfer(booking_id):
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
        
        if booking_data.get('bookingType') != SERVICE_TYPE:
            return jsonify({'success': False, 'message': 'Not an airport transfer booking'}), 400
        
        if booking_data.get('status') != 'unassigned':
            return jsonify({'success': False, 'message': f'Booking status is {booking_data.get("status")}. Cannot assign.'}), 400
        
        # Get driver details
        driver_ref = db.reference(f'users/{driver_id}')
        driver_data = driver_ref.get()
        
        if not driver_data:
            return jsonify({'success': False, 'message': 'Driver not found'}), 404
        
        # Get vehicle details
        vehicle_ref = db.reference(f'transportUnits/{vehicle_id}')
        vehicle_data = vehicle_ref.get()
        
        if not vehicle_data:
            return jsonify({'success': False, 'message': 'Vehicle not found'}), 404
        
        # Update the booking - change status to 'assigned'
        update_data = {
            'status': 'assigned',
            'assigned_driver': {
                'id': driver_id,
                'name': driver_data.get('fullName', 'N/A'),
                'contact': driver_data.get('contactNumber', 'N/A'),
                'license_number': driver_data.get('licenseNumber', 'No License')
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

@airport_transfer_bp.route('/common/airport-transfer/bookings/<booking_id>/cancel', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def cancel_airport_transfer_booking(booking_id):
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
        
        if booking_data.get('bookingType') != SERVICE_TYPE:
            return jsonify({'success': False, 'message': 'Not an airport transfer booking'}), 400
        
        current_status = booking_data.get('status')
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

@airport_transfer_bp.route('/common/airport-transfer/bookings/<booking_id>/complete', methods=['POST'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
def complete_airport_transfer_booking(booking_id):
    """Mark a booking as completed - updates status to 'completed'"""
    try:
        data = request.get_json()
        completion_notes = data.get('completion_notes', '')
        
        booking_ref = db.reference(f'/pendingBooking/{booking_id}')
        booking_data = booking_ref.get()
        
        if not booking_data:
            return jsonify({'success': False, 'message': 'Booking not found'}), 404
        
        if booking_data.get('bookingType') != SERVICE_TYPE:
            return jsonify({'success': False, 'message': 'Not an airport transfer booking'}), 400
        
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
# DRIVER AND VEHICLE ENDPOINTS
# ============================================

@airport_transfer_bp.route('/common/airport-transfer/drivers/available', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=120)
def get_available_drivers():
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
                    'license_number': user_data.get('licenseNumber', 'No License'),
                    'status': 'available'
                })
        
        return jsonify({'success': True, 'drivers': available_drivers}), 200
        
    except Exception as e:
        print(f"Error getting drivers: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@airport_transfer_bp.route('/common/airport-transfer/vehicles/available', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@cached(timeout=120)
def get_available_vehicles():
    """Get all available vehicles"""
    try:
        units_ref = db.reference('transportUnits')
        all_units = units_ref.get()
        
        if not all_units:
            return jsonify({'success': True, 'vehicles': []}), 200
        
        available_vehicles = []
        
        for unit_id, unit_data in all_units.items():
            is_available = unit_data.get('isAvailable', True)
            
            if is_available:
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
# CACHE MANAGEMENT
# ============================================

@airport_transfer_bp.route('/common/airport-transfer/cache/clear', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def clear_cache():
    try:
        invalidate_cache()
        return jsonify({'success': True, 'message': 'Cache cleared successfully'}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500