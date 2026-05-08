#!/usr/bin/env bash
set -e

echo "=== AgroBook Build ==="
echo "Python: $(python --version)"

# Nuke old MySQL connector completely
pip uninstall -y mysql-connector-python mysql-connector mysql-connector-python-rf 2>/dev/null || true

# Fresh install with no cache
pip install --no-cache-dir --force-reinstall -r requirements.txt

echo "=== Installed packages ==="
pip list | grep -iE 'pymysql|mysql|flask|cryptography|gunicorn'
echo "=== Build done ==="
