import os
import pymysql
import pymysql.cursors


def get_db_connection():
    """
    Returns a PyMySQL connection already switched into the `agrimachine`
    database (created on first run if it does not exist yet).

    PyMySQL is used instead of mysql-connector-python because the latter
    uses Python's IDNA encoder when resolving hostnames, which raises
    'label too long' on cloud-managed MySQL hosts (Aiven, Railway,
    Render, PlanetScale, etc.) whose hostnames exceed 63 chars.
    PyMySQL passes the hostname directly to the OS socket layer.
    """
    host     = os.getenv('MYSQL_HOST', 'localhost')
    port     = int(os.getenv('MYSQL_PORT', 3306))
    user     = os.getenv('MYSQL_USER', 'root')
    password = os.getenv('MYSQL_PASSWORD', '')
    database = os.getenv('MYSQL_DATABASE', 'defaultdb')

    ssl_disabled = os.getenv('MYSQL_SSL_DISABLED', 'false').lower() == 'true'
    ssl_ca       = os.getenv('MYSQL_SSL_CA', None)

    ssl_config = None
    if not ssl_disabled:
        ssl_config = {'ca': ssl_ca} if ssl_ca else True

    connect_kwargs = dict(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        connect_timeout=15,
    )
    if ssl_config is not None:
        connect_kwargs['ssl'] = ssl_config

    conn = pymysql.connect(**connect_kwargs)

    # Use a plain (non-dict) cursor just for schema setup
    with conn.cursor(pymysql.cursors.Cursor) as cur:

        # Create and select the working database
        # NOTE: CHARACTER SET keyword is required — bare charset name is not valid SQL
        cur.execute(
            'CREATE DATABASE IF NOT EXISTS agrimachine '
            'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
        )
        cur.execute('USE agrimachine')

        # ---------------------------------------------------------------- #
        #  Users                                                            #
        # ---------------------------------------------------------------- #
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

        # ---------------------------------------------------------------- #
        #  Machine configs                                                  #
        # ---------------------------------------------------------------- #
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

        # ---------------------------------------------------------------- #
        #  Bookings                                                         #
        # ---------------------------------------------------------------- #
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

        # ---------------------------------------------------------------- #
        #  GPS machine_locations                                            #
        # ---------------------------------------------------------------- #
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

        # ---------------------------------------------------------------- #
        #  Geofence alerts                                                  #
        # ---------------------------------------------------------------- #
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
    # cursor closed by context manager; return connection (DictCursor is default for app queries)
    return conn
