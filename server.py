from flask import Flask, request, jsonify
from flask_cors import CORS
from db import get_db_connection
import json
from datetime import datetime

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

def get_table_schema(type_):
    return TABLE_SCHEMAS.get(type_, TABLE_SCHEMAS['bookings'])

@app.route('/api/<type>', methods=['POST'])
def create_record(type_):
    try:
        data = request.json
        print(f"🔍 POST /api/{type_} RECEIVED: {json.dumps(data, indent=2)}")
        print(f"📋 Required fields: {get_table_schema(type_)['required']}")
        
        schema = get_table_schema(type_)
        table = schema['table']
        
        # Validate required fields  
        for field in schema['required']:
            if field not in data:
                print(f"❌ VALIDATION FAILED: Missing '{field}' in {json.dumps(data.keys())}")
                return jsonify({'isOk': False, 'error': f'Missing required field: {field}'}), 400
        
        print(f"✅ All required fields present. Inserting into {table}...")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build INSERT query dynamically
        fields = [f for f in schema['fields'] if f in data]
        placeholders = ', '.join(['%s'] * len(fields))
        query = f"INSERT INTO {table} ({', '.join(fields)}) VALUES ({placeholders})"
        
        cursor.execute(query, [data[f] for f in fields])
        conn.commit()
        record_id = cursor.lastrowid
        conn.close()
        
        print(f"✅ Inserted record ID: {record_id}")
        return jsonify({'isOk': True, 'record_id': record_id})
    except Exception as e:
        print(f"💥 ERROR in create_record: {str(e)}")
        return jsonify({'isOk': False, 'error': str(e)}), 500


@app.route('/api/<type>', methods=['GET'])
def list_records(type_):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        table = get_table_schema(type_)['table']
        
        if type_ == 'bookings' or type_ == 'users':
            email = request.args.get('email')
            if email:
                cursor.execute(f"SELECT * FROM {table} WHERE user_email = %s ORDER BY created_at DESC", (email,))
            else:
                cursor.execute(f"SELECT * FROM {table} ORDER BY created_at DESC")
        else:
            cursor.execute(f"SELECT * FROM {table} ORDER BY updated_at DESC")
            
        records = cursor.fetchall()
        conn.close()
        return jsonify({'isOk': True, 'data': records})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500

@app.route('/api/<type>/<int:id>', methods=['PUT'])
def update_record(type_, id):
    try:
        data = request.json
        schema = get_table_schema(type_)
        table = schema['table']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build UPDATE query
        set_clause = ', '.join([f"{f} = %s" for f in data.keys()])
        query = f"UPDATE {table} SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = %s"
        values = list(data.values()) + [id]
        
        cursor.execute(query, values)
        conn.commit()
        conn.close()
        
        return jsonify({'isOk': True})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500

@app.route('/api/<type>/<int:id>', methods=['DELETE'])
def delete_record(type_, id):
    try:
        table = get_table_schema(type_)['table']
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(f"DELETE FROM {table} WHERE id = %s", (id,))
        conn.commit()
        conn.close()
        return jsonify({'isOk': True})
    except Exception as e:
        return jsonify({'isOk': False, 'error': str(e)}), 500

# Legacy endpoints (for backwards compat)
@app.route('/api/bookings', methods=['POST'])
def create_booking():
    return create_record('bookings')

@app.route('/api/bookings/<user_email>', methods=['GET']) 
def get_user_bookings(user_email):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM bookings WHERE user_email = %s ORDER BY created_at DESC", (user_email,))
    bookings = cursor.fetchall()
    conn.close()
    return jsonify({'isOk': True, 'data': bookings})

if __name__ == '__main__':
    print("Server running on http://localhost:5000 with full CRUD API")
    print("Test: curl -X POST http://localhost:5000/api/bookings -H 'Content-Type: application/json' -d '{\"user_name\":\"test\",\"user_email\":\"test@test.com\",\"machine_name\":\"Grass Cutter\"}'")
    app.run(debug=True, port=5000)

