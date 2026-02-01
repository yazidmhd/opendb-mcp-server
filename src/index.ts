#!/usr/bin/env node
/**
 * OpenDB MCP Server - Main entry point
 *
 * Multi-database MCP server supporting PostgreSQL, MySQL, MariaDB,
 * SQL Server, SQLite, Hive, and Impala with Kerberos authentication.
 */

import { loadConfig, createConfigFromDsn } from './config/loader.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';

interface CliArgs {
  config?: string;
  dsn?: string;
  transport: 'stdio' | 'http';
  port: number;
  help: boolean;
  version: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    transport: 'stdio',
    port: 3000,
    help: false,
    version: false,
  };

  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--config':
      case '-c':
        args.config = argv[++i];
        break;
      case '--dsn':
      case '-d':
        args.dsn = argv[++i];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
      case '-v':
        args.version = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          // Positional argument - treat as config path
          args.config = arg;
        }
    }
  }

  // Environment variables
  if (process.env.TRANSPORT === 'http') {
    args.transport = 'http';
  }

  if (process.env.PORT) {
    args.port = parseInt(process.env.PORT, 10);
  }

  return args;
}

function printHelp(): void {
  console.log(`
${SERVER_NAME} v${SERVER_VERSION}

Multi-database MCP server supporting PostgreSQL, MySQL, MariaDB,
SQL Server, SQLite, Hive, and Impala.

USAGE:
  npx opendb-mcp-server [OPTIONS]

OPTIONS:
  -c, --config <path>   Path to TOML configuration file
  -d, --dsn <dsn>       Database DSN for single-database mode
  -h, --help            Show this help message
  -v, --version         Show version number

ENVIRONMENT VARIABLES:
  TRANSPORT             Transport type: stdio (default) or http
  PORT                  HTTP port (default: 3000)
  LOG_LEVEL             Log level: debug, info, warn, error

EXAMPLES:
  # Using config file (stdio transport)
  npx opendb-mcp-server --config opendb.toml

  # Single database via DSN
  npx opendb-mcp-server --dsn "postgres://user:pass@localhost/db"

  # HTTP transport
  TRANSPORT=http PORT=3000 npx opendb-mcp-server --config opendb.toml

CLAUDE DESKTOP INTEGRATION:
  Add to your Claude Desktop config:
  {
    "mcpServers": {
      "opendb": {
        "command": "npx",
        "args": ["opendb-mcp-server", "--config", "/path/to/opendb.toml"]
      }
    }
  }

For more information, see: https://github.com/anthropics/opendb-mcp-server
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`${SERVER_NAME} v${SERVER_VERSION}`);
    process.exit(0);
  }

  // Validate arguments
  if (!args.config && !args.dsn) {
    console.error('Error: Either --config or --dsn is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  try {
    // Load configuration
    let config;
    if (args.config) {
      logger.info(`Loading configuration from ${args.config}`);
      config = loadConfig(args.config);
    } else if (args.dsn) {
      logger.info('Using single-database mode with DSN');
      config = createConfigFromDsn(args.dsn);
    } else {
      throw new Error('No configuration provided');
    }

    logger.info(`Configured ${config.sources.size} database source(s)`);

    // Create and start server
    const { start, stop } = await createServer({
      config,
      transport: args.transport,
      port: args.port,
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Received shutdown signal');
      await stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start the server
    await start();
  } catch (error) {
    logger.error('Failed to start server', error);
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
