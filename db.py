import os
import socket
import pymysql
import pymysql.cursors


def _resolve_host(host):
    """
    Resolve hostname to a raw IPv4 address string.
    This completely bypasses Python's IDNA encoder, which crashes on
    cloud MySQL hostnames longer than 63 characters (Aiven, Railway, etc).
    If resolution fails, the original hostname is returned as-is.
    """
    try:
        return socket.gethostbyname(host)
    except Exception:
        return host


def get_db_connection():
    host     = _resolve_host(os.getenv('MYSQL_HOST', 'localhost'))
    port     = int(os.getenv('MYSQL_PORT', 3306))
    user     = os.getenv('MYSQL_USER', 'root')
    password = os.getenv('MYSQL_PASSWORD', '')
    db_name  = os.getenv('MYSQL_DATABASE', 'defaultdb')

    ssl_disabled = os.getenv('MYSQL_SSL_DISABLED', 'false').lower() == 'true'
    ssl_ca       = os.getenv('MYSQL_SSL_CA', None)

    connect_kwargs = dict(
        host=host,
        port=port,
        user=user,
        password=password,
        database=db_name,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        connect_timeout=15,
    )

    if not ssl_disabled and ssl_ca:
        connect_kwargs['ssl'] = {'ca': ssl_ca}

    conn = pymysql.connect(**connect_kwargs)

    with conn.cursor(pymysql.cursors.Cursor) as cur:

        cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_name     VARCHAR(255),
            user_email    VARCHAR(255) UNIQUE,
            user_phone    VARCHAR(20),
            user_password VARCHAR(255),
            status        ENUM('active','inactive') DEFAULT 'active',
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS machine_configs (
            id                 INT AUTO_INCREMENT PRIMARY KEY,
            machine_name       VARCHAR(100) UNIQUE,
            rate_per_acre      DECIMAL(10,2) DEFAULT 800,
            cost_per_km        DECIMAL(10,2) DEFAULT 15,
            petrol_cost_per_km DECIMAL(10,2) DEFAULT 25,
            driver_cost        DECIMAL(10,2) DEFAULT 600,
            availability       ENUM('Available','Busy','Maintenance') DEFAULT 'Available',
            base_lat           DECIMAL(10,7) DEFAULT 13.1350000,
            base_lng           DECIMAL(10,7) DEFAULT 78.1320000,
            geofence_radius_km DECIMAL(5,2)  DEFAULT 50.00,
            updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            user_name       VARCHAR(255),
            user_email      VARCHAR(255),
            user_phone      VARCHAR(20),
            machine_name    VARCHAR(100),
            crop_type       VARCHAR(100),
            acres           DECIMAL(5,2),
            distance        DECIMAL(5,2),
            machine_cost    DECIMAL(10,2),
            travel_cost     DECIMAL(10,2),
            driver_cost     DECIMAL(10,2),
            total_cost      DECIMAL(10,2),
            estimated_hours INT,
            status          ENUM('Pending','Confirmed','Cancelled') DEFAULT 'Pending',
            field_lat       DECIMAL(10,7) DEFAULT NULL,
            field_lng       DECIMAL(10,7) DEFAULT NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS machine_locations (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            machine_name    VARCHAR(100) NOT NULL,
            lat             DECIMAL(10,7) NOT NULL,
            lng             DECIMAL(10,7) NOT NULL,
            speed           DECIMAL(8,2)  DEFAULT 0,
            heading         DECIMAL(8,2)  DEFAULT 0,
            signal_strength INT           DEFAULT 100,
            status          VARCHAR(30)   DEFAULT 'Active',
            booking_id      INT           DEFAULT NULL,
            created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_machine_name (machine_name),
            INDEX idx_created_at   (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS geofence_alerts (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            machine_name VARCHAR(100) NOT NULL,
            alert_type   ENUM('OutOfZone','Unauthorised','ReturnedToBase') NOT NULL,
            lat          DECIMAL(10,7) NOT NULL,
            lng          DECIMAL(10,7) NOT NULL,
            booking_id   INT          DEFAULT NULL,
            message      TEXT,
            resolved     TINYINT(1)   DEFAULT 0,
            created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        conn.commit()

    return conn
