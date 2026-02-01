/**
 * opendb_execute_sql tool implementation
 */

import type { ConnectorManager } from '../connectors/index.js';
import { formatQueryResults, type ResponseFormat } from '../utils/formatters.js';
import { formatErrorForResponse } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

export interface ExecuteSqlInput {
  source_id?: string;
  sql: string;
  params?: unknown[];
  response_format?: 'markdown' | 'json';
}

export interface ExecuteSqlResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function executeSql(
  connectorManager: ConnectorManager,
  input: ExecuteSqlInput
): Promise<ExecuteSqlResult> {
  const { source_id, sql, params, response_format = 'markdown' } = input;

  if (!sql || sql.trim().length === 0) {
    return {
      content: [{ type: 'text', text: 'Error: SQL query is required' }],
      isError: true,
    };
  }

  try {
    // Resolve connector
    const connector = connectorManager.resolve(source_id);

    // Ensure connected
    if (!connector.isConnected) {
      await connector.connect();
    }

    logger.debug(`Executing SQL on ${connector.sourceId}`, { sql: sql.slice(0, 100) });

    // Execute query
    const result = await connector.execute(sql, { params });

    // Format response
    const formatted = formatQueryResults(result, response_format as ResponseFormat);

    return {
      content: [{ type: 'text', text: formatted }],
    };
  } catch (error) {
    logger.error('SQL execution failed', error);
    return {
      content: [{ type: 'text', text: formatErrorForResponse(error) }],
      isError: true,
    };
  }
}
