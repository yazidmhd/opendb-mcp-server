/**
 * Result formatters for Markdown and JSON output
 */

import { CHARACTER_LIMIT } from '../constants.js';

export type ResponseFormat = 'markdown' | 'json';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface SchemaObject {
  type: 'schema' | 'table' | 'column' | 'index' | 'procedure';
  name: string;
  schema?: string;
  table?: string;
  dataType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  extra?: Record<string, unknown>;
}

/**
 * Formats query results as Markdown table
 */
function formatResultsAsMarkdown(result: QueryResult): string {
  if (result.rows.length === 0) {
    return '_No results returned_';
  }

  const { columns, rows, rowCount, truncated } = result;

  // Build header
  let output = '| ' + columns.join(' | ') + ' |\n';
  output += '| ' + columns.map(() => '---').join(' | ') + ' |\n';

  // Build rows
  for (const row of rows) {
    const values = columns.map((col) => {
      const value = row[col];
      if (value === null) return '_null_';
      if (value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    });
    output += '| ' + values.join(' | ') + ' |\n';
  }

  // Add summary
  output += `\n_Showing ${rows.length} of ${rowCount} rows_`;
  if (truncated) {
    output += ' _(results truncated)_';
  }

  return output;
}

/**
 * Formats query results as JSON
 */
function formatResultsAsJson(result: QueryResult): string {
  return JSON.stringify(
    {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
    },
    null,
    2
  );
}

/**
 * Formats query results based on requested format
 */
export function formatQueryResults(
  result: QueryResult,
  format: ResponseFormat = 'markdown'
): string {
  const formatted =
    format === 'json' ? formatResultsAsJson(result) : formatResultsAsMarkdown(result);

  if (formatted.length > CHARACTER_LIMIT) {
    const truncateMsg =
      format === 'json'
        ? '\n\n{"_truncated": true, "_message": "Output exceeded character limit"}'
        : '\n\n_Output truncated due to character limit_';

    return formatted.slice(0, CHARACTER_LIMIT - truncateMsg.length) + truncateMsg;
  }

  return formatted;
}

/**
 * Formats schema objects as Markdown
 */
function formatSchemaAsMarkdown(objects: SchemaObject[]): string {
  if (objects.length === 0) {
    return '_No objects found_';
  }

  // Group by type
  const grouped = new Map<string, SchemaObject[]>();
  for (const obj of objects) {
    const group = grouped.get(obj.type) || [];
    group.push(obj);
    grouped.set(obj.type, group);
  }

  let output = '';

  for (const [type, items] of grouped) {
    output += `## ${type.charAt(0).toUpperCase() + type.slice(1)}s\n\n`;

    if (type === 'column') {
      output += '| Column | Type | Nullable | Primary Key |\n';
      output += '| --- | --- | --- | --- |\n';
      for (const item of items) {
        output += `| ${item.name} | ${item.dataType || '-'} | ${item.nullable ? 'Yes' : 'No'} | ${item.primaryKey ? 'Yes' : 'No'} |\n`;
      }
    } else {
      for (const item of items) {
        const qualifiedName = item.schema ? `${item.schema}.${item.name}` : item.name;
        output += `- ${qualifiedName}\n`;
      }
    }

    output += '\n';
  }

  return output.trim();
}

/**
 * Formats schema objects as JSON
 */
function formatSchemaAsJson(objects: SchemaObject[]): string {
  return JSON.stringify(objects, null, 2);
}

/**
 * Formats schema objects based on requested format
 */
export function formatSchemaObjects(
  objects: SchemaObject[],
  format: ResponseFormat = 'markdown'
): string {
  const formatted =
    format === 'json' ? formatSchemaAsJson(objects) : formatSchemaAsMarkdown(objects);

  if (formatted.length > CHARACTER_LIMIT) {
    const truncateMsg =
      format === 'json'
        ? '\n\n{"_truncated": true}'
        : '\n\n_Output truncated due to character limit_';

    return formatted.slice(0, CHARACTER_LIMIT - truncateMsg.length) + truncateMsg;
  }

  return formatted;
}

/**
 * Formats a list of database sources
 */
export function formatSourcesList(
  sources: Array<{ id: string; type: string; readonly: boolean }>,
  format: ResponseFormat = 'markdown'
): string {
  if (format === 'json') {
    return JSON.stringify(sources, null, 2);
  }

  if (sources.length === 0) {
    return '_No database sources configured_';
  }

  let output = '## Configured Database Sources\n\n';
  output += '| ID | Type | Mode |\n';
  output += '| --- | --- | --- |\n';

  for (const source of sources) {
    output += `| ${source.id} | ${source.type} | ${source.readonly ? 'Read-only' : 'Read/Write'} |\n`;
  }

  return output;
}
