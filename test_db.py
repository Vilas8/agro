from db import get_db_connection

conn = get_db_connection()
cursor = conn.cursor()

cursor.execute("SELECT * FROM machines")
data = cursor.fetchall()

for row in data:
    print(row)

conn.close()