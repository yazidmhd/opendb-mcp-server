# OpenDB MCP Server

A multi-database MCP (Model Context Protocol) server supporting multiple database systems.

## Supported Databases

| Database | Driver |
|----------|--------|
| PostgreSQL | `pg` |
| MySQL | `mysql2` |
| MariaDB | `mysql2` |
| SQL Server | `mssql` |
| Apache Hive | `hive-driver` |
| Apache Impala | `hive-driver` |

## Prerequisites

- Node.js >= 18.0.0
- npm

## Getting Started

### 1. Clone and Install

```bash
git clone <repo-url>
cd opendb-mcp-server
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Configure Database

Copy the example config and edit with your database credentials:

```bash
cp examples/opendb.toml.example examples/mysql-local.toml
```

Example MySQL configuration:

```toml
[settings]
readonly = false
max_rows = 1000

[[sources]]
id = "mysql-local"
type = "mysql"
host = "localhost"
port = 3306
database = "mydb"
user = "root"
password = "yourpassword"
```

### 4. Choose Transport Method

Choose one of the following methods to run the server:

---

## Option A: HTTP Transport

HTTP runs the server in the background. Good for shared/remote access.

### Find Your IP Address

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'
```

### Setup

1. Edit `start.sh` and update the `--config` path:

```bash
--config /path/to/your/config.toml
```

2. Create logs directory:

```bash
sudo mkdir -p /devlogs && sudo chown $USER /devlogs
```

### Start/Stop Server

```bash
# Start
./start.sh

# Stop
./stop.sh
```

Logs are stored in `/devlogs/opendb-{timestamp}.log`.

### Add to Claude Code (HTTP)

```bash
claude mcp add --transport http opendb http://192.168.1.51:3000/mcp
```

### Test with MCP Inspector (HTTP)

```bash
npx @modelcontextprotocol/inspector
```

Then enter `http://192.168.1.51:3000/mcp` in the UI.

---

## Option B: Stdio Transport

Stdio spawns the server as a subprocess. Simpler setup, no background process needed.

### Add to Claude Code (Stdio)

```bash
claude mcp add opendb -- node /path/to/opendb-mcp-server/dist/index.js --config /path/to/config.toml
```

### Add to Claude Desktop (Stdio)

Add to config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opendb": {
      "command": "node",
      "args": [
        "/path/to/opendb-mcp-server/dist/index.js",
        "--config",
        "/path/to/config.toml"
      ]
    }
  }
}
```

### Test with MCP Inspector (Stdio)

```bash
npx @modelcontextprotocol/inspector node /path/to/dist/index.js --config /path/to/config.toml
```

---

## Configuration

### Global Settings

```toml
[settings]
readonly = false          # Prevent all write operations
max_rows = 1000           # Maximum rows returned per query
query_timeout = 30000     # Query timeout in milliseconds
```

### Environment Variables in Config

Use `${VAR_NAME}` or `${VAR_NAME:-default}`:

```toml
[[sources]]
id = "mysql-prod"
type = "mysql"
host = "${MYSQL_HOST:-localhost}"
password = "${MYSQL_PASSWORD}"
```

## MCP Tools

### `execute_sql`

Execute SQL queries against configured databases.

```json
{
  "sql": "SELECT * FROM users LIMIT 10",
  "params": [],
  "response_format": "markdown"
}
```

### `search_objects`

Explore database schemas.

```json
{ "object_type": "schema" }
{ "object_type": "table", "schema": "mydb" }
{ "object_type": "column", "schema": "mydb", "table": "users" }
```

### `list_sources`

List all configured database connections.

## Removing from Claude Code

```bash
claude mcp remove opendb
```

## License

MIT
