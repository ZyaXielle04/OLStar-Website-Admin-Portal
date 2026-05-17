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
        # Parse ISO format
        if 'Z' in date_string or '+' in date_string:
            dt = datetime.fromisoformat(date_string.replace('Z', '+00:00'))
        else:
            dt = datetime.fromisoformat(date_string)
        
        # If no timezone, assume UTC and convert to PH
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        
        # Convert to PH timezone
        return dt.astimezone(PH_TIMEZONE)
    except:
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