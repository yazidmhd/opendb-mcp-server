/**
 * opendb_list_sources tool implementation
 */

import type { ConnectorManager } from '../connectors/index.js';
import { formatSourcesList, type ResponseFormat } from '../utils/formatters.js';
import { formatErrorForResponse } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

export interface ListSourcesInput {
  response_format?: 'markdown' | 'json';
}

export interface ListSourcesResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function listSources(
  connectorManager: ConnectorManager,
  input: ListSourcesInput
): Promise<ListSourcesResult> {
  const { response_format = 'markdown' } = input;

  try {
    logger.debug('Listing configured database sources');

    // Get all sources
    const sources = connectorManager.listSources();

    // Format response
    const formatted = formatSourcesList(sources, response_format as ResponseFormat);

    return {
      content: [{ type: 'text', text: formatted }],
    };
  } catch (error) {
    logger.error('Failed to list sources', error);
    return {
      content: [{ type: 'text', text: formatErrorForResponse(error) }],
      isError: true,
    };
  }
}
