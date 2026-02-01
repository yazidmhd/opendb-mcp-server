/**
 * Tool registration module
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectorManager } from '../connectors/index.js';
import { executeSql } from './execute-sql.js';
import { searchObjects } from './search-objects.js';
import { listSources } from './list-sources.js';
import { logger } from '../utils/logger.js';

export interface ToolContext {
  connectorManager: ConnectorManager;
}

// Zod schemas for MCP tool registration
const executeSqlParamsSchema = {
  source_id: z.string().optional().describe('Database source ID (optional if single db configured)'),
  sql: z.string().describe('SQL query to execute'),
  params: z.array(z.unknown()).optional().describe('Prepared statement parameters'),
  response_format: z.enum(['markdown', 'json']).default('markdown').describe('Output format'),
};

const searchObjectsParamsSchema = {
  source_id: z.string().optional().describe('Database source ID (optional if single db configured)'),
  object_type: z.enum(['schema', 'table', 'column', 'index', 'procedure']).optional().describe('Type of database object'),
  schema: z.string().optional().describe('Schema/database name to search within'),
  table: z.string().optional().describe('Table name (required when searching columns)'),
  pattern: z.string().optional().describe('Search pattern (supports % wildcard)'),
  response_format: z.enum(['markdown', 'json']).default('markdown').describe('Output format'),
};

const listSourcesParamsSchema = {
  response_format: z.enum(['markdown', 'json']).default('markdown').describe('Output format'),
};

/**
 * Register all tools with the MCP server
 */
export function registerTools(server: McpServer, context: ToolContext): void {
  const { connectorManager } = context;

  // Register execute_sql
  server.tool(
    'execute_sql',
    'Execute SQL queries against configured database sources. Supports prepared statements with parameterized queries.',
    executeSqlParamsSchema,
    async (args) => {
      logger.debug('Tool called: execute_sql', args);
      const result = await executeSql(connectorManager, args);
      return {
        content: result.content,
        isError: result.isError,
      };
    }
  );

  // Register search_objects
  server.tool(
    'search_objects',
    'Explore database schemas with progressive disclosure. Search for schemas, tables, columns, indexes, and stored procedures.',
    searchObjectsParamsSchema,
    async (args) => {
      logger.debug('Tool called: search_objects', args);
      const result = await searchObjects(connectorManager, args);
      return {
        content: result.content,
        isError: result.isError,
      };
    }
  );

  // Register list_sources
  server.tool(
    'list_sources',
    'List all configured database connections with their types and status.',
    listSourcesParamsSchema,
    async (args) => {
      logger.debug('Tool called: list_sources', args);
      const result = await listSources(connectorManager, args);
      return {
        content: result.content,
        isError: result.isError,
      };
    }
  );

  logger.info('Registered MCP tools: execute_sql, search_objects, list_sources');
}

// Re-export tool implementations
export { executeSql } from './execute-sql.js';
export { searchObjects } from './search-objects.js';
export { listSources } from './list-sources.js';
