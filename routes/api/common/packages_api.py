from flask import Blueprint, request, jsonify, session
from firebase_admin import db
from datetime import datetime
import random
import string
from backend.decorators import login_required_api, role_required_api

common_packages_api_bp = Blueprint(
    'common_packages_api',
    __name__,
    url_prefix='/common/packages'
)

# MUST MATCH HTML CHECKBOX VALUES
VALID_VEHICLE_TYPES = ['SUV', 'Sedan', 'Van']


def generate_package_id():
    """Generate unique package ID"""

    while True:

        letters = ''.join(
            random.choices(
                string.ascii_uppercase,
                k=3
            )
        )

        package_id = f"PKG{letters}"

        existing = db.reference(
            f'packages/{package_id}'
        ).get()

        if not existing:
            return package_id


def log_activity(description, user_id, user_name):

    try:

        activities_ref = db.reference('activities')

        activities_ref.push({
            'description': description,
            'timestamp': datetime.now().isoformat(),
            'user_id': user_id,
            'user_name': user_name
        })

    except Exception as e:
        print(f"Error logging activity: {str(e)}")


@common_packages_api_bp.route('')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_packages():

    try:

        packages_ref = db.reference('packages')

        all_packages = packages_ref.get()

        if not all_packages:
            return jsonify({'packages': []})

        packages_list = []

        for package_id, package_data in all_packages.items():

            vehicle_types = package_data.get(
                'vehicleTypes',
                []
            )

            # BACKWARD COMPATIBILITY
            if not vehicle_types:

                old_vehicle = package_data.get(
                    'vehicleType'
                )

                if old_vehicle:
                    vehicle_types = [old_vehicle]

            packages_list.append({
                'id': package_id,
                'packageName': package_data.get(
                    'packageName',
                    ''
                ),
                'maxPax': package_data.get(
                    'maxPax',
                    0
                ),
                'maxLuggage': package_data.get(
                    'maxLuggage',
                    0
                ),
                'vehicleTypes': vehicle_types,
                'created_at': package_data.get(
                    'created_at'
                ),
                'created_by': package_data.get(
                    'created_by'
                ),
                'created_by_name': package_data.get(
                    'created_by_name'
                ),
                'updated_at': package_data.get(
                    'updated_at'
                ),
                'updated_by': package_data.get(
                    'updated_by'
                ),
                'updated_by_name': package_data.get(
                    'updated_by_name'
                )
            })

        return jsonify({
            'packages': packages_list
        })

    except Exception as e:

        print(f"ERROR in get_packages: {str(e)}")

        return jsonify({
            'error': str(e)
        }), 500


@common_packages_api_bp.route('/<package_id>')
@login_required_api
@role_required_api(['superadmin', 'admin'])
def get_package(package_id):

    try:

        package_ref = db.reference(
            f'packages/{package_id}'
        )

        package_data = package_ref.get()

        if not package_data:
            return jsonify({
                'error': 'Package not found'
            }), 404

        package_data['id'] = package_id

        vehicle_types = package_data.get(
            'vehicleTypes',
            []
        )

        # BACKWARD COMPATIBILITY
        if not vehicle_types:

            old_vehicle = package_data.get(
                'vehicleType'
            )

            if old_vehicle:
                vehicle_types = [old_vehicle]

        package_data['vehicleTypes'] = vehicle_types

        return jsonify({
            'package': package_data
        })

    except Exception as e:

        print(f"ERROR in get_package: {str(e)}")

        return jsonify({
            'error': str(e)
        }), 500


@common_packages_api_bp.route('', methods=['POST'])
@login_required_api
@role_required_api(['superadmin'])
def create_package():

    try:

        data = request.json

        required_fields = [
            'packageName',
            'maxPax',
            'maxLuggage',
            'vehicleTypes'
        ]

        for field in required_fields:

            if data.get(field) is None:
                return jsonify({
                    'error': f'{field} is required'
                }), 400

        package_name = str(
            data.get('packageName', '')
        ).strip()

        if not package_name:
            return jsonify({
                'error': 'Package name is required'
            }), 400

        try:

            max_pax = int(data['maxPax'])

            if max_pax < 1:
                return jsonify({
                    'error': 'Max Pax must be at least 1'
                }), 400

        except:

            return jsonify({
                'error': 'Invalid Max Pax'
            }), 400

        try:

            max_luggage = int(data['maxLuggage'])

            if max_luggage < 0:
                return jsonify({
                    'error': 'Max luggage cannot be negative'
                }), 400

        except:

            return jsonify({
                'error': 'Invalid Max Luggage'
            }), 400

        vehicle_types = data.get(
            'vehicleTypes',
            []
        )

        if (
            not isinstance(vehicle_types, list)
            or len(vehicle_types) == 0
        ):
            return jsonify({
                'error': 'Select at least one vehicle type'
            }), 400

        # REMOVE DUPLICATES
        vehicle_types = list(set(vehicle_types))

        for vehicle_type in vehicle_types:

            if vehicle_type not in VALID_VEHICLE_TYPES:

                return jsonify({
                    'error': f'Invalid vehicle type: {vehicle_type}'
                }), 400

        package_id = generate_package_id()

        new_package = {
            'packageName': package_name,
            'maxPax': max_pax,
            'maxLuggage': max_luggage,
            'vehicleTypes': vehicle_types,
            'created_at': datetime.now().isoformat(),
            'created_by': session.get('user_id'),
            'created_by_name': session.get('display_name')
        }

        db.reference(
            f'packages/{package_id}'
        ).set(new_package)

        log_activity(
            f"Created package: {package_id}",
            session.get('user_id'),
            session.get('display_name')
        )

        return jsonify({
            'message': 'Package created successfully',
            'package_id': package_id,
            'package': new_package
        }), 201

    except Exception as e:

        print(f"ERROR in create_package: {str(e)}")

        return jsonify({
            'error': str(e)
        }), 500


@common_packages_api_bp.route('/<package_id>', methods=['PUT'])
@login_required_api
@role_required_api(['superadmin'])
def update_package(package_id):

    try:

        data = request.json

        package_ref = db.reference(
            f'packages/{package_id}'
        )

        existing = package_ref.get()

        if not existing:
            return jsonify({
                'error': 'Package not found'
            }), 404

        update_data = {}

        if 'packageName' in data:

            package_name = str(
                data['packageName']
            ).strip()

            if not package_name:
                return jsonify({
                    'error': 'Package name is required'
                }), 400

            update_data['packageName'] = package_name

        if 'maxPax' in data:

            try:

                max_pax = int(data['maxPax'])

                if max_pax < 1:
                    return jsonify({
                        'error': 'Max Pax must be at least 1'
                    }), 400

                update_data['maxPax'] = max_pax

            except:

                return jsonify({
                    'error': 'Invalid Max Pax'
                }), 400

        if 'maxLuggage' in data:

            try:

                max_luggage = int(
                    data['maxLuggage']
                )

                if max_luggage < 0:
                    return jsonify({
                        'error': 'Max luggage cannot be negative'
                    }), 400

                update_data['maxLuggage'] = max_luggage

            except:

                return jsonify({
                    'error': 'Invalid Max Luggage'
                }), 400

        if 'vehicleTypes' in data:

            vehicle_types = data['vehicleTypes']

            if (
                not isinstance(vehicle_types, list)
                or len(vehicle_types) == 0
            ):
                return jsonify({
                    'error': 'Select at least one vehicle type'
                }), 400

            vehicle_types = list(set(vehicle_types))

            for vehicle_type in vehicle_types:

                if vehicle_type not in VALID_VEHICLE_TYPES:

                    return jsonify({
                        'error': f'Invalid vehicle type: {vehicle_type}'
                    }), 400

            update_data['vehicleTypes'] = vehicle_types

        update_data['updated_at'] = datetime.now().isoformat()

        update_data['updated_by'] = session.get(
            'user_id'
        )

        update_data['updated_by_name'] = session.get(
            'display_name'
        )

        package_ref.update(update_data)

        log_activity(
            f"Updated package: {package_id}",
            session.get('user_id'),
            session.get('display_name')
        )

        return jsonify({
            'message': 'Package updated successfully'
        })

    except Exception as e:

        print(f"ERROR in update_package: {str(e)}")

        return jsonify({
            'error': str(e)
        }), 500


@common_packages_api_bp.route('/<package_id>', methods=['DELETE'])
@login_required_api
@role_required_api(['superadmin'])
def delete_package(package_id):

    try:

        package_ref = db.reference(
            f'packages/{package_id}'
        )

        existing = package_ref.get()

        if not existing:
            return jsonify({
                'error': 'Package not found'
            }), 404

        package_name = existing.get(
            'packageName',
            package_id
        )

        package_ref.delete()

        log_activity(
            f"Deleted package: {package_id} - {package_name}",
            session.get('user_id'),
            session.get('display_name')
        )

        return jsonify({
            'message': 'Package deleted successfully'
        })

    except Exception as e:

        print(f"ERROR in delete_package: {str(e)}")

        return jsonify({
            'error': str(e)
        }), 500