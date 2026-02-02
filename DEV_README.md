# OpenDB MCP Server - Developer Documentation

A multi-database Model Context Protocol (MCP) server that enables Claude and other AI tools to interact with 7 different database systems through a unified interface.

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Core Components](#core-components)
- [Database Connectors](#database-connectors)
- [MCP Tools Reference](#mcp-tools-reference)
- [Configuration System](#configuration-system)
- [Services](#services)
- [Utilities](#utilities)
- [Security Considerations](#security-considerations)
- [Development Guide](#development-guide)
- [Constants & Defaults](#constants--defaults)

---

## Project Overview

### Purpose

OpenDB MCP Server provides a unified interface for AI assistants (like Claude) to interact with multiple database systems. It implements the Model Context Protocol (MCP), allowing seamless database operations through natural language interactions.

### Key Features

- **Multi-database support**: PostgreSQL, MySQL, MariaDB, SQL Server, Hive, Impala
- **Dual transport modes**: stdio (for Claude Desktop) and HTTP/SSE (for web clients)
- **Progressive schema discovery**: Explore database structures without overwhelming context
- **Kerberos authentication**: Enterprise-ready authentication for Hive/Impala
- **Read-only mode enforcement**: Configurable protection against write operations
- **Environment variable substitution**: Secure credential management in configs
- **Connection pooling**: Efficient database connection management

### Supported Databases

| Database   | Driver            | Default Port | Auth Methods       |
|------------|-------------------|--------------|-------------------|
| PostgreSQL | `pg`              | 5432         | Password, SSL     |
| MySQL      | `mysql2`          | 3306         | Password, SSL     |
| MariaDB    | `mysql2`          | 3306         | Password, SSL     |
| SQL Server | `mssql`           | 1433         | Password, Encrypt |
| Hive       | `hive-driver`     | 10000        | NONE, PLAIN, Kerberos |
| Impala     | `hive-driver`     | 21050        | NONE, PLAIN, Kerberos |

---

## Architecture

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Client                                │
│                  (Claude Desktop, Web Apps)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Transport Layer                              │
│              ┌─────────────┬─────────────────┐                  │
│              │   stdio     │   HTTP/SSE      │                  │
│              │ (StdioServerTransport)  (SSEServerTransport)     │
│              └─────────────┴─────────────────┘                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MCP Server                                  │
│                   (McpServer from SDK)                           │
│         ┌────────────┬────────────┬────────────┐                │
│         │execute_sql │search_objs │list_sources│                │
│         └────────────┴────────────┴────────────┘                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Connector Manager                               │
│              (Factory + Registry Pattern)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ PostgresConn  │   │  MySqlConn    │   │  HiveConn     │
│   (pg)        │   │  (mysql2)     │   │ (hive-driver) │
└───────────────┘   └───────────────┘   └───────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                             │
│       PostgreSQL   MySQL   SQLServer   Hive   Impala             │
└─────────────────────────────────────────────────────────────────┘
```

### Request Flow

```
1. Client sends MCP tool call (e.g., execute_sql)
           │
           ▼
2. Transport receives request (stdio or HTTP/SSE)
           │
           ▼
3. McpServer routes to registered tool handler
           │
           ▼
4. Tool handler (src/tools/*.ts) validates input
           │
           ▼
5. ConnectorManager resolves appropriate connector
           │
           ▼
6. Connector executes query with:
   - Read-only enforcement
   - Row limiting
   - Timeout handling
           │
           ▼
7. Results formatted (Markdown or JSON)
           │
           ▼
8. Response returned through transport
```

### Design Patterns Used

| Pattern          | Implementation                                     | Purpose                              |
|------------------|----------------------------------------------------|--------------------------------------|
| Factory          | `ConnectorManager.createConnector()`               | Database-specific connector creation |
| Template Method  | `BaseConnector.execute()` → `executeQuery()`       | Common execution flow with DB specifics |
| Strategy         | Different connectors for different DBs             | Interchangeable database handlers    |
| Registry         | `ConnectorManager.connectors` Map                  | Central connector lookup             |
| Adapter          | Each connector adapts native driver to IConnector  | Uniform interface across drivers     |

---

## Directory Structure

```
opendb-mcp-server/
├── src/
│   ├── index.ts              # CLI entry point, argument parsing
│   ├── server.ts             # MCP server setup, transport handling
│   ├── constants.ts          # Shared constants and defaults
│   │
│   ├── config/
│   │   ├── loader.ts         # TOML parsing, env var substitution
│   │   ├── schema.ts         # Zod validation schemas
│   │   └── types.ts          # TypeScript interfaces for config
│   │
│   ├── connectors/
│   │   ├── index.ts          # ConnectorManager (factory/registry)
│   │   ├── base.ts           # Abstract BaseConnector class
│   │   ├── types.ts          # IConnector interface, options
│   │   ├── postgres.ts       # PostgreSQL implementation
│   │   ├── mysql.ts          # MySQL/MariaDB implementation
│   │   ├── sqlserver.ts      # SQL Server implementation
│   │   ├── hive.ts           # Apache Hive implementation
│   │   └── impala.ts         # Apache Impala implementation
│   │
│   ├── tools/
│   │   ├── index.ts          # Tool registration with MCP server
│   │   ├── execute-sql.ts    # SQL execution tool
│   │   ├── search-objects.ts # Schema discovery tool
│   │   └── list-sources.ts   # Source listing tool
│   │
│   ├── schemas/
│   │   └── tool-schemas.ts   # Zod schemas for tool inputs
│   │
│   ├── services/
│   │   └── kerberos.ts       # Kerberos authentication service
│   │
│   └── utils/
│       ├── formatters.ts     # Markdown/JSON output formatters
│       ├── error-handler.ts  # Error classes and handling
│       └── logger.ts         # Stderr logger for stdio compat
│
├── examples/
│   ├── mysql-local.toml      # MySQL config example
│   └── mysql-stdio.toml      # MySQL stdio transport example
│
├── dist/                     # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── DEV_README.md             # This file
```

---

## Core Components

### Entry Point (`src/index.ts`)

The main entry point handles:

1. **CLI Argument Parsing** (lines 23-71)
   ```typescript
   interface CliArgs {
     config?: string;    // --config, -c: Path to TOML config
     dsn?: string;       // --dsn, -d: Single database DSN
     transport: 'stdio' | 'http';  // From TRANSPORT env var
     port: number;       // From PORT env var (default: 3000)
     help: boolean;      // --help, -h
     version: boolean;   // --version, -v
   }
   ```

2. **Configuration Loading** (lines 139-151)
   - From TOML file (`--config`)
   - From DSN string (`--dsn`)

3. **Server Lifecycle** (lines 155-177)
   - Creates server via `createServer()`
   - Registers SIGINT/SIGTERM handlers
   - Starts server with chosen transport

### Server (`src/server.ts`)

Creates and configures the MCP server:

1. **Server Creation** (lines 24-42)
   ```typescript
   const connectorManager = new ConnectorManager(config);
   const server = new McpServer({
     name: SERVER_NAME,
     version: SERVER_VERSION,
   });
   registerTools(server, { connectorManager });
   ```

2. **Transport Setup** (lines 49-93)
   - **stdio**: Direct `StdioServerTransport` connection
   - **HTTP/SSE**: Express server with endpoints:
     - `GET /health` - Health check
     - `GET /sse` - SSE connection for MCP
     - `POST /messages` - Message handling

3. **Lifecycle Management** (lines 96-114)
   - `start()`: Connects to all databases, starts transport
   - `stop()`: Closes transport, disconnects all databases

### Connector Manager (`src/connectors/index.ts`)

Central registry and factory for database connectors:

```typescript
class ConnectorManager {
  private connectors: Map<string, IConnector> = new Map();
  private readonly globalOptions: Partial<ConnectorOptions>;

  // Factory method - creates connector by type
  private createConnector(config: SourceConfig): IConnector {
    switch (config.type) {
      case 'postgres': return new PostgresConnector(config, options);
      case 'mysql':
      case 'mariadb':  return new MySqlConnector(config, options);
      // ... etc
    }
  }

  // Resolution methods
  get(sourceId: string): IConnector | undefined;
  getDefault(): IConnector | undefined;
  resolve(sourceId?: string): IConnector;  // Throws if not found

  // Lifecycle
  async connectAll(): Promise<void>;
  async disconnectAll(): Promise<void>;
}
```

### Base Connector (`src/connectors/base.ts`)

Abstract base class implementing common connector logic:

```typescript
abstract class BaseConnector implements IConnector {
  // Template Method pattern
  async execute(sql: string, options?: ExecuteOptions): Promise<QueryResult> {
    // 1. Check connection
    // 2. Enforce read-only mode
    // 3. Call abstract executeQuery()
  }

  // Abstract methods for subclasses
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  protected abstract executeQuery(...): Promise<QueryResult>;
  abstract searchObjects(options?: SchemaSearchOptions): Promise<SchemaObject[]>;

  // Shared utilities
  protected isWriteQuery(sql: string): boolean;
  protected wrapWithLimit(sql: string, maxRows: number): string;
  protected formatRows(rows: unknown[], maxRows: number): {...};
}
```

**Write Query Detection** (lines 89-113):
```typescript
const writeKeywords = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE',
  'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'MERGE',
  'UPSERT', 'REPLACE',
];
```

---

## Database Connectors

### PostgreSQL Connector (`src/connectors/postgres.ts`)

- **Driver**: `pg` (node-postgres)
- **Connection**: Pool with max 5 connections
- **Pooling**: `pg.Pool` with 30s idle timeout

**Connection Configuration** (lines 256-272):
```typescript
// DSN mode
{ connectionString: dsn }

// Host-based mode
{
  host, port: port ?? 5432,
  database, user, password,
  ssl: ssl ? { rejectUnauthorized: false } : undefined,
}
```

**Schema Introspection** (lines 91-254):
- Queries `information_schema.schemata` for schemas
- Queries `information_schema.tables` for tables
- Queries `information_schema.columns` with primary key join
- Queries `pg_indexes` for indexes
- Queries `pg_proc` for procedures/functions

### MySQL Connector (`src/connectors/mysql.ts`)

- **Driver**: `mysql2/promise`
- **Supports**: MySQL and MariaDB (via `type` config)
- **Pooling**: `mysql.Pool` with 5 connections

**MariaDB Detection** (line 21):
```typescript
this.isMariaDb = config.type === 'mariadb';
```

**Result Handling** (lines 82-100):
- `ResultSetHeader` for non-SELECT (INSERT, UPDATE, etc.)
- Returns `affectedRows` and `insertId`

### SQL Server Connector (`src/connectors/sqlserver.ts`)

- **Driver**: `mssql`
- **Row Limiting**: Uses `TOP` instead of `LIMIT`

**LIMIT Override** (lines 48-62):
```typescript
protected override wrapWithLimit(sqlQuery: string, maxRows: number): string {
  // SQL Server uses TOP instead of LIMIT
  return sqlQuery.replace(/^SELECT/i, `SELECT TOP ${maxRows}`);
}
```

**Named Parameters** (lines 80-84):
```typescript
params.forEach((param, index) => {
  request.input(`p${index}`, param);  // @p0, @p1, etc.
});
```

### Hive Connector (`src/connectors/hive.ts`)

- **Driver**: `hive-driver` (dynamically imported)
- **Protocol**: HiveServer2 Thrift
- **Auth**: NONE, PLAIN, KERBEROS

**Dynamic Import** (lines 19-32):
```typescript
async function loadHiveDriver() {
  if (HiveClient === null) {
    const hiveDriver = await import('hive-driver');
    HiveClient = hiveDriver.HiveClient;
    // ...
  }
}
```

**Kerberos Integration** (lines 52-58):
```typescript
if (config.auth_mechanism === 'KERBEROS') {
  this.kerberosAuth = new KerberosAuth({
    keytab: config.keytab,
    principal: config.user_principal,
  });
  await this.kerberosAuth.initialize();
}
```

### Impala Connector (`src/connectors/impala.ts`)

- **Driver**: `hive-driver` (HiveServer2 compatible)
- **Default Port**: 21050 (vs Hive's 10000)
- **Auth**: Same as Hive (NONE, PLAIN, KERBEROS)

Nearly identical implementation to Hive connector, uses the same HiveServer2 protocol.

---

## MCP Tools Reference

### `execute_sql`

Execute SQL queries against configured database sources.

**Parameters**:
| Name            | Type                     | Required | Description                          |
|-----------------|--------------------------|----------|--------------------------------------|
| `source_id`     | `string`                 | No       | Database source ID (optional if single db) |
| `sql`           | `string`                 | Yes      | SQL query to execute                 |
| `params`        | `unknown[]`              | No       | Prepared statement parameters        |
| `response_format` | `'markdown' \| 'json'` | No       | Output format (default: `markdown`)  |

**Behavior**:
1. Resolves connector (by ID or default)
2. Auto-connects if disconnected
3. Enforces read-only mode if configured
4. Applies row limit (wraps SELECT with LIMIT)
5. Formats output as Markdown table or JSON

**Example**:
```json
{
  "source_id": "postgres",
  "sql": "SELECT * FROM users WHERE status = $1",
  "params": ["active"],
  "response_format": "markdown"
}
```

### `search_objects`

Progressive schema discovery for exploring database structures.

**Parameters**:
| Name            | Type                                           | Required | Description                        |
|-----------------|------------------------------------------------|----------|------------------------------------|
| `source_id`     | `string`                                       | No       | Database source ID                 |
| `object_type`   | `'schema' \| 'table' \| 'column' \| 'index' \| 'procedure'` | No | Type to search for |
| `schema`        | `string`                                       | No       | Filter by schema/database          |
| `table`         | `string`                                       | No*      | Table name (required for columns)  |
| `pattern`       | `string`                                       | No       | Search pattern (supports `%` wildcard) |
| `response_format` | `'markdown' \| 'json'`                       | No       | Output format (default: `markdown`) |

**Progressive Discovery Flow**:
```
1. search_objects()                    → List all schemas
2. search_objects(schema='public')     → List tables in schema
3. search_objects(table='users')       → List columns in table
4. search_objects(object_type='index') → List indexes
```

### `list_sources`

List all configured database connections with their status.

**Parameters**:
| Name            | Type                     | Required | Description                          |
|-----------------|--------------------------|----------|--------------------------------------|
| `response_format` | `'markdown' \| 'json'` | No       | Output format (default: `markdown`)  |

**Output** (Markdown):
```markdown
## Configured Database Sources

| ID      | Type     | Mode       |
| ---     | ---      | ---        |
| postgres | postgres | Read-only  |
| mysql    | mysql    | Read/Write |
```

---

## Configuration System

### TOML Format

Configuration files use TOML format with two main sections:

```toml
[settings]
readonly = true           # Global read-only mode
max_rows = 1000          # Default row limit
query_timeout = 30000    # Query timeout (ms)
connection_timeout = 10000  # Connection timeout (ms)

[[sources]]
id = "primary"           # Unique identifier (required)
type = "postgres"        # Database type (required)
# ... type-specific fields
```

### Source Configuration Types

**DSN-based** (PostgreSQL, MySQL, MariaDB, SQL Server):
```toml
[[sources]]
id = "db1"
type = "postgres"
dsn = "postgres://user:pass@localhost:5432/mydb"
```

**Host-based** (PostgreSQL, MySQL, MariaDB, SQL Server):
```toml
[[sources]]
id = "db1"
type = "mysql"
host = "localhost"
port = 3306
database = "mydb"
user = "root"
password = "${MYSQL_PASSWORD}"  # Environment variable
ssl = true
```

**Kerberos-enabled** (Hive, Impala):
```toml
[[sources]]
id = "hive"
type = "hive"
host = "hive.example.com"
port = 10000
database = "default"
auth_mechanism = "KERBEROS"     # NONE, PLAIN, or KERBEROS
principal = "hive/_HOST@REALM"  # Service principal
keytab = "/path/to/user.keytab"
user_principal = "user@REALM"
```

### Environment Variable Substitution

Format: `${VAR_NAME}` or `${VAR_NAME:-default}`

```toml
[[sources]]
id = "prod"
type = "postgres"
host = "${DB_HOST:-localhost}"
password = "${DB_PASSWORD}"     # Required - no default
```

**Implementation** (`src/config/loader.ts:17-33`):
```typescript
function substituteEnvVars(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (match, varExpression) => {
    const [varName, defaultValue] = varExpression.split(':-');
    const envValue = process.env[varName];
    return envValue ?? defaultValue ?? match;
  });
}
```

### Zod Validation Schemas

Configuration is validated using Zod schemas (`src/config/schema.ts`):

```typescript
const settingsSchema = z.object({
  readonly: z.boolean().default(false),
  max_rows: z.number().int().positive().default(1000),
  query_timeout: z.number().int().positive().optional(),
  connection_timeout: z.number().int().positive().optional(),
}).strict();

const sourceSchema = z.union([
  dsnSourceSchema,
  hostBasedSourceSchema,
  kerberosSourceSchema,
]);
```

**Kerberos Validation** (lines 59-69):
```typescript
.refine(
  (data) => {
    if (data.auth_mechanism === 'KERBEROS') {
      return data.keytab && data.user_principal;
    }
    return true;
  },
  { message: 'Kerberos authentication requires keytab and user_principal' }
)
```

---

## Services

### Kerberos Authentication (`src/services/kerberos.ts`)

Manages Kerberos authentication lifecycle for Hive/Impala.

**Class: `KerberosAuth`**

```typescript
class KerberosAuth {
  private initialized = false;
  private ticketExpiry: Date | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  async initialize(): Promise<void>;  // Run kinit
  async destroy(): Promise<void>;     // Run kdestroy
  async refresh(): Promise<void>;     // Refresh ticket
  isValid(): boolean;                 // Check ticket validity
}
```

**Lifecycle**:

1. **Initialize** (lines 29-57)
   - Validates keytab file exists
   - Checks keytab permissions (warns if world-readable)
   - Runs `kinit -kt <keytab> <principal>`
   - Schedules automatic refresh

2. **Ticket Refresh** (lines 199-213)
   - Scheduled 10 minutes before expiry
   - Falls back to 4-hour interval if expiry unknown

3. **Destroy** (lines 62-76)
   - Clears refresh timer
   - Runs `kdestroy`
   - Cleans up state

**External Commands Used**:
- `kinit -kt <keytab> <principal>` - Obtain ticket
- `klist -c` - Check ticket expiry
- `kdestroy` - Destroy credentials

---

## Utilities

### Formatters (`src/utils/formatters.ts`)

**Output Formats**:
- `markdown`: Human-readable Markdown tables
- `json`: Machine-readable JSON

**Query Results Formatting**:
```typescript
// Markdown output
| col1 | col2 | col3 |
| --- | --- | --- |
| val1 | val2 | val3 |

_Showing 10 of 100 rows_ _(results truncated)_

// JSON output
{
  "columns": ["col1", "col2"],
  "rows": [{"col1": "val1", "col2": "val2"}],
  "rowCount": 100,
  "truncated": true
}
```

**Character Limit** (line 6):
```typescript
export const CHARACTER_LIMIT = 100_000;
```
Responses exceeding this limit are truncated with a message.

### Error Handler (`src/utils/error-handler.ts`)

**Error Classes**:
| Class               | Use Case                           |
|--------------------|------------------------------------|
| `DatabaseError`     | Base class for DB errors           |
| `ConnectionError`   | Failed to connect to database      |
| `QueryError`        | Query execution failed             |
| `ConfigurationError`| Invalid configuration              |
| `KerberosError`     | Kerberos authentication failed     |

**Error Formatting** (lines 61-78):
```typescript
function formatErrorForResponse(error: unknown): string {
  if (error instanceof DatabaseError) {
    return `Database Error (${error.sourceId}): ${error.message}`;
  }
  // ... etc
}
```

### Logger (`src/utils/logger.ts`)

**Important**: Writes to `stderr` (not stdout) for stdio transport compatibility.

```typescript
class Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

// Log level from environment
const level = process.env.LOG_LEVEL || 'info';
```

**Output Format**:
```
[2024-01-15T10:30:45.123Z] INFO  Connected to PostgreSQL: primary
[2024-01-15T10:30:46.456Z] ERROR Query execution failed
Error: syntax error at or near "SELEC"
```

---

## Security Considerations

### Read-Only Mode Enforcement

**Global Setting** (`settings.readonly`):
```toml
[settings]
readonly = true  # Applies to all sources
```

**Per-Source Override**:
```toml
[[sources]]
id = "analytics"
type = "postgres"
readonly = true  # Override global setting
```

**Enforcement** (`src/connectors/base.ts:52-58`):
```typescript
if (this.options.readonly && this.isWriteQuery(sql)) {
  throw new QueryError(
    this.sourceId,
    sql,
    new Error('Write operations are not allowed in read-only mode')
  );
}
```

### Parameterized Queries

All connectors support parameterized queries to prevent SQL injection:

```typescript
// PostgreSQL - positional ($1, $2)
await connector.execute('SELECT * FROM users WHERE id = $1', { params: [123] });

// MySQL - positional (?)
await connector.execute('SELECT * FROM users WHERE id = ?', { params: [123] });

// SQL Server - named (@p0, @p1)
await connector.execute('SELECT * FROM users WHERE id = @p0', { params: [123] });
```

### Credential Management

**Best Practices**:
1. Use environment variables for sensitive values
2. Never commit credentials to version control
3. Use Kerberos keytabs for enterprise environments
4. Restrict keytab file permissions

**Keytab Validation** (`src/config/loader.ts:61-77`):
```typescript
function validateKeytab(keytabPath: string): void {
  const mode = stats.mode & 0o777;
  if (mode & 0o004) {
    logger.warn(`Keytab file is world-readable. Consider restricting permissions.`);
  }
}
```

### Connection Timeouts

Prevent hanging connections:
```toml
[settings]
connection_timeout = 10000  # 10 seconds
query_timeout = 30000       # 30 seconds
```

---

## Development Guide

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- TypeScript 5.x

### Setup

```bash
# Clone and install
git clone <repository>
cd opendb-mcp-server
npm install

# Development mode (with hot reload)
npm run dev -- --config examples/sqlite-test.toml

# Build
npm run build

# Production
npm start -- --config /path/to/config.toml
```

### npm Scripts

| Script          | Command            | Description                    |
|-----------------|--------------------|---------------------------------|
| `build`         | `tsc`              | Compile TypeScript to dist/    |
| `dev`           | `tsx src/index.ts` | Run with hot reload            |
| `start`         | `node dist/index.js` | Run compiled code            |
| `clean`         | `rm -rf dist`      | Remove build artifacts         |
| `prepublishOnly`| `npm run build`    | Build before publishing        |

### TypeScript Configuration

Key settings from `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Adding a New Database Connector

1. **Create connector file** (`src/connectors/newdb.ts`):
   ```typescript
   import { BaseConnector } from './base.js';

   export class NewDbConnector extends BaseConnector {
     get dbType(): string { return 'newdb'; }

     async connect(): Promise<void> { /* ... */ }
     async disconnect(): Promise<void> { /* ... */ }
     protected async executeQuery(...): Promise<QueryResult> { /* ... */ }
     async searchObjects(...): Promise<SchemaObject[]> { /* ... */ }
   }
   ```

2. **Add to ConnectorManager** (`src/connectors/index.ts`):
   ```typescript
   import { NewDbConnector } from './newdb.js';

   // In createConnector():
   case 'newdb':
     return new NewDbConnector(config, options);
   ```

3. **Update config schemas** (`src/config/schema.ts`):
   ```typescript
   const newDbSourceSchema = z.object({
     ...baseSourceFields,
     type: z.literal('newdb'),
     // ... newdb-specific fields
   }).strict();
   ```

4. **Add type definitions** (`src/config/types.ts`):
   ```typescript
   export type DatabaseType = '...' | 'newdb';

   export interface NewDbSourceConfig extends BaseSourceConfig {
     type: 'newdb';
     // ... specific fields
   }
   ```

5. **Add default port** (`src/constants.ts`):
   ```typescript
   export const DEFAULT_PORTS: Record<string, number> = {
     // ...
     newdb: 5555,
   };
   ```

6. **Export from index** (`src/connectors/index.ts`):
   ```typescript
   export { NewDbConnector } from './newdb.js';
   ```

### Testing

Currently, testing is done manually with example configurations:

```bash
# MySQL local
npm run dev -- --config examples/mysql-local.toml

# Single database via DSN
npm run dev -- --dsn "postgres://user:pass@localhost/testdb"
```

---

## Constants & Defaults

All configurable constants are in `src/constants.ts`:

| Constant                    | Value      | Description                          |
|-----------------------------|------------|--------------------------------------|
| `CHARACTER_LIMIT`           | 100,000    | Max characters in response           |
| `DEFAULT_MAX_ROWS`          | 1,000      | Default row limit for queries        |
| `DEFAULT_QUERY_TIMEOUT`     | 30,000 ms  | Query timeout (30 seconds)           |
| `DEFAULT_CONNECTION_TIMEOUT`| 10,000 ms  | Connection timeout (10 seconds)      |
| `SERVER_NAME`               | `opendb-mcp-server` | MCP server name              |
| `SERVER_VERSION`            | `1.0.0`    | Server version                       |

### Default Ports

| Database   | Port   |
|------------|--------|
| PostgreSQL | 5432   |
| MySQL      | 3306   |
| MariaDB    | 3306   |
| SQL Server | 1433   |
| Hive       | 10000  |
| Impala     | 21050  |

### Environment Variables

| Variable     | Purpose                              | Default |
|--------------|--------------------------------------|---------|
| `TRANSPORT`  | Transport type (`stdio` or `http`)   | `stdio` |
| `PORT`       | HTTP server port                     | `3000`  |
| `LOG_LEVEL`  | Logging level (`debug/info/warn/error`) | `info` |

---

## Additional Resources

- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Desktop Integration Guide](https://docs.anthropic.com/claude/docs/claude-desktop)
