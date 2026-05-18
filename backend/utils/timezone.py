# backend/utils/timezone.py
from datetime import datetime, timezone, timedelta

# Philippine Timezone (UTC+8)
PH_TIMEZONE = timezone(timedelta(hours=8))

def get_ph_time():
    """Get current Philippine time"""
    return datetime.now(PH_TIMEZONE)

def parse_ph_datetime(date_string):
    """Parse datetime string and convert to Philippine timezone"""
    if not date_string:
        return None
    
    try:
        original_string = date_string
        
        # Handle format without seconds: "2026-05-18T02:26"
        if 'T' in date_string and date_string.count(':') == 1:
            # Add seconds and microseconds
            date_string = date_string + ':00.000000'
            print(f"DEBUG: parse_ph_datetime - Added seconds to: {date_string}")
        
        # Parse ISO format
        if 'Z' in date_string or '+' in date_string:
            dt = datetime.fromisoformat(date_string.replace('Z', '+00:00'))
        else:
            dt = datetime.fromisoformat(date_string)
        
        # If no timezone, assume it's already PH time (since it came from frontend)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=PH_TIMEZONE)
        
        print(f"DEBUG: parse_ph_datetime - Input: '{original_string}' -> Output: {dt}")
        return dt
    except Exception as e:
        print(f"DEBUG: parse_ph_datetime ERROR for '{date_string}': {e}")
        return None

def format_ph_datetime(dt):
    """Format datetime for display in Philippine time"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=PH_TIMEZONE)
    return dt.astimezone(PH_TIMEZONE).strftime('%Y-%m-%d %H:%M:%S')

def get_ph_timezone_str():
    """Get timezone string for display"""
    return 'Asia/Manila (UTC+8)'