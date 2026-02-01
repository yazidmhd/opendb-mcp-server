/**
 * Abstract base connector class
 */

import type { SourceConfig } from '../config/types.js';
import type { SchemaObject, QueryResult } from '../utils/formatters.js';
import type {
  IConnector,
  ConnectorOptions,
  ExecuteOptions,
  SchemaSearchOptions,
} from './types.js';
import { QueryError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_MAX_ROWS, DEFAULT_QUERY_TIMEOUT } from '../constants.js';

export abstract class BaseConnector implements IConnector {
  protected _isConnected = false;
  protected readonly options: ConnectorOptions;

  constructor(
    protected readonly config: SourceConfig,
    options: Partial<ConnectorOptions> = {}
  ) {
    this.options = {
      readonly: config.readonly ?? options.readonly ?? false,
      maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
      queryTimeout: options.queryTimeout ?? DEFAULT_QUERY_TIMEOUT,
      connectionTimeout: options.connectionTimeout,
    };
  }

  get sourceId(): string {
    return this.config.id;
  }

  abstract get dbType(): string;

  get isConnected(): boolean {
    return this._isConnected;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  async execute(sql: string, options?: ExecuteOptions): Promise<QueryResult> {
    if (!this._isConnected) {
      throw new QueryError(this.sourceId, sql, new Error('Not connected to database'));
    }

    // Enforce read-only mode
    if (this.options.readonly && this.isWriteQuery(sql)) {
      throw new QueryError(
        this.sourceId,
        sql,
        new Error('Write operations are not allowed in read-only mode')
      );
    }

    const maxRows = options?.maxRows ?? this.options.maxRows;
    const timeout = options?.timeout ?? this.options.queryTimeout;

    logger.debug(`Executing query on ${this.sourceId}`, { sql: sql.slice(0, 200) });

    return this.executeQuery(sql, options?.params, maxRows, timeout);
  }

  protected abstract executeQuery(
    sql: string,
    params: unknown[] | undefined,
    maxRows: number,
    timeout: number | undefined
  ): Promise<QueryResult>;

  abstract searchObjects(options?: SchemaSearchOptions): Promise<SchemaObject[]>;

  async testConnection(): Promise<boolean> {
    try {
      await this.execute('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if a query is a write operation
   */
  protected isWriteQuery(sql: string): boolean {
    const normalized = sql.trim().toUpperCase();
    const writeKeywords = [
      'INSERT',
      'UPDATE',
      'DELETE',
      'DROP',
      'CREATE',
      'ALTER',
      'TRUNCATE',
      'GRANT',
      'REVOKE',
      'MERGE',
      'UPSERT',
      'REPLACE',
    ];

    for (const keyword of writeKeywords) {
      if (normalized.startsWith(keyword)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Wraps a query with row limiting
   */
  protected wrapWithLimit(sql: string, maxRows: number): string {
    const normalized = sql.trim().toUpperCase();

    // Don't wrap if already has LIMIT/TOP/FETCH
    if (
      normalized.includes(' LIMIT ') ||
      normalized.includes(' TOP ') ||
      normalized.includes(' FETCH ')
    ) {
      return sql;
    }

    // Don't wrap non-SELECT statements
    if (!normalized.startsWith('SELECT')) {
      return sql;
    }

    return `${sql.trim()} LIMIT ${maxRows}`;
  }

  /**
   * Converts result rows to standard format
   */
  protected formatRows(
    rows: unknown[],
    maxRows: number
  ): { rows: Record<string, unknown>[]; truncated: boolean } {
    const truncated = rows.length > maxRows;
    const limitedRows = truncated ? rows.slice(0, maxRows) : rows;

    return {
      rows: limitedRows as Record<string, unknown>[],
      truncated,
    };
  }
}
