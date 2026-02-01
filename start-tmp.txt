#!/bin/bash
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOGFILE="/devlogs/opendb-${TIMESTAMP}.log"
CONFIG="/Users/yazidrazak/devcode/simple-projects/simple-mcp-opendb/opendb-mcp-server/examples/mysql-local.toml"

# Read secrets from config file (key=value format)
SECRETS_FILE="/devcode/configs/pwd-test.txt"

# Helper function to validate secrets
check_secret() {
    if [ -z "$1" ]; then
        echo "Error: Could not read $2 from $SECRETS_FILE"
        exit 1
    fi
}

MYSQL_PWD=$(grep "^dev-password=" "$SECRETS_FILE" | cut -d'=' -f2)

check_secret "$MYSQL_PWD" "dev-password"

# Pass password via environment variable (config file uses ${OPEN_DB_MYSQL_PWD} substitution)
OPEN_DB_MYSQL_PWD="$MYSQL_PWD" TRANSPORT=http PORT=3000 nohup node /Users/yazidrazak/devcode/simple-projects/simple-mcp-opendb/opendb-mcp-server/dist/index.js --config "$CONFIG" > "$LOGFILE" 2>&1 &
echo "OpenDB MCP Server started on http://192.168.1.51:3000"
echo "Logs: $LOGFILE"
