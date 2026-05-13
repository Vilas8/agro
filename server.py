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
# STATIC BASE LOCATIONS — one dummy GPS coordinate per machine near Kolar
# ---------------------------------------------------------------------------
MACHINE_BASE_LOCATIONS = {
    'Tractor':          {'lat': 13.1350, 'lng': 78.1320, 'address': 'Kolar Base Yard'},
    'Harvester':        {'lat': 13.1420, 'lng': 78.1280, 'address': 'Mulbagal Road Depot'},
    'Rotavator':        {'lat': 13.1280, 'lng': 78.1390, 'address': 'Bangarpet Storage'},
    'Seed Drill':       {'lat': 13.1510, 'lng': 78.1210, 'address': 'Srinivaspur Yard'},
    'Spray Machine':    {'lat': 13.1190, 'lng': 78.1450, 'address': 'Malur Depot'},
    'Power Tiller':     {'lat': 13.1380, 'lng': 78.1350, 'address': 'Kolar North Base'},
    'Disc Harrow':      {'lat': 13.1460, 'lng': 78.1170, 'address': 'KGF Depot'},
    'Cultivator':       {'lat': 13.1250, 'lng': 78.1430, 'address': 'Robertsonpet Yard'},
}

DEFAULT_BASE = {'lat': 13.1350, 'lng': 78.1320}

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
        base = MACHINE_BASE_LOCATIONS.get(machine_name, DEFAULT_BASE)
        base_lat = float(cfg['base_lat'] or base['lat'])
        base_lng = float(cfg['base_lng'] or base['lng'])
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
        base = MACHINE_BASE_LOCATIONS.get(machine_name, DEFAULT_BASE)
        base_lat = float(cfg['base_lat'] or base['lat'])
        base_lng = float(cfg['base_lng'] or base['lng'])
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
        'version': '3.0',
        'endpoints': [
            'GET  /api/machines/base_locations',
            'GET  /api/distance?user_lat=&user_lng=&machine_name=',
            'POST /api/tracking/simulate',
            'GET  /api/tracking/route?booking_id=',
            'GET  /api/users/profile?email=',
            'PUT  /api/users/profile',
            'GET  /api/users', 'POST /api/users',
            'GET  /api/machine_configs', 'POST /api/machine_configs',
            'GET  /api/bookings', 'POST /api/bookings', 'PUT /api/bookings/<id>',
            'GET  /api/location/latest', 'POST /api/location',
            'GET  /api/geofence_alerts',
        ]
    })


# ---------------------------------------------------------------------------
# FEATURE 1 — Static base locations for all machines
# ---------------------------------------------------------------------------
@app.route('/api/machines/base_locations', methods=['GET'])
def get_machine_base_locations():
    """Returns the static base GPS location for every machine."""
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute('SELECT machine_name, base_lat, base_lng, availability FROM machine_configs')
        db_machines = {r['machine_name']: r for r in cursor.fetchall()}
        cursor.close()
        conn.close()

        result = []
        for name, static in MACHINE_BASE_LOCATIONS.items():
            db = db_machines.get(name, {})
            result.append({
                'machine_name': name,
                'lat':  float(db.get('base_lat') or static['lat']),
                'lng':  float(db.get('base_lng') or static['lng']),
                'address': static.get('address', 'Kolar District'),
                'availability': db.get('availability', 'Available')
            })
        # Also include machines in DB that aren't in the static dict
        for name, row in db_machines.items():
            if name not in MACHINE_BASE_LOCATIONS:
                result.append({
                    'machine_name': name,
                    'lat':  float(row.get('base_lat') or DEFAULT_BASE['lat']),
                    'lng':  float(row.get('base_lng') or DEFAULT_BASE['lng']),
                    'address': 'Kolar District',
                    'availability': row.get('availability', 'Available')
                })
        return jsonify({'isOk': True, 'data': result})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# FEATURE 2 — GPS Tracking: simulate route delivery
# POST /api/tracking/simulate
# Body: { booking_id, machine_name, user_lat, user_lng }
#
# Generates a realistic multi-waypoint route from machine base → user location
# with timing based on average road speed (40 km/h rural, 25 km/h near town)
# ---------------------------------------------------------------------------
@app.route('/api/tracking/simulate', methods=['POST'])
def simulate_delivery_route():
    """Generates + stores a simulated delivery route for a booking."""
    try:
        data = request.get_json(silent=True) or {}
        booking_id   = data.get('booking_id')
        machine_name = data.get('machine_name')
        user_lat     = float(data.get('user_lat', 0))
        user_lng     = float(data.get('user_lng', 0))

        if not machine_name or not user_lat or not user_lng:
            return jsonify({'isOk': False, 'error': 'machine_name, user_lat, user_lng required'}), 400

        # Get machine base
        base = MACHINE_BASE_LOCATIONS.get(machine_name, DEFAULT_BASE)
        start_lat = base['lat']
        start_lng = base['lng']

        # Calculate total distance
        total_dist_km = haversine(start_lat, start_lng, user_lat, user_lng)

        # Simulate route: generate intermediate waypoints along the straight path
        # (In production, replace with OSRM/Google Maps Directions API)
        num_waypoints = max(8, int(total_dist_km * 2))  # ~1 waypoint per 500m
        waypoints = []
        avg_speed_kmph = 35  # realistic tractor/harvester delivery speed
        time_offset_seconds = 0

        for i in range(num_waypoints + 1):
            t = i / num_waypoints
            # Add slight curve variation to look like a real road path
            import math
            # Bezier-like curve with a control point offset
            ctrl_lat = (start_lat + user_lat) / 2 + (user_lng - start_lng) * 0.05
            ctrl_lng = (start_lng + user_lng) / 2 - (user_lat - start_lat) * 0.05
            # Quadratic bezier interpolation
            wlat = (1 - t)**2 * start_lat + 2 * (1 - t) * t * ctrl_lat + t**2 * user_lat
            wlng = (1 - t)**2 * start_lng + 2 * (1 - t) * t * ctrl_lng + t**2 * user_lng

            # Speed variation: slower near start/end (village roads), faster in middle
            if t < 0.1 or t > 0.9:
                segment_speed = 15  # slow: village roads
            elif t < 0.3 or t > 0.7:
                segment_speed = 30  # medium: town roads
            else:
                segment_speed = 45  # fast: highway stretch

            # Calculate heading
            if i < num_waypoints:
                next_t = (i + 1) / num_waypoints
                nl = (1 - next_t)**2 * start_lat + 2*(1-next_t)*next_t*ctrl_lat + next_t**2*user_lat
                ng = (1 - next_t)**2 * start_lng + 2*(1-next_t)*next_t*ctrl_lng + next_t**2*user_lng
                heading = math.degrees(math.atan2(ng - wlng, nl - wlat)) % 360
            else:
                heading = 0

            # Segment distance for time calc
            if i > 0:
                prev_t = (i - 1) / num_waypoints
                pl = (1-prev_t)**2*start_lat + 2*(1-prev_t)*prev_t*ctrl_lat + prev_t**2*user_lat
                pg = (1-prev_t)**2*start_lng + 2*(1-prev_t)*prev_t*ctrl_lng + prev_t**2*user_lng
                seg_dist = haversine(pl, pg, wlat, wlng)
                time_offset_seconds += int((seg_dist / segment_speed) * 3600)

            waypoints.append({
                'seq':       i,
                'lat':       round(wlat, 7),
                'lng':       round(wlng, 7),
                'speed':     segment_speed,
                'heading':   round(heading, 1),
                'eta_seconds': time_offset_seconds  # seconds from departure
            })

        total_eta_minutes = time_offset_seconds // 60

        # Store the route in DB
        conn   = get_conn()
        cursor = conn.cursor()
        import json
        cursor.execute("""
            INSERT INTO delivery_routes
                (booking_id, machine_name, start_lat, start_lng,
                 dest_lat, dest_lng, total_dist_km, eta_minutes, waypoints_json, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'InProgress')
            ON DUPLICATE KEY UPDATE
                dest_lat=%s, dest_lng=%s, total_dist_km=%s,
                eta_minutes=%s, waypoints_json=%s, status='InProgress', updated_at=CURRENT_TIMESTAMP
        """, (
            booking_id, machine_name, start_lat, start_lng,
            user_lat, user_lng, round(total_dist_km, 2), total_eta_minutes,
            json.dumps(waypoints),
            user_lat, user_lng, round(total_dist_km, 2), total_eta_minutes, json.dumps(waypoints)
        ))
        conn.commit()
        route_id = cursor.lastrowid
        cursor.close()
        conn.close()

        return jsonify({
            'isOk': True,
            'route_id': route_id,
            'start': {'lat': start_lat, 'lng': start_lng, 'address': base.get('address', 'Base')},
            'destination': {'lat': user_lat, 'lng': user_lng},
            'total_dist_km': round(total_dist_km, 2),
            'eta_minutes': total_eta_minutes,
            'waypoints': waypoints,
            'machine_name': machine_name
        })
    except Exception as e:
        print(f'simulate route error: {e}')
        return jsonify({'isOk': False, 'error': str(e)}), 500


# GET /api/tracking/route?booking_id=X   — fetch stored route
@app.route('/api/tracking/route', methods=['GET'])
def get_tracking_route():
    try:
        booking_id   = request.args.get('booking_id')
        machine_name = request.args.get('machine_name')
        conn   = get_conn()
        cursor = conn.cursor()
        if booking_id:
            cursor.execute('SELECT * FROM delivery_routes WHERE booking_id = %s ORDER BY updated_at DESC LIMIT 1', (booking_id,))
        elif machine_name:
            cursor.execute("SELECT * FROM delivery_routes WHERE machine_name = %s AND status = 'InProgress' ORDER BY updated_at DESC LIMIT 1", (machine_name,))
        else:
            return jsonify({'isOk': False, 'error': 'booking_id or machine_name required'}), 400
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if not row:
            return jsonify({'isOk': False, 'error': 'No route found'}), 404
        import json
        row['waypoints_json'] = json.loads(row['waypoints_json'] or '[]')
        def _s(r):
            return {k: (v.isoformat() if hasattr(v,'isoformat') else float(v) if hasattr(v,'__float__') else v) for k,v in r.items()}
        return jsonify({'isOk': True, 'data': _s(row)})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# FEATURE 3 — User Profile: get + update
# ---------------------------------------------------------------------------
@app.route('/api/users/profile', methods=['GET'])
def get_user_profile():
    email = request.args.get('email')
    if not email:
        return jsonify({'isOk': False, 'error': 'email param required'}), 400
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute('SELECT id, user_name, user_email, user_phone, profile_photo, address, village, district, status, created_at FROM users WHERE user_email = %s', (email,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        if not user:
            return jsonify({'isOk': False, 'error': 'User not found'}), 404
        def _s(r):
            return {k: (v.isoformat() if hasattr(v,'isoformat') else v) for k,v in r.items()}
        return jsonify({'isOk': True, 'data': _s(user)})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500


@app.route('/api/users/profile', methods=['PUT'])
def update_user_profile():
    """Update user profile. Allowed fields: user_name, user_phone, address, village, district, profile_photo.
       Password change: send current_password + new_password."""
    data = request.get_json(silent=True) or {}
    email = data.get('user_email')
    if not email:
        return jsonify({'isOk': False, 'error': 'user_email required'}), 400
    try:
        conn   = get_conn()
        cursor = conn.cursor()

        # Password change flow
        if data.get('new_password'):
            cursor.execute('SELECT user_password FROM users WHERE user_email = %s', (email,))
            row = cursor.fetchone()
            if not row:
                cursor.close(); conn.close()
                return jsonify({'isOk': False, 'error': 'User not found'}), 404
            if row['user_password'] != data.get('current_password', ''):
                cursor.close(); conn.close()
                return jsonify({'isOk': False, 'error': 'Current password incorrect'}), 403
            cursor.execute('UPDATE users SET user_password = %s, updated_at = CURRENT_TIMESTAMP WHERE user_email = %s',
                           (data['new_password'], email))
            conn.commit()
            cursor.close(); conn.close()
            return jsonify({'isOk': True, 'message': 'Password updated'})

        # Regular profile update
        allowed = ['user_name', 'user_phone', 'address', 'village', 'district', 'profile_photo']
        updates = {k: data[k] for k in allowed if k in data}
        if not updates:
            return jsonify({'isOk': False, 'error': 'No valid fields to update'}), 400
        set_clause = ', '.join([f'{k} = %s' for k in updates])
        cursor.execute(
            f'UPDATE users SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE user_email = %s',
            list(updates.values()) + [email]
        )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'isOk': True, 'message': 'Profile updated successfully'})
    except Exception as e:
        print(f'profile update error: {e}')
        return jsonify({'isOk': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# FEATURE 4 — Distance from machine base to user location
# GET /api/distance?user_lat=&user_lng=&machine_name=
# Also supports legacy: ?lat1=&lng1=&lat2=&lng2=
# ---------------------------------------------------------------------------
@app.route('/api/distance', methods=['GET'])
def get_distance():
    try:
        # New: distance from machine base to user field
        machine_name = request.args.get('machine_name')
        user_lat = request.args.get('user_lat')
        user_lng = request.args.get('user_lng')

        if machine_name and user_lat and user_lng:
            ulat = float(user_lat)
            ulng = float(user_lng)

            # Get base from DB first, fallback to static dict
            conn   = get_conn()
            cursor = conn.cursor()
            cursor.execute('SELECT base_lat, base_lng FROM machine_configs WHERE machine_name = %s', (machine_name,))
            row = cursor.fetchone()
            cursor.close(); conn.close()

            base = MACHINE_BASE_LOCATIONS.get(machine_name, DEFAULT_BASE)
            blat = float(row['base_lat']) if row and row.get('base_lat') else base['lat']
            blng = float(row['base_lng']) if row and row.get('base_lng') else base['lng']

            dist = haversine(blat, blng, ulat, ulng)
            # Estimate travel time at 35 km/h
            travel_minutes = (dist / 35) * 60
            return jsonify({
                'isOk': True,
                'distance_km': round(dist, 2),
                'machine_base': {'lat': blat, 'lng': blng},
                'user_location': {'lat': ulat, 'lng': ulng},
                'estimated_travel_minutes': round(travel_minutes)
            })

        # Legacy support: raw lat1,lng1 → lat2,lng2
        lat1 = float(request.args['lat1'])
        lng1 = float(request.args['lng1'])
        lat2 = float(request.args['lat2'])
        lng2 = float(request.args['lng2'])
        return jsonify({'isOk': True, 'distance_km': round(haversine(lat1, lng1, lat2, lng2), 2)})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 400


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
        def _serialise(row):
            out = {}
            for k, v in row.items():
                if hasattr(v, 'isoformat'):
                    out[k] = v.isoformat()
                elif hasattr(v, '__float__'):
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
# LEGACY  —  /api/bookings/<email>
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
    print(f'AgroBook server v3.0 running on http://localhost:{port}')
    app.run(debug=True, port=port)
