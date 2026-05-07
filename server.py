from flask import Flask, request, jsonify
from flask_cors import CORS
from db import get_db_connection
import os

app = Flask(__name__)
CORS(app)

# Generic table schemas for CRUD
TABLE_SCHEMAS = {
    'users': {
        'table': 'users',
        'fields': ['user_name', 'user_email', 'user_phone', 'user_password', 'status'],
        'required': ['user_name', 'user_email', 'user_phone', 'user_password']
    },
    'machine_configs': {
        'table': 'machine_configs',
        'fields': ['machine_name', 'rate_per_acre', 'cost_per_km', 'petrol_cost_per_km',
                   'driver_cost', 'availability'],
        'required': ['machine_name']
    },
    'bookings': {
        'table': 'bookings',
        'fields': ['user_name', 'user_email', 'user_phone', 'machine_name', 'crop_type',
                   'acres', 'distance', 'machine_cost', 'travel_cost', 'driver_cost',
                   'total_cost', 'estimated_hours', 'status'],
        'required': ['user_name', 'user_email', 'user_phone', 'machine_name']
    }
}

# Normalize singular/plural and alias types from frontend
TYPE_ALIASES = {
    'user': 'users',
    'users': 'users',
    'machine_config': 'machine_configs',
    'machine_configs': 'machine_configs',
    'booking': 'bookings',
    'bookings': 'bookings'
}


def normalize_type(type_):
    normalized = TYPE_ALIASES.get((type_ or '').strip().lower())
    if not normalized:
        raise ValueError(f'Unsupported record type: {type_}')
    return normalized


def get_table_schema(type_):
    return TABLE_SCHEMAS[normalize_type(type_)]


@app.route('/api/<type_>', methods=['POST'])
def create_record(type_):
    try:
        data = request.get_json(silent=True) or {}
        print(f"🔍 POST /api/{type_} RECEIVED: {data}")

        schema = get_table_schema(type_)
        table = schema['table']

        # Validate required fields
        for field in schema['required']:
            if field not in data or data[field] in (None, ''):
                # FIX: use list(data.keys()) instead of json.dumps(data.keys())
                print(f"❌ VALIDATION FAILED: Missing '{field}' in {list(data.keys())}")
                return jsonify({'isOk': False, 'error': f'Missing required field: {field}'}), 400

        print(f"✅ All required fields present. Inserting into {table}...")

        conn = get_db_connection()
        cursor = conn.cursor()

        fields = [f for f in schema['fields'] if f in data]
        placeholders = ', '.join(['%s'] * len(fields))
        query = f"INSERT INTO {table} ({', '.join(fields)}) VALUES ({placeholders})"

        cursor.execute(query, [data[f] for f in fields])
        conn.commit()
        record_id = cursor.lastrowid
        cursor.close()
        conn.close()

        print(f"✅ Inserted record ID: {record_id}")
        return jsonify({'isOk': True, 'record_id': record_id})
    except ValueError as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400
    except Exception as e:
        print(f"💥 ERROR in create_record: {str(e)}")
        return jsonify({'isOk': False, 'error': str(e)}), 500


@app.route('/api/<type_>', methods=['GET'])
def list_records(type_):
    try:
        normalized = normalize_type(type_)
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        table = TABLE_SCHEMAS[normalized]['table']

        if normalized in ('bookings', 'users'):
            email = request.args.get('email')
            if email:
                cursor.execute(
                    f"SELECT * FROM {table} WHERE user_email = %s ORDER BY created_at DESC",
                    (email,)
                )
            else:
                cursor.execute(f"SELECT * FROM {table} ORDER BY created_at DESC")
        else:
            cursor.execute(f"SELECT * FROM {table} ORDER BY updated_at DESC")

        records = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'isOk': True, 'data': records})
    except ValueError as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


@app.route('/api/<type_>/<int:record_id>', methods=['PUT'])
def update_record(type_, record_id):
    try:
        data = request.get_json(silent=True) or {}
        schema = get_table_schema(type_)
        table = schema['table']

        editable_fields = [f for f in schema['fields'] if f in data]
        if not editable_fields:
            return jsonify({'isOk': False, 'error': 'No valid fields provided for update'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        set_clause = ', '.join([f"{f} = %s" for f in editable_fields])
        query = f"UPDATE {table} SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = %s"
        values = [data[f] for f in editable_fields] + [record_id]

        cursor.execute(query, values)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'isOk': True})
    except ValueError as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


@app.route('/api/<type_>/<int:record_id>', methods=['DELETE'])
def delete_record(type_, record_id):
    try:
        schema = get_table_schema(type_)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(f"DELETE FROM {schema['table']} WHERE id = %s", (record_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'isOk': True})
    except ValueError as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


# Legacy backward-compat endpoint
@app.route('/api/bookings/<user_email>', methods=['GET'])
def get_user_bookings(user_email):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT * FROM bookings WHERE user_email = %s ORDER BY created_at DESC",
            (user_email,)
        )
        bookings = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'isOk': True, 'data': bookings})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f'Server running on http://localhost:{port} with full CRUD API')
    app.run(debug=True, port=port)
