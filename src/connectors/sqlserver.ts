/**
 * SQL Server connector using mssql
 */

import * as sql from 'mssql';
import { BaseConnector } from './base.js';
import type { SchemaSearchOptions } from './types.js';
import type { SourceConfig, DsnSourceConfig, HostBasedSourceConfig } from '../config/types.js';
import type { SchemaObject, QueryResult } from '../utils/formatters.js';
import { ConnectionError, QueryError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_PORTS } from '../constants.js';

export class SqlServerConnector extends BaseConnector {
  private pool: sql.ConnectionPool | null = null;

  get dbType(): string {
    return 'sqlserver';
  }

  async connect(): Promise<void> {
    if (this._isConnected) return;

    try {
      const connectionConfig = this.getConnectionConfig();
      this.pool = new sql.ConnectionPool(connectionConfig);
      await this.pool.connect();

      this._isConnected = true;
      logger.info(`Connected to SQL Server: ${this.sourceId}`);
    } catch (error) {
      throw new ConnectionError(
        this.sourceId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this._isConnected = false;
      logger.info(`Disconnected from SQL Server: ${this.sourceId}`);
    }
  }

  protected override wrapWithLimit(sqlQuery: string, maxRows: number): string {
    const normalized = sqlQuery.trim().toUpperCase();

    // SQL Server uses TOP instead of LIMIT
    if (
      normalized.includes(' TOP ') ||
      normalized.includes(' OFFSET ') ||
      !normalized.startsWith('SELECT')
    ) {
      return sqlQuery;
    }

    // Insert TOP after SELECT
    return sqlQuery.replace(/^SELECT/i, `SELECT TOP ${maxRows}`);
  }

  protected async executeQuery(
    sqlQuery: string,
    params: unknown[] | undefined,
    maxRows: number,
    _timeout: number | undefined
  ): Promise<QueryResult> {
    if (!this.pool) {
      throw new QueryError(this.sourceId, sqlQuery, new Error('Not connected'));
    }

    try {
      const wrappedSql = this.wrapWithLimit(sqlQuery, maxRows + 1);

      const request = this.pool.request();

      // Add parameters
      if (params) {
        params.forEach((param, index) => {
          request.input(`p${index}`, param);
        });
      }

      const result = await request.query(wrappedSql);

      const columns = result.recordset?.columns
        ? Object.keys(result.recordset.columns)
        : result.recordset?.[0]
          ? Object.keys(result.recordset[0])
          : [];

      const { rows, truncated } = this.formatRows(result.recordset || [], maxRows);

      return {
        columns,
        rows,
        rowCount: result.rowsAffected[0] ?? rows.length,
        truncated,
      };
    } catch (error) {
      throw new QueryError(
        this.sourceId,
        sqlQuery,
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

    // Search schemas
    if (!options?.objectType || options.objectType === 'schema') {
      const result = await this.pool.request()
        .input('pattern', pattern)
        .query(`
          SELECT name
          FROM sys.schemas
          WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
          AND name LIKE @pattern
          ORDER BY name
        `);

      for (const row of result.recordset) {
        objects.push({
          type: 'schema',
          name: row.name,
        });
      }
    }

    // Search tables
    if (!options?.objectType || options.objectType === 'table') {
      const request = this.pool.request().input('pattern', pattern);

      let query = `
        SELECT s.name as schema_name, t.name as table_name
        FROM sys.tables t
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE t.name LIKE @pattern
      `;

      if (options?.schema) {
        request.input('schema', options.schema);
        query += ' AND s.name = @schema';
      }

      query += ' ORDER BY s.name, t.name';

      const result = await request.query(query);

      for (const row of result.recordset) {
        objects.push({
          type: 'table',
          name: row.table_name,
          schema: row.schema_name,
        });
      }
    }

    // Search columns
    if (options?.objectType === 'column' && options.table) {
      const request = this.pool.request()
        .input('pattern', pattern)
        .input('table', options.table);

      let query = `
        SELECT
          c.name as column_name,
          t.name as data_type,
          c.is_nullable,
          CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END as is_primary_key
        FROM sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        JOIN sys.tables tbl ON c.object_id = tbl.object_id
        JOIN sys.schemas s ON tbl.schema_id = s.schema_id
        LEFT JOIN (
          SELECT ic.object_id, ic.column_id
          FROM sys.index_columns ic
          JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
          WHERE i.is_primary_key = 1
        ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
        WHERE tbl.name = @table
        AND c.name LIKE @pattern
      `;

      if (options?.schema) {
        request.input('schema', options.schema);
        query += ' AND s.name = @schema';
      }

      query += ' ORDER BY c.column_id';

      const result = await request.query(query);

      for (const row of result.recordset) {
        objects.push({
          type: 'column',
          name: row.column_name,
          schema: options.schema,
          table: options.table,
          dataType: row.data_type,
          nullable: row.is_nullable === true,
          primaryKey: row.is_primary_key === 1,
        });
      }
    }

    // Search indexes
    if (options?.objectType === 'index') {
      const request = this.pool.request().input('pattern', pattern);

      let query = `
        SELECT s.name as schema_name, t.name as table_name, i.name as index_name
        FROM sys.indexes i
        JOIN sys.tables t ON i.object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE i.name IS NOT NULL
        AND i.name LIKE @pattern
      `;

      if (options?.schema) {
        request.input('schema', options.schema);
        query += ' AND s.name = @schema';
      }

      if (options?.table) {
        request.input('table', options.table);
        query += ' AND t.name = @table';
      }

      query += ' ORDER BY s.name, t.name, i.name';

      const result = await request.query(query);

      for (const row of result.recordset) {
        objects.push({
          type: 'index',
          name: row.index_name,
          schema: row.schema_name,
          table: row.table_name,
        });
      }
    }

    // Search procedures
    if (options?.objectType === 'procedure') {
      const request = this.pool.request().input('pattern', pattern);

      let query = `
        SELECT s.name as schema_name, p.name as proc_name
        FROM sys.procedures p
        JOIN sys.schemas s ON p.schema_id = s.schema_id
        WHERE p.name LIKE @pattern
      `;

      if (options?.schema) {
        request.input('schema', options.schema);
        query += ' AND s.name = @schema';
      }

      query += ' ORDER BY s.name, p.name';

      const result = await request.query(query);

      for (const row of result.recordset) {
        objects.push({
          type: 'procedure',
          name: row.proc_name,
          schema: row.schema_name,
        });
      }
    }

    return objects;
  }

  private getConnectionConfig(): sql.config {
    const config = this.config;

    if ('dsn' in config) {
      // Parse DSN for SQL Server
      const dsn = (config as DsnSourceConfig).dsn;
      const url = new URL(dsn.replace(/^(mssql|sqlserver):\/\//, 'http://'));

      return {
        server: url.hostname,
        port: parseInt(url.port) || DEFAULT_PORTS.sqlserver,
        database: url.pathname.slice(1),
        user: url.username,
        password: url.password,
        options: {
          encrypt: true,
          trustServerCertificate: true,
        },
      };
    }

    const hostConfig = config as HostBasedSourceConfig;
    return {
      server: hostConfig.host,
      port: hostConfig.port ?? DEFAULT_PORTS.sqlserver,
      database: hostConfig.database,
      user: hostConfig.user,
      password: hostConfig.password,
      options: {
        encrypt: hostConfig.ssl ?? true,
        trustServerCertificate: true,
      },
      connectionTimeout: this.options.connectionTimeout,
    };
  }
}
