from flask import Flask, request, jsonify
from flask_cors import CORS
from db import get_db_connection
from math import radians, sin, cos, sqrt, atan2
import os
import pymysql
import pymysql.cursors

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# TABLE SCHEMAS
# ---------------------------------------------------------------------------
TABLE_SCHEMAS = {
    'users': {
        'table': 'users',
        'fields': ['user_name', 'user_email', 'user_phone', 'user_password', 'status'],
        'required': ['user_name', 'user_email', 'user_phone', 'user_password']
    },
    'machine_configs': {
        'table': 'machine_configs',
        'fields': ['machine_name', 'rate_per_acre', 'cost_per_km', 'petrol_cost_per_km',
                   'driver_cost', 'availability', 'base_lat', 'base_lng', 'geofence_radius_km'],
        'required': ['machine_name']
    },
    'bookings': {
        'table': 'bookings',
        'fields': ['user_name', 'user_email', 'user_phone', 'machine_name', 'crop_type',
                   'acres', 'distance', 'machine_cost', 'travel_cost', 'driver_cost',
                   'total_cost', 'estimated_hours', 'status', 'field_lat', 'field_lng'],
        'required': ['user_name', 'user_email', 'user_phone', 'machine_name']
    }
}

TYPE_ALIASES = {
    'user': 'users', 'users': 'users',
    'machine_config': 'machine_configs', 'machine_configs': 'machine_configs',
    'booking': 'bookings', 'bookings': 'bookings'
}


def normalize_type(type_):
    normalized = TYPE_ALIASES.get((type_ or '').strip().lower())
    if not normalized:
        raise ValueError(f'Unsupported record type: {type_}')
    return normalized


def get_table_schema(type_):
    return TABLE_SCHEMAS[normalize_type(type_)]


# Helper: return a plain dict cursor connection
def get_conn():
    return get_db_connection()


# ---------------------------------------------------------------------------
# HAVERSINE
# ---------------------------------------------------------------------------
def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


# ---------------------------------------------------------------------------
# AUTO-AVAILABILITY
# ---------------------------------------------------------------------------
def update_machine_availability(machine_name, speed, lat, lng):
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT availability, base_lat, base_lng, geofence_radius_km FROM machine_configs WHERE machine_name = %s',
            (machine_name,)
        )
        cfg = cursor.fetchone()
        if not cfg:
            cursor.close(); conn.close(); return
        if cfg['availability'] == 'Maintenance':
            cursor.close(); conn.close(); return
        base_lat = float(cfg['base_lat'] or 13.135)
        base_lng = float(cfg['base_lng'] or 78.132)
        dist_from_base = haversine(lat, lng, base_lat, base_lng)
        new_status = 'Busy' if (speed is not None and float(speed) > 2) or dist_from_base >= 0.5 else 'Available'
        cursor.execute(
            'UPDATE machine_configs SET availability = %s WHERE machine_name = %s',
            (new_status, machine_name)
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f'auto-availability error: {e}')


# ---------------------------------------------------------------------------
# GEOFENCE CHECK
# ---------------------------------------------------------------------------
def check_geofence(machine_name, lat, lng):
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, field_lat, field_lng FROM bookings WHERE machine_name = %s AND status = 'Confirmed' ORDER BY created_at DESC LIMIT 1",
            (machine_name,)
        )
        booking = cursor.fetchone()
        cursor.execute(
            'SELECT base_lat, base_lng, geofence_radius_km FROM machine_configs WHERE machine_name = %s',
            (machine_name,)
        )
        cfg = cursor.fetchone()
        if not cfg:
            cursor.close(); conn.close(); return
        base_lat = float(cfg['base_lat'] or 13.135)
        base_lng = float(cfg['base_lng'] or 78.132)
        radius   = float(cfg['geofence_radius_km'] or 50)
        dist_from_base = haversine(lat, lng, base_lat, base_lng)
        if not booking and dist_from_base > 0.5:
            cursor.execute(
                "INSERT INTO geofence_alerts (machine_name, alert_type, lat, lng, message) VALUES (%s, 'Unauthorised', %s, %s, %s)",
                (machine_name, lat, lng, f'{machine_name} moved {dist_from_base:.1f} km from base with no active booking')
            )
            conn.commit()
        elif booking and dist_from_base > radius:
            cursor.execute(
                "INSERT INTO geofence_alerts (machine_name, alert_type, lat, lng, booking_id, message) VALUES (%s, 'OutOfZone', %s, %s, %s, %s)",
                (machine_name, lat, lng, booking['id'], f'{machine_name} is {dist_from_base:.1f} km from base — outside {radius} km zone')
            )
            conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f'geofence check error: {e}')


# ---------------------------------------------------------------------------
# ROOT HEALTH CHECK
# ---------------------------------------------------------------------------
@app.route('/', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'service': 'AgroBook API',
        'version': '2.0',
        'db_driver': 'PyMySQL',
        'endpoints': [
            'GET  /api/users',
            'POST /api/users',
            'GET  /api/machine_configs',
            'POST /api/machine_configs',
            'PUT  /api/machine_configs/<id>',
            'GET  /api/bookings',
            'POST /api/bookings',
            'PUT  /api/bookings/<id>',
            'GET  /api/location/latest',
            'POST /api/location',
            'GET  /api/location/<machine_name>',
            'GET  /api/geofence_alerts',
            'POST /api/geofence_alerts/<id>/resolve',
            'GET  /api/distance?lat1=&lng1=&lat2=&lng2='
        ]
    })


# ---------------------------------------------------------------------------
# GENERIC CRUD  —  POST (create)
# ---------------------------------------------------------------------------
@app.route('/api/<type_>', methods=['POST'])
def create_record(type_):
    try:
        data = request.get_json(silent=True) or {}
        print(f'POST /api/{type_} body: {data}')
        schema = get_table_schema(type_)
        table  = schema['table']
        for field in schema['required']:
            if field not in data or data[field] in (None, ''):
                return jsonify({'isOk': False, 'error': f'Missing required field: {field}'}), 400
        conn   = get_conn()
        cursor = conn.cursor()
        fields       = [f for f in schema['fields'] if f in data]
        placeholders = ', '.join(['%s'] * len(fields))
        query        = f"INSERT INTO {table} ({', '.join(fields)}) VALUES ({placeholders})"
        cursor.execute(query, [data[f] for f in fields])
        conn.commit()
        record_id = cursor.lastrowid
        cursor.close()
        conn.close()
        return jsonify({'isOk': True, 'record_id': record_id})
    except pymysql.err.IntegrityError as e:
        return jsonify({'isOk': False, 'error': f'Duplicate entry: {str(e)}'}), 409
    except ValueError as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400
    except Exception as e:
        print(f'ERROR create_record: {e}')
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GENERIC CRUD  —  GET (list)
# ---------------------------------------------------------------------------
@app.route('/api/<type_>', methods=['GET'])
def list_records(type_):
    try:
        normalized = normalize_type(type_)
        schema     = TABLE_SCHEMAS[normalized]
        table      = schema['table']
        conn   = get_conn()
        cursor = conn.cursor()
        email = request.args.get('email')
        if normalized in ('bookings', 'users') and email:
            cursor.execute(f'SELECT * FROM {table} WHERE user_email = %s ORDER BY created_at DESC', (email,))
        elif normalized in ('bookings', 'users'):
            cursor.execute(f'SELECT * FROM {table} ORDER BY created_at DESC')
        else:
            cursor.execute(f'SELECT * FROM {table} ORDER BY updated_at DESC')
        records = cursor.fetchall()
        cursor.close()
        conn.close()
        # Convert non-serialisable types (Decimal, datetime) to plain Python
        def _serialise(row):
            out = {}
            for k, v in row.items():
                if hasattr(v, 'isoformat'):   # datetime / date
                    out[k] = v.isoformat()
                elif hasattr(v, '__float__'):  # Decimal
                    out[k] = float(v)
                else:
                    out[k] = v
            return out
        return jsonify({'isOk': True, 'data': [_serialise(r) for r in records]})
    except ValueError as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400
    except Exception as e:
        print(f'ERROR list_records: {e}')
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GENERIC CRUD  —  PUT (update)
# ---------------------------------------------------------------------------
@app.route('/api/<type_>/<int:record_id>', methods=['PUT'])
def update_record(type_, record_id):
    try:
        data   = request.get_json(silent=True) or {}
        schema = get_table_schema(type_)
        table  = schema['table']
        editable = [f for f in schema['fields'] if f in data]
        if not editable:
            return jsonify({'isOk': False, 'error': 'No valid fields provided for update'}), 400
        conn   = get_conn()
        cursor = conn.cursor()
        set_clause = ', '.join([f'{f} = %s' for f in editable])
        query = f'UPDATE {table} SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = %s'
        cursor.execute(query, [data[f] for f in editable] + [record_id])
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'isOk': True})
    except ValueError as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400
    except Exception as e:
        print(f'ERROR update_record: {e}')
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GENERIC CRUD  —  DELETE
# ---------------------------------------------------------------------------
@app.route('/api/<type_>/<int:record_id>', methods=['DELETE'])
def delete_record(type_, record_id):
    try:
        schema = get_table_schema(type_)
        conn   = get_conn()
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


# ---------------------------------------------------------------------------
# GPS  —  POST location ping
# ---------------------------------------------------------------------------
@app.route('/api/location', methods=['POST'])
def receive_location():
    data = request.get_json(silent=True) or {}
    for field in ['machine_name', 'lat', 'lng']:
        if field not in data:
            return jsonify({'isOk': False, 'error': f'Missing required field: {field}'}), 400
    try:
        lat          = float(data['lat'])
        lng          = float(data['lng'])
        speed        = float(data.get('speed', 0))
        machine_name = data['machine_name']
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO machine_locations (machine_name, lat, lng, speed, heading, signal_strength, status, booking_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
            (machine_name, lat, lng, speed,
             float(data.get('heading', 0)),
             int(data.get('signal_strength', 100)),
             data.get('status', 'Active'),
             data.get('booking_id'))
        )
        conn.commit()
        cursor.close()
        conn.close()
        update_machine_availability(machine_name, speed, lat, lng)
        check_geofence(machine_name, lat, lng)
        return jsonify({'isOk': True})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GPS  —  GET history for one machine
# ---------------------------------------------------------------------------
@app.route('/api/location/<machine_name>', methods=['GET'])
def get_location_history(machine_name):
    try:
        limit  = int(request.args.get('limit', 200))
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT * FROM machine_locations WHERE machine_name = %s ORDER BY created_at DESC LIMIT %s',
            (machine_name, limit)
        )
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        def _s(row):
            return {k: (v.isoformat() if hasattr(v,'isoformat') else float(v) if hasattr(v,'__float__') else v) for k, v in row.items()}
        return jsonify({'isOk': True, 'data': [_s(r) for r in rows]})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GPS  —  GET latest ping per machine
# ---------------------------------------------------------------------------
@app.route('/api/location/latest', methods=['GET'])
def get_all_latest_locations():
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT ml.*
            FROM machine_locations ml
            INNER JOIN (
                SELECT machine_name, MAX(id) AS max_id
                FROM machine_locations
                GROUP BY machine_name
            ) latest ON ml.machine_name = latest.machine_name AND ml.id = latest.max_id
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        def _s(row):
            return {k: (v.isoformat() if hasattr(v,'isoformat') else float(v) if hasattr(v,'__float__') else v) for k, v in row.items()}
        return jsonify({'isOk': True, 'data': [_s(r) for r in rows]})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GEOFENCE ALERTS
# ---------------------------------------------------------------------------
@app.route('/api/geofence_alerts', methods=['GET'])
def get_geofence_alerts():
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM geofence_alerts WHERE resolved = 0 ORDER BY created_at DESC LIMIT 50')
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        def _s(row):
            return {k: (v.isoformat() if hasattr(v,'isoformat') else float(v) if hasattr(v,'__float__') else v) for k, v in row.items()}
        return jsonify({'isOk': True, 'data': [_s(r) for r in rows]})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


@app.route('/api/geofence_alerts/<int:alert_id>/resolve', methods=['POST'])
def resolve_alert(alert_id):
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute('UPDATE geofence_alerts SET resolved = 1 WHERE id = %s', (alert_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'isOk': True})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# DISTANCE
# ---------------------------------------------------------------------------
@app.route('/api/distance', methods=['GET'])
def get_distance():
    try:
        lat1 = float(request.args['lat1'])
        lng1 = float(request.args['lng1'])
        lat2 = float(request.args['lat2'])
        lng2 = float(request.args['lng2'])
        return jsonify({'isOk': True, 'distance_km': round(haversine(lat1, lng1, lat2, lng2), 2)})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400


# ---------------------------------------------------------------------------
# LEGACY  —  /api/bookings/<email>  (kept for back-compat)
# ---------------------------------------------------------------------------
@app.route('/api/bookings/<user_email>', methods=['GET'])
def get_user_bookings(user_email):
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM bookings WHERE user_email = %s ORDER BY created_at DESC', (user_email,))
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        def _s(row):
            return {k: (v.isoformat() if hasattr(v,'isoformat') else float(v) if hasattr(v,'__float__') else v) for k, v in row.items()}
        return jsonify({'isOk': True, 'data': [_s(r) for r in rows]})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f'AgroBook server running on http://localhost:{port}')
    app.run(debug=True, port=port)
