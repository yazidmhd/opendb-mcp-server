#!/bin/bash
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOGFILE="/Users/yazidrazak/devlogs/opendb/opendb-${TIMESTAMP}.log"
CONFIG="/Users/yazidrazak/devcode/simple-projects/simple-mcp-opendb/opendb-mcp-server/examples/mysql-local.toml"

# Read secrets from config file (key=value format)
SECRETS_FILE="/Users/yazidrazak/devcode/configs/pwd-test.txt"

# Helper function to validate secrets
check_secret() {
    if [ -z "$1" ]; then
        echo "Error: Could not read $2 from $SECRETS_FILE"
        exit 1
    fi
}

MYSQL_PWD=$(grep "^dev-password=" "$SECRETS_FILE" | cut -d'=' -f2)
# Add more keys as needed:
# API_KEY=$(grep "^api-key=" "$SECRETS_FILE" | cut -d'=' -f2)
# REDIS_PWD=$(grep "^redis-password=" "$SECRETS_FILE" | cut -d'=' -f2)

check_secret "$MYSQL_PWD" "dev-password"
# Add more checks as needed:
# check_secret "$API_KEY" "api-key"
# check_secret "$REDIS_PWD" "redis-password"

# Inject secrets into config file (portable for macOS and Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/\${OPEN_DB_MYSQL_PWD}/$MYSQL_PWD/" "$CONFIG"
    # Add more replacements as needed:
    # sed -i '' "s/API_KEY_PLACEHOLDER/$API_KEY/" "$CONFIG"
else
    sed -i "s/\${OPEN_DB_MYSQL_PWD}/$MYSQL_PWD/" "$CONFIG"
    # Add more replacements as needed:
    # sed -i "s/API_KEY_PLACEHOLDER/$API_KEY/" "$CONFIG"
fi

TRANSPORT=http PORT=3000 nohup node /Users/yazidrazak/devcode/simple-projects/simple-mcp-opendb/opendb-mcp-server/dist/index.js --config "$CONFIG" > "$LOGFILE" 2>&1 &
echo "OpenDB MCP Server started on http://192.168.1.51:3000"
echo "Logs: $LOGFILE"
