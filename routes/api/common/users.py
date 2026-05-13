from flask import Blueprint, request, jsonify, session
from firebase_admin import auth, db
import datetime
from backend.decorators import login_required_api, role_required_api

users_bp = Blueprint("users", __name__)


# ============================================
# GET USERS BY TYPE
# ============================================
@users_bp.route("/users/<user_type>", methods=["GET"])
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

                elif user_type == "admin" and role == "admin":
                    result.append({**user, "id": uid})

            else:
                return jsonify({"users": []})

        return jsonify({"users": result})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================
# GET SINGLE USER
# ============================================
@users_bp.route("/user/<user_id>", methods=["GET"])
@login_required_api
@role_required_api(["admin", "superadmin"])
def get_user(user_id):

    try:
        user_record = auth.get_user(user_id)
        db_user = db.reference(f"users/{user_id}").get() or {}

        return jsonify({
            "id": user_record.uid,
            "fullName": db_user.get("fullName"),
            "email": user_record.email,
            "role": db_user.get("role"),
            "createdAt": db_user.get("createdAt")
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================
# CREATE USER (FIXED)
# ============================================
@users_bp.route("/user/create", methods=["POST"])
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
            "createdAt": datetime.datetime.utcnow().isoformat()
        })

        return jsonify({"success": True, "id": uid})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================
# UPDATE USER (FIXED AUTH SAFE)
# ============================================
@users_bp.route("/user/update/<user_id>", methods=["PUT"])
@login_required_api
@role_required_api(["admin", "superadmin"])
def update_user(user_id):

    try:
        data = request.json

        email = data.get("email")
        password = data.get("password")
        full_name = data.get("fullName")
        role = data.get("role")

        update_data = {
            "email": email,
            "display_name": full_name
        }

        if password:
            update_data["password"] = password

        auth.update_user(user_id, **update_data)

        db.reference(f"users/{user_id}").update({
            "fullName": full_name,
            "email": email,
            "role": role
        })

        return jsonify({"success": True})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================
# DELETE USER
# ============================================
@users_bp.route("/user/delete/<user_id>", methods=["DELETE"])
@login_required_api
@role_required_api(["superadmin"])
def delete_user(user_id):

    try:
        auth.delete_user(user_id)
        db.reference(f"users/{user_id}").delete()

        return jsonify({"success": True})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500