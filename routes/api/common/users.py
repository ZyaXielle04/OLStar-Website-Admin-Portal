from flask import Blueprint, request, jsonify, session, current_app
from firebase_admin import auth, db
import datetime
from backend.decorators import login_required_api, role_required_api, rate_limit

users_bp = Blueprint("users", __name__)

VALID_ROLES = {"admin", "superadmin", "customer", "driver"}
ADMIN_MANAGED_ROLES = {"customer", "driver"}


def get_db_user(user_id):
    return db.reference(f"users/{user_id}").get() or {}


def admin_can_manage_user(user):
    return user.get("role") in ADMIN_MANAGED_ROLES


# ============================================
# GET USERS BY TYPE
# ============================================
@users_bp.route("/users/<user_type>", methods=["GET"])
@rate_limit("120 per minute")
@login_required_api
def get_users(user_type):

    try:
        current_role = session.get("role")

        users_ref = db.reference("users")
        data = users_ref.get() or {}

        result = []

        for uid, user in data.items():
            if not user:
                continue

            role = user.get("role")

            if current_role == "superadmin":

                if user_type == "admin" and role in ["admin", "superadmin"]:
                    result.append({**user, "id": uid})

                elif user_type == "customer" and role == "customer":
                    result.append({**user, "id": uid})

                elif user_type == "driver" and role == "driver":
                    result.append({**user, "id": uid})

            elif current_role == "admin":

                if user_type == "customer" and role == "customer":
                    result.append({**user, "id": uid})

                elif user_type == "driver" and role == "driver":
                    result.append({**user, "id": uid})

            else:
                return jsonify({"users": []})

        return jsonify({"users": result})

    except Exception as e:
        current_app.logger.error(f"Error loading users: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


# ============================================
# GET SINGLE USER
# ============================================
@users_bp.route("/user/<user_id>", methods=["GET"])
@rate_limit("120 per minute")
@login_required_api
@role_required_api(["admin", "superadmin"])
def get_user(user_id):

    try:
        current_role = session.get("role")
        db_user = get_db_user(user_id)

        if current_role == "admin" and not admin_can_manage_user(db_user):
            return jsonify({"error": "Forbidden"}), 403

        user_record = auth.get_user(user_id)

        return jsonify({
            "id": user_record.uid,
            "fullName": db_user.get("fullName"),
            "email": user_record.email,
            "role": db_user.get("role"),
            "transportUnitId": db_user.get("transportUnitId"),  # Add this line
            "createdAt": db_user.get("createdAt")
        })

    except Exception as e:
        current_app.logger.error(f"Error loading user {user_id}: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


# ============================================
# CREATE USER (FIXED)
# ============================================
@users_bp.route("/user/create", methods=["POST"])
@rate_limit("30 per minute")
@login_required_api
@role_required_api(["superadmin"])
def create_user():

    try:
        data = request.json

        email = data.get("email")
        password = data.get("password")
        full_name = data.get("fullName")
        role = data.get("role")

        if not email or not full_name:
            return jsonify({"success": False, "error": "Missing fields"}), 400

        if role not in VALID_ROLES:
            return jsonify({"success": False, "error": "Invalid role"}), 400

        import secrets
        if not password:
            password = secrets.token_urlsafe(10)

        user = auth.create_user(
            email=email,
            password=password,
            display_name=full_name
        )

        uid = user.uid

        db.reference(f"users/{uid}").set({
            "fullName": full_name,
            "email": email,
            "role": role,
            "transportUnitId": data.get("transportUnitId"),  # Add this line
            "createdAt": datetime.datetime.utcnow().isoformat()
        })

        return jsonify({"success": True, "id": uid})

    except Exception as e:
        current_app.logger.error(f"Error creating user: {str(e)}")
        return jsonify({"success": False, "error": "Internal server error"}), 500


# ============================================
# UPDATE USER (FIXED AUTH SAFE)
# ============================================
@users_bp.route("/user/update/<user_id>", methods=["PUT"])
@rate_limit("60 per minute")
@login_required_api
@role_required_api(["admin", "superadmin"])
def update_user(user_id):

    try:
        data = request.json or {}
        current_role = session.get("role")
        target_user = get_db_user(user_id)

        if not target_user:
            return jsonify({"success": False, "error": "User not found"}), 404

        email = data.get("email")
        password = data.get("password")
        full_name = data.get("fullName")
        role = data.get("role")

        if current_role == "admin":
            if not admin_can_manage_user(target_user):
                return jsonify({"success": False, "error": "Forbidden"}), 403

            if role is not None and role != target_user.get("role"):
                return jsonify({"success": False, "error": "Admins cannot change roles"}), 403

            if password:
                return jsonify({"success": False, "error": "Admins cannot change passwords"}), 403

        elif current_role == "superadmin":
            if role is not None and role not in VALID_ROLES:
                return jsonify({"success": False, "error": "Invalid role"}), 400

        update_data = {}

        if email:
            update_data["email"] = email

        if full_name:
            update_data["display_name"] = full_name

        if password:
            update_data["password"] = password

        if update_data:
            auth.update_user(user_id, **update_data)

        db_update = {}

        if full_name is not None:
            db_update["fullName"] = full_name

        if email is not None:
            db_update["email"] = email

        if current_role == "superadmin" and role is not None:
            db_update["role"] = role

        if "transportUnitId" in data:
            db_update["transportUnitId"] = data.get("transportUnitId")

        if db_update:
            db.reference(f"users/{user_id}").update(db_update)

        return jsonify({"success": True})

    except Exception as e:
        current_app.logger.error(f"Error updating user {user_id}: {str(e)}")
        return jsonify({"success": False, "error": "Internal server error"}), 500


# ============================================
# DELETE USER
# ============================================
@users_bp.route("/user/delete/<user_id>", methods=["DELETE"])
@rate_limit("20 per minute")
@login_required_api
@role_required_api(["superadmin"])
def delete_user(user_id):

    try:
        auth.delete_user(user_id)
        db.reference(f"users/{user_id}").delete()

        return jsonify({"success": True})

    except Exception as e:
        current_app.logger.error(f"Error deleting user {user_id}: {str(e)}")
        return jsonify({"success": False, "error": "Internal server error"}), 500
