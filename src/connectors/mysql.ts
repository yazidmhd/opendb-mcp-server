/**
 * MySQL/MariaDB connector using mysql2
 */

import mysql from 'mysql2/promise';
import { BaseConnector } from './base.js';
import type { SchemaSearchOptions } from './types.js';
import type { SourceConfig, DsnSourceConfig, HostBasedSourceConfig } from '../config/types.js';
import type { SchemaObject, QueryResult } from '../utils/formatters.js';
import { ConnectionError, QueryError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_PORTS } from '../constants.js';

export class MySqlConnector extends BaseConnector {
  private pool: mysql.Pool | null = null;
  private isMariaDb: boolean;

  constructor(config: SourceConfig, options: { readonly?: boolean; maxRows?: number } = {}) {
    super(config, options);
    this.isMariaDb = config.type === 'mariadb';
  }

  get dbType(): string {
    return this.isMariaDb ? 'mariadb' : 'mysql';
  }

  async connect(): Promise<void> {
    if (this._isConnected) return;

    try {
      const connectionConfig = this.getConnectionConfig();
      this.pool = mysql.createPool({
        ...connectionConfig,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        connectTimeout: this.options.connectionTimeout,
      });

      // Test the connection
      const connection = await this.pool.getConnection();
      connection.release();

      this._isConnected = true;
      logger.info(`Connected to ${this.dbType}: ${this.sourceId}`);
    } catch (error) {
      throw new ConnectionError(
        this.sourceId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this._isConnected = false;
      logger.info(`Disconnected from ${this.dbType}: ${this.sourceId}`);
    }
  }

  protected async executeQuery(
    sql: string,
    params: unknown[] | undefined,
    maxRows: number,
    timeout: number | undefined
  ): Promise<QueryResult> {
    if (!this.pool) {
      throw new QueryError(this.sourceId, sql, new Error('Not connected'));
    }

    try {
      const wrappedSql = this.wrapWithLimit(sql, maxRows + 1);

      const [rows, fields] = await this.pool.query({
        sql: wrappedSql,
        values: params,
        timeout,
      });

      if (!Array.isArray(rows)) {
        // Non-SELECT query (INSERT, UPDATE, etc.)
        return {
          columns: ['affectedRows', 'insertId'],
          rows: [{ affectedRows: (rows as mysql.ResultSetHeader).affectedRows, insertId: (rows as mysql.ResultSetHeader).insertId }],
          rowCount: (rows as mysql.ResultSetHeader).affectedRows,
          truncated: false,
        };
      }

      const columns = fields ? (fields as mysql.FieldPacket[]).map((f) => f.name) : Object.keys(rows[0] || {});
      const { rows: formattedRows, truncated } = this.formatRows(rows, maxRows);

      return {
        columns,
        rows: formattedRows,
        rowCount: rows.length,
        truncated,
      };
    } catch (error) {
      throw new QueryError(
        this.sourceId,
        sql,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async searchObjects(options?: SchemaSearchOptions): Promise<SchemaObject[]> {
    if (!this.pool) {
      throw new Error('Not connected');
    }

    const objects: SchemaObject[] = [];
    const pattern = options?.pattern ? `%${options.pattern}%` : '%';

    // Search schemas (databases in MySQL)
    if (!options?.objectType || options.objectType === 'schema') {
      const [rows] = await this.pool.query(
        `SELECT SCHEMA_NAME
         FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
         AND SCHEMA_NAME LIKE ?
         ORDER BY SCHEMA_NAME`,
        [pattern]
      );

      for (const row of rows as Record<string, unknown>[]) {
        objects.push({
          type: 'schema',
          name: row.SCHEMA_NAME as string,
        });
      }
    }

    // Search tables
    if (!options?.objectType || options.objectType === 'table') {
      let query = `
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
        AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME LIKE ?
      `;
      const params: string[] = [pattern];

      if (options?.schema) {
        query += ' AND TABLE_SCHEMA = ?';
        params.push(options.schema);
      }

      query += ' ORDER BY TABLE_SCHEMA, TABLE_NAME LIMIT 100';

      const [rows] = await this.pool.query(query, params);

      for (const row of rows as Record<string, unknown>[]) {
        objects.push({
          type: 'table',
          name: row.TABLE_NAME as string,
          schema: row.TABLE_SCHEMA as string,
        });
      }
    }

    // Search columns
    if (options?.objectType === 'column' && options.table) {
      let query = `
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
        FROM information_schema.COLUMNS
        WHERE TABLE_NAME = ?
        AND COLUMN_NAME LIKE ?
      `;
      const params: string[] = [options.table, pattern];

      if (options?.schema) {
        query += ' AND TABLE_SCHEMA = ?';
        params.push(options.schema);
      }

      query += ' ORDER BY ORDINAL_POSITION';

      const [rows] = await this.pool.query(query, params);

      for (const row of rows as Record<string, unknown>[]) {
        objects.push({
          type: 'column',
          name: row.COLUMN_NAME as string,
          schema: options.schema,
          table: options.table,
          dataType: row.DATA_TYPE as string,
          nullable: row.IS_NULLABLE === 'YES',
          primaryKey: row.COLUMN_KEY === 'PRI',
        });
      }
    }

    // Search indexes
    if (options?.objectType === 'index') {
      let query = `
        SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
        AND INDEX_NAME LIKE ?
      `;
      const params: string[] = [pattern];

      if (options?.schema) {
        query += ' AND TABLE_SCHEMA = ?';
        params.push(options.schema);
      }

      if (options?.table) {
        query += ' AND TABLE_NAME = ?';
        params.push(options.table);
      }

      query += ' GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME LIMIT 100';

      const [rows] = await this.pool.query(query, params);

      for (const row of rows as Record<string, unknown>[]) {
        objects.push({
          type: 'index',
          name: row.INDEX_NAME as string,
          schema: row.TABLE_SCHEMA as string,
          table: row.TABLE_NAME as string,
        });
      }
    }

    // Search procedures
    if (options?.objectType === 'procedure') {
      let query = `
        SELECT ROUTINE_SCHEMA, ROUTINE_NAME
        FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
        AND ROUTINE_NAME LIKE ?
      `;
      const params: string[] = [pattern];

      if (options?.schema) {
        query += ' AND ROUTINE_SCHEMA = ?';
        params.push(options.schema);
      }

      query += ' ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME LIMIT 100';

      const [rows] = await this.pool.query(query, params);

      for (const row of rows as Record<string, unknown>[]) {
        objects.push({
          type: 'procedure',
          name: row.ROUTINE_NAME as string,
          schema: row.ROUTINE_SCHEMA as string,
        });
      }
    }

    return objects;
  }

  private getConnectionConfig(): mysql.PoolOptions {
    const config = this.config;

    if ('dsn' in config) {
      return { uri: (config as DsnSourceConfig).dsn };
    }

    const hostConfig = config as HostBasedSourceConfig;
    return {
      host: hostConfig.host,
      port: hostConfig.port ?? DEFAULT_PORTS.mysql,
      database: hostConfig.database,
      user: hostConfig.user,
      password: hostConfig.password,
      ssl: hostConfig.ssl ? { rejectUnauthorized: false } : undefined,
    };
  }
}
