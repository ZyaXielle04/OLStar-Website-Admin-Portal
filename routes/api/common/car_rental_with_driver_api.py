from flask import Blueprint, request, jsonify, session, current_app
from functools import wraps
from firebase_admin import db
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
import atexit
import traceback
from backend.decorators import login_required_api, role_required_api, no_rate_limit

# Import timezone functions from the utils module
from backend.utils.timezone import get_ph_time, parse_ph_datetime

print("[DEBUG] car_rental_with_driver_api.py module loading...")

def log_activity(description, user_id, user_name):
    try:
        activities_ref = db.reference('activities')
        activities_ref.push({
            'description': description,
            'timestamp': get_ph_time().isoformat(),
            'user_id': user_id,
            'user_name': user_name
        })
        print(f"Activity logged: {description}")
    except Exception as e:
        print(f"Error logging activity: {str(e)}")

def calculate_discounted_price(original_price, discount_type, discount_value):
    """Calculate discounted price based on discount type and value"""
    try:
        original = float(original_price)
        
        if discount_type == 'percentage':
            discount_amount = original * (float(discount_value) / 100)
            discounted = original - discount_amount
        elif discount_type == 'fixed':
            discounted = original - float(discount_value)
        else:
            return original_price
        
        return max(0, round(discounted, 2))
    except (ValueError, TypeError):
        return original_price

def is_discount_valid(discount_data):
    """Check if discount is currently valid based on Philippine time"""
    if not discount_data:
        print("[DEBUG] is_discount_valid - No discount data")
        return False
    
    # Check if discount is explicitly marked as inactive
    if discount_data.get('active') == False:
        print("[DEBUG] is_discount_valid - Discount is inactive")
        return False
    
    now = get_ph_time()
    print(f"[DEBUG] is_discount_valid - Current PH time: {now}")
    
    # Check valid from date/time
    valid_from = discount_data.get('validFrom')
    if valid_from:
        from_date = parse_ph_datetime(valid_from)
        print(f"[DEBUG] is_discount_valid - Valid from: {from_date}")
        if from_date:
            # Compare including microseconds
            if now < from_date:
                print(f"[DEBUG] is_discount_valid - DISCOUNT NOT YET ACTIVE")
                return False
    
    # Check valid until date/time
    valid_until = discount_data.get('validUntil')
    if valid_until:
        until_date = parse_ph_datetime(valid_until)
        print(f"[DEBUG] is_discount_valid - Valid until: {until_date}")
        
        if until_date:
            # Add 1 second to make it inclusive? No, discount should expire at the exact time
            # Use >= for expiration check (if now is exactly at or after valid_until)
            if now >= until_date:
                print(f"[DEBUG] is_discount_valid - DISCOUNT EXPIRED (now >= valid_until)")
                return False
            else:
                print(f"[DEBUG] is_discount_valid - Still valid")
    
    print(f"[DEBUG] is_discount_valid - Discount is VALID")
    return True

def cleanup_expired_discounted_rates():
    """Remove discounted rates if discount has expired or doesn't exist"""
    try:
        print("[DEBUG] cleanup_expired_discounted_rates - START")
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = discount_ref.get()
        
        # Check if discount exists and is valid
        discount_exists = discount_data is not None
        discount_valid = is_discount_valid(discount_data) if discount_data else False
        
        print(f"[DEBUG] cleanup_expired_discounted_rates - Discount exists: {discount_exists}, Valid: {discount_valid}")
        
        # If no discount exists OR discount is not valid, delete discounted rates
        if not discount_exists or not discount_valid:
            discounted_ref = db.reference('rates/carRental/withDriver/discountedRates')
            discounted_rates = discounted_ref.get()
            if discounted_rates:
                discounted_ref.delete()
                print("[DEBUG] cleanup_expired_discounted_rates - DELETED discounted rates")
            else:
                print("[DEBUG] cleanup_expired_discounted_rates - No discounted rates to delete")
            return True
        
        print("[DEBUG] cleanup_expired_discounted_rates - Discount is valid, keeping discounted rates")
        return False
    except Exception as e:
        print(f"[DEBUG] cleanup_expired_discounted_rates - ERROR: {str(e)}")
        traceback.print_exc()
        return False

def normalize_metro_manila_rates(rates_data):
    """Normalize Metro Manila rates to handle SUV/MPV nested structure"""
    if not rates_data:
        return {}
    
    normalized = {}
    for rate_type, type_data in rates_data.items():
        normalized[rate_type] = {}
        for vehicle_key, vehicle_data in type_data.items():
            # Check if this is the SUV/MPV nested structure
            if vehicle_key == 'SUV' and isinstance(vehicle_data, dict) and 'MPV' in vehicle_data:
                # Flatten SUV/MPV nested structure
                normalized[rate_type]['SUV/MPV'] = vehicle_data['MPV']
            else:
                # Keep other vehicles as-is (Sedan, Van, etc.)
                normalized[rate_type][vehicle_key] = vehicle_data
    
    return normalized

def normalize_provincial_rates(rates_data):
    """Normalize Provincial rates to handle SUV/MPV nested structure"""
    if not rates_data:
        return {}
    
    normalized = {}
    for package_type, package_data in rates_data.items():
        normalized[package_type] = {}
        for vehicle_key, vehicle_data in package_data.items():
            # Check if this is the SUV/MPV nested structure
            if vehicle_key == 'SUV' and isinstance(vehicle_data, dict) and 'MPV' in vehicle_data:
                # Flatten SUV/MPV nested structure
                normalized[package_type]['SUV/MPV'] = vehicle_data['MPV']
            else:
                # Keep other vehicles as-is (Sedan, Van, etc.)
                normalized[package_type][vehicle_key] = vehicle_data
    
    return normalized

def recalculate_all_discounted_rates(discount_data):
    """Recalculate all discounted rates for with-driver module"""
    try:
        print("[DEBUG] recalculate_all_discounted_rates - START")
        if not discount_data or not is_discount_valid(discount_data):
            print("[DEBUG] recalculate_all_discounted_rates - Discount not valid, cleaning up")
            cleanup_expired_discounted_rates()
            return
        
        discount_type = discount_data.get('discountType')
        discount_value = discount_data.get('value')
        
        print(f"[DEBUG] recalculate_all_discounted_rates - Type: {discount_type}, Value: {discount_value}")
        
        # First, clear existing discounted rates to avoid stale data
        discounted_ref = db.reference('rates/carRental/withDriver/discountedRates')
        discounted_ref.delete()
        print("[DEBUG] recalculate_all_discounted_rates - Cleared existing discounted rates")
        
        # Recalculate Metro Manila rates (handle nested SUV/MPV structure)
        metro_manila_ref = db.reference('rates/carRental/withDriver/metroManila')
        metro_manila_rates = metro_manila_ref.get() or {}
        
        print(f"[DEBUG] recalculate_all_discounted_rates - Metro Manila rates found: {len(metro_manila_rates)} rate types")
        
        for rate_type, type_data in metro_manila_rates.items():
            for vehicle_key, vehicle_data in type_data.items():
                # Handle SUV/MPV nested structure
                if vehicle_key == 'SUV' and isinstance(vehicle_data, dict) and 'MPV' in vehicle_data:
                    # Process MPV under SUV
                    mpv_data = vehicle_data['MPV']
                    for duration_key, price_str in mpv_data.items():
                        try:
                            original_price = float(price_str) if price_str else 0
                            discounted_price = calculate_discounted_price(original_price, discount_type, discount_value)
                            
                            discounted_path = f'rates/carRental/withDriver/discountedRates/metroManila/{rate_type}/SUV/MPV/{duration_key}'
                            discounted_ref = db.reference(discounted_path)
                            discounted_ref.set(str(discounted_price))
                        except (ValueError, TypeError):
                            continue
                else:
                    # Normal flat structure for Sedan, Van, etc.
                    for duration_key, price_str in vehicle_data.items():
                        try:
                            original_price = float(price_str) if price_str else 0
                            discounted_price = calculate_discounted_price(original_price, discount_type, discount_value)
                            
                            discounted_path = f'rates/carRental/withDriver/discountedRates/metroManila/{rate_type}/{vehicle_key}/{duration_key}'
                            discounted_ref = db.reference(discounted_path)
                            discounted_ref.set(str(discounted_price))
                        except (ValueError, TypeError):
                            continue
        
        # Recalculate Provincial rates (handle nested SUV/MPV structure)
        provincial_ref = db.reference('rates/carRental/withDriver/provincial')
        provincial_rates = provincial_ref.get() or {}
        
        print(f"[DEBUG] recalculate_all_discounted_rates - Provincial rates found: {len(provincial_rates)} package types")
        
        for package_type, package_data in provincial_rates.items():
            for vehicle_key, vehicle_data in package_data.items():
                # Handle SUV/MPV nested structure for Provincial
                if vehicle_key == 'SUV' and isinstance(vehicle_data, dict) and 'MPV' in vehicle_data:
                    # Process MPV under SUV
                    mpv_data = vehicle_data['MPV']
                    for destination_key, price_str in mpv_data.items():
                        try:
                            original_price = float(price_str) if price_str else 0
                            discounted_price = calculate_discounted_price(original_price, discount_type, discount_value)
                            
                            discounted_path = f'rates/carRental/withDriver/discountedRates/provincial/{package_type}/SUV/MPV/{destination_key}'
                            discounted_ref = db.reference(discounted_path)
                            discounted_ref.set(str(discounted_price))
                        except (ValueError, TypeError):
                            continue
                else:
                    # Normal flat structure for Sedan, Van, etc.
                    for destination_key, price_str in vehicle_data.items():
                        try:
                            original_price = float(price_str) if price_str else 0
                            discounted_price = calculate_discounted_price(original_price, discount_type, discount_value)
                            
                            discounted_path = f'rates/carRental/withDriver/discountedRates/provincial/{package_type}/{vehicle_key}/{destination_key}'
                            discounted_ref = db.reference(discounted_path)
                            discounted_ref.set(str(discounted_price))
                        except (ValueError, TypeError):
                            continue
                        
        print("[DEBUG] recalculate_all_discounted_rates - COMPLETED")
    except Exception as e:
        print(f"[DEBUG] recalculate_all_discounted_rates - ERROR: {str(e)}")
        traceback.print_exc()

# ========== BACKGROUND SCHEDULER FOR AUTOMATIC DISCOUNT CLEANUP ==========

def scheduled_cleanup_expired_discounts():
    """Background job to clean up expired discounts - runs automatically every hour"""
    print(f"[SCHEDULER] ========================================")
    print(f"[SCHEDULER] Running discount cleanup at {get_ph_time()}")
    print(f"[SCHEDULER] ========================================")
    
    try:
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = discount_ref.get()
        
        print(f"[SCHEDULER] Discount data retrieved: {discount_data is not None}")
        
        if discount_data:
            print(f"[SCHEDULER] Discount type: {discount_data.get('discountType')}")
            print(f"[SCHEDULER] Discount value: {discount_data.get('value')}")
            print(f"[SCHEDULER] Valid from: {discount_data.get('validFrom')}")
            print(f"[SCHEDULER] Valid until: {discount_data.get('validUntil')}")
            
            is_valid = is_discount_valid(discount_data)
            print(f"[SCHEDULER] Discount valid: {is_valid}")
            
            if not is_valid:
                print(f"[SCHEDULER] DISCOUNT EXPIRED - Deleting...")
                # Delete expired discount
                discount_ref.delete()
                print(f"[SCHEDULER] Deleted expired discount from database")
                
                # Delete discounted rates
                discounted_ref = db.reference('rates/carRental/withDriver/discountedRates')
                discounted_rates = discounted_ref.get()
                if discounted_rates:
                    discounted_ref.delete()
                    print(f"[SCHEDULER] Deleted expired discounted rates (had {len(discounted_rates)} items)")
                else:
                    print(f"[SCHEDULER] No discounted rates to delete")
            else:
                print(f"[SCHEDULER] Discount is still valid, no cleanup needed")
        else:
            print(f"[SCHEDULER] No discount found in database")
            # No discount exists, but still check if there are stale discounted rates
            discounted_ref = db.reference('rates/carRental/withDriver/discountedRates')
            discounted_rates = discounted_ref.get()
            if discounted_rates:
                discounted_ref.delete()
                print(f"[SCHEDULER] Cleaned up orphaned discounted rates (had {len(discounted_rates)} items)")
            else:
                print(f"[SCHEDULER] No orphaned discounted rates found")
                
    except Exception as e:
        print(f"[SCHEDULER] ERROR in cleanup job: {str(e)}")
        traceback.print_exc()
    
    print(f"[SCHEDULER] ========================================")
    print(f"[SCHEDULER] Cleanup job completed at {get_ph_time()}")
    print(f"[SCHEDULER] ========================================")

# Initialize the background scheduler
print("[SCHEDULER] Initializing background scheduler...")
scheduler = BackgroundScheduler()

# Add the cleanup job to run every hour
print("[SCHEDULER] Adding cleanup job to scheduler (interval: 1 hour)...")
scheduler.add_job(
    func=scheduled_cleanup_expired_discounts,
    trigger=IntervalTrigger(hours=1),
    id='discount_cleanup_job',
    name='Clean up expired discounts',
    replace_existing=True
)

# Start the scheduler
print("[SCHEDULER] Starting scheduler...")
scheduler.start()
print(f"[SCHEDULER] Scheduler started! Running: {scheduler.running}")

# Register shutdown handler to stop scheduler when app exits
def shutdown_scheduler():
    print("[SCHEDULER] Shutting down scheduler...")
    scheduler.shutdown()
    print("[SCHEDULER] Scheduler shut down")

atexit.register(shutdown_scheduler)

print("[SCHEDULER] Background discount cleanup scheduler initialized (runs every hour)")
print(f"[SCHEDULER] Next job run time: {scheduler.get_job('discount_cleanup_job').next_run_time}")

# Create blueprint
car_rental_with_driver_api_bp = Blueprint('car_rental_with_driver', __name__, url_prefix='/common/car-rental/with-driver')
print("[DEBUG] Blueprint created: car_rental_with_driver_api_bp")

# ========== BEFORE REQUEST HOOK - Additional cleanup on requests ==========
@car_rental_with_driver_api_bp.before_request
def before_request_check_expired_discount():
    """Check if discount has expired before every request and clean up if needed"""
    # Skip for OPTIONS requests
    if request.method == 'OPTIONS':
        return
    
    # Also run cleanup on requests (as a backup to the scheduler)
    cleanup_expired_discounted_rates()

# ========== GLOBAL DISCOUNT MANAGEMENT ==========

@car_rental_with_driver_api_bp.route('/discount', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_global_discount():
    """Get global discount settings for with-driver"""
    try:
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = discount_ref.get()
        
        if not discount_data:
            return jsonify({'hasDiscount': False})
        
        # Also check validity and clean up when getting discount
        if not is_discount_valid(discount_data):
            cleanup_expired_discounted_rates()
            return jsonify({'hasDiscount': False})
        
        return jsonify({
            'hasDiscount': True,
            'discount': discount_data
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/discount', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def set_global_discount():
    """Set global discount for with-driver"""
    try:
        data = request.json
        discount_type = data.get('discountType')
        discount_value = data.get('value')
        description = data.get('description', '')
        valid_from = data.get('validFrom', '')
        valid_until = data.get('validUntil', '')
        
        if not discount_type or discount_type not in ['percentage', 'fixed']:
            return jsonify({'error': 'Invalid discount type'}), 400
        
        if not discount_value:
            return jsonify({'error': 'Discount value is required'}), 400
        
        try:
            discount_float = float(discount_value)
            if discount_type == 'percentage' and (discount_float < 0 or discount_float > 100):
                return jsonify({'error': 'Percentage must be between 0 and 100'}), 400
            if discount_type == 'fixed' and discount_float < 0:
                return jsonify({'error': 'Fixed discount cannot be negative'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid discount value'}), 400
        
        # Store dates as-is
        valid_from_iso = valid_from if valid_from else ''
        valid_until_iso = valid_until if valid_until else ''
        
        # Validate dates if provided
        if valid_from_iso and valid_until_iso:
            from_date = parse_ph_datetime(valid_from_iso)
            until_date = parse_ph_datetime(valid_until_iso)
            if from_date and until_date and from_date >= until_date:
                return jsonify({'error': 'Valid From date must be before Valid Until date'}), 400
        
        # Store discount settings
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = {
            'discountType': discount_type,
            'value': str(discount_value),
            'description': description,
            'createdAt': get_ph_time().isoformat(),
            'createdBy': session.get('user_id', 'unknown'),
            'active': True
        }
        
        if valid_from_iso:
            discount_data['validFrom'] = valid_from_iso
        
        if valid_until_iso:
            discount_data['validUntil'] = valid_until_iso
        
        discount_ref.set(discount_data)
        
        # Always recalculate discounted rates when setting a new discount
        recalculate_all_discounted_rates(discount_data)
        
        log_activity(f"Set global discount for with-driver: {discount_type} - {discount_value}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Global discount set successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/discount', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def remove_global_discount():
    """Remove global discount and clear discounted rates"""
    try:
        # Delete discount settings
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_ref.delete()
        
        # Clear all discounted rates
        discounted_ref = db.reference('rates/carRental/withDriver/discountedRates')
        discounted_ref.delete()
        
        log_activity("Removed global discount from with-driver", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Global discount removed successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Add a manual cleanup endpoint for debugging
@car_rental_with_driver_api_bp.route('/discount/cleanup', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def manual_cleanup():
    """Manually trigger cleanup of expired discounted rates (for debugging)"""
    try:
        result = cleanup_expired_discounted_rates()
        return jsonify({
            'message': 'Cleanup completed',
            'cleaned': result,
            'timestamp': get_ph_time().isoformat()
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Add a status endpoint to check discount and discounted rates
@car_rental_with_driver_api_bp.route('/discount/status', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def discount_status():
    """Get current discount status for debugging"""
    try:
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = discount_ref.get()
        
        discounted_ref = db.reference('rates/carRental/withDriver/discountedRates')
        discounted_data = discounted_ref.get()
        
        now = get_ph_time()
        
        # Also check scheduler status
        scheduler_info = {
            'running': scheduler.running,
            'jobs': [job.id for job in scheduler.get_jobs()],
            'next_run': str(scheduler.get_job('discount_cleanup_job').next_run_time) if scheduler.get_job('discount_cleanup_job') else None
        }
        
        # Add comparison for debugging
        comparison = None
        if discount_data and discount_data.get('validUntil'):
            valid_until = parse_ph_datetime(discount_data.get('validUntil'))
            if valid_until:
                comparison = {
                    'current_time': now.isoformat(),
                    'valid_until': valid_until.isoformat(),
                    'is_expired': now > valid_until
                }
        
        return jsonify({
            'hasDiscount': discount_data is not None,
            'discount': discount_data,
            'hasDiscountedRates': discounted_data is not None,
            'discountedRatesKeys': list(discounted_data.keys()) if discounted_data else [],
            'currentTime': now.isoformat(),
            'isValid': is_discount_valid(discount_data) if discount_data else False,
            'scheduler': scheduler_info,
            'comparison': comparison
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ========== LOCATION MANAGEMENT (Metro Manila Locations) ==========

@car_rental_with_driver_api_bp.route('/locations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_locations():
    """Get all locations for Metro Manila with-driver"""
    try:
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        all_locations = locations_ref.get()
        
        if not all_locations:
            return jsonify({'locations': []})
        
        locations_list = []
        for loc_key, loc_data in all_locations.items():
            locations_list.append({
                'key': loc_key,
                'name': loc_data.get('name', loc_key),
                'isActive': loc_data.get('isActive', 'true') == 'true'
            })
        
        return jsonify({'locations': locations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def add_location():
    """Add a new Metro Manila location - Superadmin only"""
    try:
        data = request.json
        location_name = data.get('name', '').strip()
        
        if not location_name:
            return jsonify({'error': 'Location name is required'}), 400
        
        location_key = location_name.lower().replace(' ', '_')
        
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        
        existing = locations_ref.child(location_key).get()
        if existing:
            return jsonify({'error': f'Location "{location_name}" already exists'}), 400
        
        locations_ref.child(location_key).set({
            'name': location_name,
            'isActive': 'true'
        })
        
        log_activity(f"Added with-driver location: {location_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations/<location_key>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def update_location(location_key):
    """Update Metro Manila location details - Superadmin only"""
    try:
        data = request.json
        locations_ref = db.reference(f'rates/carRental/withDriver/locations/{location_key}')
        
        existing = locations_ref.get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        updates = {}
        if 'name' in data:
            updates['name'] = data['name']
        if 'isActive' in data:
            updates['isActive'] = 'true' if data['isActive'] else 'false'
        
        locations_ref.update(updates)
        
        log_activity(f"Updated with-driver location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Location updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations/<location_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_location(location_key):
    """Delete a Metro Manila location - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        locations_ref.child(location_key).delete()
        
        log_activity(f"Deleted with-driver location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Location "{location_key}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/locations/<location_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def toggle_location(location_key):
    """Toggle Metro Manila location active status - Superadmin only"""
    try:
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        
        existing = locations_ref.child(location_key).get()
        if not existing:
            return jsonify({'error': 'Location not found'}), 404
        
        current_status = existing.get('isActive', 'true') == 'true'
        new_status = not current_status
        
        locations_ref.child(location_key).update({'isActive': 'true' if new_status else 'false'})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} with-driver location: {location_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Location has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== DURATION MANAGEMENT ==========

@car_rental_with_driver_api_bp.route('/durations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_durations():
    """Get all durations for with-driver Metro Manila"""
    try:
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        all_durations = durations_ref.get()
        
        if not all_durations:
            return jsonify({'durations': []})
        
        durations_list = []
        for hours_key, dur_data in all_durations.items():
            is_active = dur_data.get('isActive', True)
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            durations_list.append({
                'key': hours_key,
                'hours': int(hours_key),
                'name': dur_data.get('name', f"{hours_key} Hours"),
                'isActive': is_active
            })
        
        durations_list.sort(key=lambda x: x['hours'])
        
        return jsonify({'durations': durations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/durations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def add_duration():
    """Add a new duration - Superadmin only"""
    try:
        data = request.json
        duration_name = data.get('name', '').strip()
        hours = str(data.get('hours', '0'))
        
        if not duration_name:
            return jsonify({'error': 'Duration name is required'}), 400
        if not hours or int(hours) <= 0:
            return jsonify({'error': 'Valid hours are required'}), 400
        
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        
        existing = durations_ref.child(hours).get()
        if existing:
            return jsonify({'error': f'Duration with {hours} hours already exists'}), 400
        
        durations_ref.child(hours).set({
            'name': duration_name,
            'isActive': True
        })
        
        log_activity(f"Added with-driver duration: {duration_name} ({hours} hours)", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{duration_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/durations/<int:hours_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_duration(hours_key):
    """Delete a duration - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        
        existing = durations_ref.child(str(hours_key)).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        durations_ref.child(str(hours_key)).delete()
        
        log_activity(f"Deleted with-driver duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Duration "{hours_key} hours" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/durations/<int:hours_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def toggle_duration(hours_key):
    """Toggle duration active status - Superadmin only"""
    try:
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        
        existing = durations_ref.child(str(hours_key)).get()
        if not existing:
            return jsonify({'error': 'Duration not found'}), 404
        
        current_status = existing.get('isActive', True)
        if isinstance(current_status, str):
            current_status = current_status.lower() == 'true'
        
        new_status = not current_status
        
        durations_ref.child(str(hours_key)).update({'isActive': new_status})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} with-driver duration: {hours_key} hours", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Duration has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== METRO MANILA RATES ==========

@car_rental_with_driver_api_bp.route('/metro-manila/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_metro_manila_rates():
    """Get all Metro Manila rates for with-driver (normalized)"""
    try:
        rates_ref = db.reference('rates/carRental/withDriver/metroManila')
        all_rates = rates_ref.get() or {}
        # Normalize the rates to handle SUV/MPV nested structure
        normalized_rates = normalize_metro_manila_rates(all_rates)
        return jsonify({'rates': normalized_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/metro-manila/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def update_metro_manila_rate():
    """Update Metro Manila rate and recalculate discounted version"""
    try:
        data = request.json
        vehicle_type = data.get('vehicleType')
        rate_type = data.get('rateType')
        duration = str(data.get('duration'))
        price = data.get('price', '0')
        
        if not all([vehicle_type, rate_type, duration, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Handle SUV/MPV special case
        if vehicle_type == 'SUV/MPV':
            # Store in nested structure
            rate_path = f'rates/carRental/withDriver/metroManila/{rate_type}/SUV/MPV/{duration}'
        else:
            # Normal flat structure for Sedan, Van, etc.
            rate_path = f'rates/carRental/withDriver/metroManila/{rate_type}/{vehicle_type}/{duration}'
        
        rate_ref = db.reference(rate_path)
        
        if str(price) == '0' or price == 0:
            rate_ref.delete()
        else:
            rate_ref.set(str(price))
        
        # After updating a rate, recalculate all discounted rates to ensure consistency
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = discount_ref.get()
        
        if discount_data:
            recalculate_all_discounted_rates(discount_data)
        else:
            # If no discount, ensure discounted rates are cleaned up
            cleanup_expired_discounted_rates()
        
        log_activity(f"Updated Metro Manila rate for {vehicle_type}: {rate_type}/{duration}hrs = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== PROVINCIAL DESTINATIONS MANAGEMENT ==========

@car_rental_with_driver_api_bp.route('/provincial/destinations', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_provincial_destinations():
    """Get all provincial destinations"""
    try:
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        all_destinations = destinations_ref.get() or {}
        
        destinations_list = []
        for dest_key, dest_data in all_destinations.items():
            is_active = dest_data.get('isActive', True)
            if isinstance(is_active, str):
                is_active = is_active.lower() == 'true'
            
            destinations_list.append({
                'key': dest_key,
                'name': dest_data.get('name', dest_key),
                'isActive': is_active
            })
        
        return jsonify({'destinations': destinations_list})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/provincial/destinations', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def add_provincial_destination():
    """Add a new provincial destination - Superadmin only"""
    try:
        data = request.json
        destination_name = data.get('name', '').strip()
        
        if not destination_name:
            return jsonify({'error': 'Destination name is required'}), 400
        
        destination_key = destination_name.lower().replace(' ', '_')
        
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        
        existing = destinations_ref.child(destination_key).get()
        if existing:
            return jsonify({'error': f'Destination "{destination_name}" already exists'}), 400
        
        destinations_ref.child(destination_key).set({
            'name': destination_name,
            'isActive': True
        })
        
        log_activity(f"Added provincial destination: {destination_name}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Destination "{destination_name}" added successfully'}), 201
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/provincial/destinations/<destination_key>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def delete_provincial_destination(destination_key):
    """Delete a provincial destination - Superadmin only"""
    try:
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        
        existing = destinations_ref.child(destination_key).get()
        if not existing:
            return jsonify({'error': 'Destination not found'}), 404
        
        destinations_ref.child(destination_key).delete()
        
        log_activity(f"Deleted provincial destination: {destination_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': f'Destination "{destination_key}" deleted successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/provincial/destinations/<destination_key>/toggle', methods=['PATCH'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def toggle_provincial_destination(destination_key):
    """Toggle provincial destination active status - Superadmin only"""
    try:
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        
        existing = destinations_ref.child(destination_key).get()
        if not existing:
            return jsonify({'error': 'Destination not found'}), 404
        
        current_status = existing.get('isActive', True)
        if isinstance(current_status, str):
            current_status = current_status.lower() == 'true'
        
        new_status = not current_status
        
        destinations_ref.child(destination_key).update({'isActive': new_status})
        
        status_text = "activated" if new_status else "deactivated"
        log_activity(f"{status_text.capitalize()} provincial destination: {destination_key}", session.get('user_id'), session.get('display_name'))
        
        return jsonify({
            'message': f'Destination has been {status_text}',
            'isActive': new_status
        }), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== PROVINCIAL RATES ==========

@car_rental_with_driver_api_bp.route('/provincial/rates', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_provincial_rates():
    """Get all Provincial rates for with-driver (normalized)"""
    try:
        rates_ref = db.reference('rates/carRental/withDriver/provincial')
        all_rates = rates_ref.get() or {}
        # Normalize the rates to handle SUV/MPV nested structure
        normalized_rates = normalize_provincial_rates(all_rates)
        return jsonify({'rates': normalized_rates})
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


@car_rental_with_driver_api_bp.route('/provincial/rates', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def update_provincial_rate():
    """Update Provincial rate and recalculate discounted version"""
    try:
        data = request.json
        vehicle_type = data.get('vehicleType')
        package_type = data.get('packageType')
        destination = data.get('destination')
        price = data.get('price', '0')
        
        if not all([vehicle_type, package_type, destination, price is not None]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Handle SUV/MPV special case
        if vehicle_type == 'SUV/MPV':
            # Store in nested structure
            rate_path = f'rates/carRental/withDriver/provincial/{package_type}/SUV/MPV/{destination}'
        else:
            # Normal flat structure for Sedan, Van, etc.
            rate_path = f'rates/carRental/withDriver/provincial/{package_type}/{vehicle_type}/{destination}'
        
        rate_ref = db.reference(rate_path)
        
        if str(price) == '0' or price == 0:
            rate_ref.delete()
        else:
            rate_ref.set(str(price))
        
        # After updating a rate, recalculate all discounted rates to ensure consistency
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = discount_ref.get()
        
        if discount_data:
            recalculate_all_discounted_rates(discount_data)
        else:
            # If no discount, ensure discounted rates are cleaned up
            cleanup_expired_discounted_rates()
        
        log_activity(f"Updated Provincial rate for {vehicle_type}: {package_type}/{destination} = ₱{price}", 
                    session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'Rate updated successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== GET ALL RATES (Combined with normalization) ==========

@car_rental_with_driver_api_bp.route('/rates/all', methods=['GET'])
@login_required_api
@role_required_api(['superadmin', 'admin'])
@no_rate_limit
def get_all_rates():
    """Get all with-driver rates (both Metro Manila and Provincial) including discounted rates with normalization"""
    try:
        discount_ref = db.reference('rates/carRental/withDriver/globalDiscount')
        discount_data = discount_ref.get()
        
        # Check if discount is valid (if it exists)
        if discount_data and not is_discount_valid(discount_data):
            discount_data = None
        
        metro_manila_ref = db.reference('rates/carRental/withDriver/metroManila')
        provincial_ref = db.reference('rates/carRental/withDriver/provincial')
        discounted_metro_ref = db.reference('rates/carRental/withDriver/discountedRates/metroManila')
        discounted_provincial_ref = db.reference('rates/carRental/withDriver/discountedRates/provincial')
        
        metro_manila_rates = metro_manila_ref.get() or {}
        provincial_rates = provincial_ref.get() or {}
        discounted_metro_rates = discounted_metro_ref.get() or {}
        discounted_provincial_rates = discounted_provincial_ref.get() or {}
        
        # Normalize Metro Manila rates to handle SUV/MPV nested structure
        normalized_metro = normalize_metro_manila_rates(metro_manila_rates)
        # Normalize Provincial rates to handle SUV/MPV nested structure
        normalized_provincial = normalize_provincial_rates(provincial_rates)
        # Normalize discounted rates as well
        normalized_discounted_metro = normalize_metro_manila_rates(discounted_metro_rates)
        normalized_discounted_provincial = normalize_provincial_rates(discounted_provincial_rates)
        
        return jsonify({
            'metroManila': normalized_metro,
            'provincial': normalized_provincial,
            'discountedMetroManila': normalized_discounted_metro,
            'discountedProvincial': normalized_discounted_provincial,
            'discount': discount_data
        })
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ========== SEED DATABASE ==========

@car_rental_with_driver_api_bp.route('/seed-database', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
@no_rate_limit
def seed_database():
    """Seed the database with sample data for with-driver"""
    try:
        sample_locations = {
            "pasay": {"name": "Pasay", "isActive": True},
            "manila": {"name": "Manila", "isActive": True},
            "makati": {"name": "Makati", "isActive": True},
            "taguig": {"name": "Taguig", "isActive": True},
            "quezon_city": {"name": "Quezon City", "isActive": True}
        }
        
        locations_ref = db.reference('rates/carRental/withDriver/locations')
        locations_ref.set(sample_locations)
        
        sample_durations = {
            "2": {"name": "2 Hours", "isActive": True},
            "4": {"name": "4 Hours", "isActive": True},
            "6": {"name": "6 Hours", "isActive": True},
            "8": {"name": "8 Hours", "isActive": True},
            "12": {"name": "12 Hours", "isActive": True},
            "24": {"name": "24 Hours (1 Day)", "isActive": True}
        }
        
        durations_ref = db.reference('rates/carRental/withDriver/durations')
        durations_ref.set(sample_durations)
        
        sample_destinations = {
            "batangas": {"name": "Batangas", "isActive": True},
            "cavite": {"name": "Cavite", "isActive": True},
            "laguna": {"name": "Laguna", "isActive": True},
            "pampanga": {"name": "Pampanga", "isActive": True},
            "tagaytay": {"name": "Tagaytay", "isActive": True}
        }
        
        destinations_ref = db.reference('rates/carRental/withDriver/provincialDestinations')
        destinations_ref.set(sample_destinations)
        
        log_activity("Seeded car rental with-driver database", session.get('user_id'), session.get('display_name'))
        
        return jsonify({'message': 'With-driver database seeded successfully'}), 200
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return jsonify({'error': str(e)}), 500

print("[DEBUG] car_rental_with_driver_api.py module loaded successfully")