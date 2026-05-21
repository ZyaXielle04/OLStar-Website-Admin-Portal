import os
import sys
import json
import secrets
from datetime import timedelta
from flask import Flask, request, jsonify, session
from dotenv import load_dotenv
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from firebase_admin import credentials, initialize_app, _apps
import cloudinary
import cloudinary.uploader
import cloudinary.api
from cloudinary.utils import cloudinary_url

# Import timezone functions from utils
from utils.timezone import get_ph_time, parse_ph_datetime, format_ph_datetime, get_ph_timezone_str

# -----------------------
# Add paths to Python path
# -----------------------
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

print(f"Root directory: {ROOT_DIR}")
print(f"Backend directory: {BACKEND_DIR}")
print(f"Python path includes: {sys.path[:3]}")

# -----------------------
# Load environment variables
# -----------------------
load_dotenv()
FLASK_ENV = os.getenv("FLASK_ENV", "development")

# -----------------------
# Create Flask app
# -----------------------
app = Flask(
    __name__,
    template_folder=os.path.join(ROOT_DIR, "templates"),
    static_folder=os.path.join(ROOT_DIR, "static")
)

# Inject timezone functions into Jinja2 templates
@app.context_processor
def inject_timezone():
    return {
        'get_ph_time': get_ph_time,
        'format_ph_datetime': format_ph_datetime,
        'get_ph_timezone_str': get_ph_timezone_str
    }

# -----------------------
# Secret key (REQUIRED)
# -----------------------
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY")
if not app.config["SECRET_KEY"]:
    raise RuntimeError("FLASK_SECRET_KEY must be set in environment")

# -----------------------
# Session & cookie security
# -----------------------
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(FLASK_ENV == "production"),
    PERMANENT_SESSION_LIFETIME=timedelta(hours=1),
)

# -----------------------
# CSRF Configuration
# -----------------------
app.config.update(
    WTF_CSRF_CHECK_DEFAULT=False,
    WTF_CSRF_TIME_LIMIT=None
)
csrf = CSRFProtect(app)

# -----------------------
# CSRF Protection Middleware
# -----------------------
@app.before_request
def check_csrf():
    """Check CSRF token for state-changing methods"""
    if request.method not in ['POST', 'PUT', 'DELETE', 'PATCH']:
        return
    
    if request.endpoint in ['health', 'test']:
        return
    
    if request.endpoint and request.endpoint.startswith('static'):
        return
    
    token = request.headers.get('X-CSRFToken') or request.cookies.get('XSRF-TOKEN')
    
    if not token:
        return jsonify({'error': 'CSRF token missing'}), 400
    
    session_token = session.get('_csrf_token')
    if not session_token or token != session_token:
        return jsonify({'error': 'CSRF token invalid'}), 400

@app.after_request
def set_csrf_cookie(response):
    """Set CSRF token cookie for the frontend"""
    try:
        if '_csrf_token' not in session:
            session['_csrf_token'] = secrets.token_hex(32)
        
        response.set_cookie(
            "XSRF-TOKEN",
            session['_csrf_token'],
            secure=(FLASK_ENV == "production"),
            samesite="Lax",
            httponly=False
        )
    except Exception as e:
        print(f"Warning: Could not set CSRF cookie: {e}")
        pass
    
    return response

# -----------------------
# Rate Limiter Configuration
# -----------------------
DEFAULT_LIMITS = ["5000 per day", "1000 per hour"]

def rate_limit_key():
    if session.get("user_id"):
        return f"user:{session['user_id']}"
    return get_remote_address()

limiter = Limiter(
    rate_limit_key,
    app=app,
    default_limits=DEFAULT_LIMITS,
    storage_uri="memory://",
    strategy="fixed-window",
)

@limiter.request_filter
def exempt_from_rate_limiting():
    endpoint = request.endpoint
    if endpoint:
        view_func = app.view_functions.get(endpoint)
        if view_func and hasattr(view_func, '_limiter_exempt'):
            print(f"✓ Rate limit EXEMPT for: {endpoint}")
            return True
    return False

def apply_custom_rate_limits():
    for endpoint, view_func in list(app.view_functions.items()):
        custom_limit = getattr(view_func, '_rate_limit', None)
        if custom_limit:
            app.view_functions[endpoint] = limiter.limit(custom_limit)(view_func)

# -----------------------
# Cloudinary configuration
# -----------------------
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

try:
    print("✓ Cloudinary configured with cloud_name:", os.getenv("CLOUDINARY_CLOUD_NAME"))
    print("✓ Cloudinary API key set:", bool(os.getenv("CLOUDINARY_API_KEY")))
    print("✓ Cloudinary API secret set:", bool(os.getenv("CLOUDINARY_API_SECRET")))
    print("✓ Cloudinary upload preset:", os.getenv("CLOUDINARY_UPLOAD_PRESET"))
except Exception as e:
    print(f"✗ Cloudinary configuration error: {e}")

# -----------------------
# Firebase Admin SDK initialization
# -----------------------
db_url = os.getenv("FIREBASE_DATABASE_URL")
firebase_json_env = os.getenv("FIREBASE_ADMIN_JSON")
firebase_file_env = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

if not db_url:
    raise RuntimeError("FIREBASE_DATABASE_URL must be set")

if not _apps:
    if FLASK_ENV == "production":
        if not firebase_json_env:
            raise RuntimeError("FIREBASE_ADMIN_JSON must be set in production")
        try:
            cred_dict = json.loads(firebase_json_env)
            cred = credentials.Certificate(cred_dict)
        except Exception as e:
            raise RuntimeError(f"Failed to load Firebase JSON from env: {e}")
    else:
        if not firebase_file_env or not os.path.isfile(firebase_file_env):
            raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS must be a valid file path")
        cred = credentials.Certificate(firebase_file_env)

    initialize_app(cred, {"databaseURL": db_url})

# -----------------------
# Import Blueprints
# -----------------------
try:
    from backend.auth import auth_bp
    print("✓ Auth blueprint imported successfully")
except ModuleNotFoundError as e:
    print(f"✗ Failed to import auth blueprint: {e}")
    raise RuntimeError("auth.py not found in /backend")

try:
    from routes.pages import pages_bp
    print("✓ Pages blueprint imported successfully")
except ModuleNotFoundError as e:
    print(f"✗ Failed to import pages blueprint: {e}")
    raise RuntimeError("pages.py not found in /routes")

try:
    from routes.api import api_bp
    print("✓ API blueprint imported successfully")
except ModuleNotFoundError as e:
    print(f"✗ Failed to import API blueprint: {e}")
    routes_api_path = os.path.join(ROOT_DIR, "routes", "api")
    if os.path.exists(routes_api_path):
        print(f"  ✓ Folder exists: {routes_api_path}")
        init_file = os.path.join(routes_api_path, "__init__.py")
        if os.path.exists(init_file):
            print(f"  ✓ __init__.py exists: {init_file}")
        else:
            print(f"  ✗ Missing __init__.py in {routes_api_path}")
    else:
        print(f"  ✗ Folder does not exist: {routes_api_path}")
    
    raise RuntimeError("API blueprint not found in /routes/api")

# -----------------------
# Register Blueprints
# -----------------------
app.register_blueprint(auth_bp)
app.register_blueprint(pages_bp)
app.register_blueprint(api_bp)
apply_custom_rate_limits()

# -----------------------
# Health check
# -----------------------
@app.route("/health")
def health():
    return {
        "status": "ok",
        "timezone": get_ph_timezone_str(),
        "current_time": get_ph_time().isoformat()
    }, 200

@app.route("/test")
def test():
    return {"message": "Flask is working!"}, 200

# -----------------------
# Error handlers
# -----------------------
@app.errorhandler(404)
def not_found(e):
    return "404 - Not Found", 404

@app.errorhandler(500)
def server_error(e):
    return "500 - Internal Server Error", 500

@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({
        'error': 'Rate limit exceeded',
        'message': 'Too many requests. Please try again later.',
        'retry_after': e.description if hasattr(e, 'description') else 60
    }), 429

# -----------------------
# Debug: Print all registered routes
# -----------------------
def print_routes():
    print("\n" + "="*60)
    print("REGISTERED ROUTES:")
    print("="*60)
    routes_found = False
    
    for rule in app.url_map.iter_rules():
        routes_found = True
        endpoint = rule.endpoint
        
        if endpoint.startswith('auth'):
            category = "🔐 AUTH"
        elif endpoint.startswith('pages'):
            category = "📄 PAGES"
        elif endpoint.startswith('api'):
            category = "🔌 API"
        else:
            category = "⚡ OTHER"
        
        print(f"  {category:12} {rule.rule:40} -> {endpoint}")
    
    if not routes_found:
        print("  No routes found!")
    print("="*60 + "\n")

# -----------------------
# Run Flask app
# -----------------------
if __name__ == "__main__":
    print_routes()
    print(f"Starting Flask server in {FLASK_ENV} mode")
    print(f"Timezone: {get_ph_timezone_str()}")
    print(f"Current PH Time: {get_ph_time().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Access your app at: http://localhost:5000")
    print(f"Login page: http://localhost:5000/login")
    print(f"Test endpoint: http://localhost:5000/test")
    print(f"Health check: http://localhost:5000/health")
    print("\nAPI Endpoints:")
    print(f"  Common API: http://localhost:5000/api/common/dashboard/stats")
    print(f"  Common Users: http://localhost:5000/api/common/users")
    print(f"  Admin API: http://localhost:5000/api/admin/dashboard/stats")
    print(f"  Superadmin API: http://localhost:5000/api/superadmin/dashboard/stats")
    print(f"  Superadmin Admins: http://localhost:5000/api/superadmin/admins")
    print("\nPress Ctrl+C to stop the server\n")
    app.run(debug=(FLASK_ENV == "development"), host="0.0.0.0", port=5000)
