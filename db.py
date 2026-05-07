import mysql.connector

def get_db_connection():
    conn = mysql.connector.connect(
        host="localhost",
        user="root",
        password="pallavigowda542004",  # ⚠️ Put your MySQL password
        database="mysql"  # Connect to mysql first
    )
    cursor = conn.cursor()
    
    # Create agrimachine DB
    cursor.execute("CREATE DATABASE IF NOT EXISTS agrimachine")
    conn.database = "agrimachine"
    
    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_name VARCHAR(255),
            user_email VARCHAR(255) UNIQUE,
            user_phone VARCHAR(20),
            user_password VARCHAR(255),
            status ENUM('active','inactive') DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Machine configs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS machine_configs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            machine_name VARCHAR(100) UNIQUE,
            rate_per_acre DECIMAL(10,2) DEFAULT 800,
            cost_per_km DECIMAL(10,2) DEFAULT 15,
            petrol_cost_per_km DECIMAL(10,2) DEFAULT 25,
            driver_cost DECIMAL(10,2) DEFAULT 600,
            availability ENUM('Available','Busy','Maintenance') DEFAULT 'Available',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)
    
    # Bookings table (fixed with distance)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_name VARCHAR(255),
            user_email VARCHAR(255),
            user_phone VARCHAR(20),
            machine_name VARCHAR(100),
            crop_type VARCHAR(100),
            acres DECIMAL(5,2),
            distance DECIMAL(5,2),
            machine_cost DECIMAL(10,2),
            travel_cost DECIMAL(10,2),
            driver_cost DECIMAL(10,2),
            total_cost DECIMAL(10,2),
            estimated_hours INT,
            status ENUM('Pending','Confirmed','Cancelled') DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    cursor.close()
    return conn
