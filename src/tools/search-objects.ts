/**
 * opendb_search_objects tool implementation
 */

import type { ConnectorManager } from '../connectors/index.js';
import { formatSchemaObjects, type ResponseFormat } from '../utils/formatters.js';
import { formatErrorForResponse } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

export interface SearchObjectsInput {
  source_id?: string;
  object_type?: 'schema' | 'table' | 'column' | 'index' | 'procedure';
  schema?: string;
  table?: string;
  pattern?: string;
  response_format?: 'markdown' | 'json';
}

export interface SearchObjectsResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function searchObjects(
  connectorManager: ConnectorManager,
  input: SearchObjectsInput
): Promise<SearchObjectsResult> {
  const { source_id, object_type, schema, table, pattern, response_format = 'markdown' } = input;

  // Validate column search requires table
  if (object_type === 'column' && !table) {
    return {
      content: [{ type: 'text', text: 'Error: Table name is required when searching for columns' }],
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

    logger.debug(`Searching objects on ${connector.sourceId}`, {
      object_type,
      schema,
      table,
      pattern,
    });

    // Search objects
    const objects = await connector.searchObjects({
      objectType: object_type,
      schema,
      table,
      pattern,
    });

    // Format response
    const formatted = formatSchemaObjects(objects, response_format as ResponseFormat);

    return {
      content: [{ type: 'text', text: formatted }],
    };
  } catch (error) {
    logger.error('Object search failed', error);
    return {
      content: [{ type: 'text', text: formatErrorForResponse(error) }],
      isError: true,
    };
  }
}
