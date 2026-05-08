#!/usr/bin/env bash
set -e

echo ">>> Force-removing mysql-connector-python if present..."
pip uninstall -y mysql-connector-python || true
pip uninstall -y mysql-connector || true

echo ">>> Installing requirements..."
pip install --no-cache-dir -r requirements.txt

echo ">>> Build complete. Installed packages:"
pip list | grep -iE 'pymysql|mysql|flask|cryptography|gunicorn'
