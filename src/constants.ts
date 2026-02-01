/**
 * Shared constants for the OpenDB MCP Server
 */

// Maximum characters in response to prevent memory issues
export const CHARACTER_LIMIT = 100_000;

// Default maximum rows returned from queries
export const DEFAULT_MAX_ROWS = 1000;

// Default query timeout in milliseconds
export const DEFAULT_QUERY_TIMEOUT = 30_000;

// Default connection timeout in milliseconds
export const DEFAULT_CONNECTION_TIMEOUT = 10_000;

// Server name and version
export const SERVER_NAME = 'opendb-mcp-server';
export const SERVER_VERSION = '1.0.0';

// Environment variable prefix for config
export const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

// Default ports for various databases
export const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  sqlserver: 1433,
  hive: 10000,
  impala: 21050,
};
