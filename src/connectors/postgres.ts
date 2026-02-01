/**
 * PostgreSQL connector using pg
 */

import pg from 'pg';
import { BaseConnector } from './base.js';
import type { SchemaSearchOptions } from './types.js';
import type { SourceConfig, DsnSourceConfig, HostBasedSourceConfig } from '../config/types.js';
import type { SchemaObject, QueryResult } from '../utils/formatters.js';
import { ConnectionError, QueryError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_PORTS } from '../constants.js';

const { Pool } = pg;

export class PostgresConnector extends BaseConnector {
  private pool: pg.Pool | null = null;

  get dbType(): string {
    return 'postgres';
  }

  async connect(): Promise<void> {
    if (this._isConnected) return;

    try {
      const connectionConfig = this.getConnectionConfig();
      this.pool = new Pool({
        ...connectionConfig,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: this.options.connectionTimeout,
      });

      // Test the connection
      const client = await this.pool.connect();
      client.release();

      this._isConnected = true;
      logger.info(`Connected to PostgreSQL: ${this.sourceId}`);
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
      logger.info(`Disconnected from PostgreSQL: ${this.sourceId}`);
    }
  }

  protected async executeQuery(
    sql: string,
    params: unknown[] | undefined,
    maxRows: number,
    _timeout: number | undefined
  ): Promise<QueryResult> {
    if (!this.pool) {
      throw new QueryError(this.sourceId, sql, new Error('Not connected'));
    }

    try {
      const wrappedSql = this.wrapWithLimit(sql, maxRows + 1);

      const result = await this.pool.query(wrappedSql, params);

      const columns = result.fields?.map((f: pg.FieldDef) => f.name) ?? [];
      const { rows, truncated } = this.formatRows(result.rows, maxRows);

      return {
        columns,
        rows,
        rowCount: result.rowCount ?? rows.length,
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

    // Search schemas
    if (!options?.objectType || options.objectType === 'schema') {
      const result = await this.pool.query(
        `SELECT schema_name
         FROM information_schema.schemata
         WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND schema_name LIKE $1
         ORDER BY schema_name`,
        [pattern]
      );

      for (const row of result.rows) {
        objects.push({
          type: 'schema',
          name: row.schema_name,
        });
      }
    }

    // Search tables
    if (!options?.objectType || options.objectType === 'table') {
      let query = `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND table_type = 'BASE TABLE'
        AND table_name LIKE $1
      `;
      const params: string[] = [pattern];

      if (options?.schema) {
        query += ' AND table_schema = $2';
        params.push(options.schema);
      }

      query += ' ORDER BY table_schema, table_name LIMIT 100';

      const result = await this.pool.query(query, params);

      for (const row of result.rows) {
        objects.push({
          type: 'table',
          name: row.table_name,
          schema: row.table_schema,
        });
      }
    }

    // Search columns
    if (options?.objectType === 'column' && options.table) {
      let query = `
        SELECT column_name, data_type, is_nullable,
               CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name, kcu.table_name, kcu.table_schema
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.column_name = pk.column_name
            AND c.table_name = pk.table_name
            AND c.table_schema = pk.table_schema
        WHERE c.table_name = $1
        AND c.column_name LIKE $2
      `;
      const params: string[] = [options.table, pattern];

      if (options?.schema) {
        query += ' AND c.table_schema = $3';
        params.push(options.schema);
      }

      query += ' ORDER BY c.ordinal_position';

      const result = await this.pool.query(query, params);

      for (const row of result.rows) {
        objects.push({
          type: 'column',
          name: row.column_name,
          schema: options.schema,
          table: options.table,
          dataType: row.data_type,
          nullable: row.is_nullable === 'YES',
          primaryKey: row.is_primary_key,
        });
      }
    }

    // Search indexes
    if (options?.objectType === 'index') {
      let query = `
        SELECT schemaname, tablename, indexname
        FROM pg_indexes
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        AND indexname LIKE $1
      `;
      const params: string[] = [pattern];

      if (options?.schema) {
        query += ' AND schemaname = $2';
        params.push(options.schema);
      }

      if (options?.table) {
        query += options.schema ? ' AND tablename = $3' : ' AND tablename = $2';
        params.push(options.table);
      }

      query += ' ORDER BY schemaname, tablename, indexname LIMIT 100';

      const result = await this.pool.query(query, params);

      for (const row of result.rows) {
        objects.push({
          type: 'index',
          name: row.indexname,
          schema: row.schemaname,
          table: row.tablename,
        });
      }
    }

    // Search procedures/functions
    if (options?.objectType === 'procedure') {
      let query = `
        SELECT n.nspname as schema_name, p.proname as proc_name
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND p.proname LIKE $1
      `;
      const params: string[] = [pattern];

      if (options?.schema) {
        query += ' AND n.nspname = $2';
        params.push(options.schema);
      }

      query += ' ORDER BY n.nspname, p.proname LIMIT 100';

      const result = await this.pool.query(query, params);

      for (const row of result.rows) {
        objects.push({
          type: 'procedure',
          name: row.proc_name,
          schema: row.schema_name,
        });
      }
    }

    return objects;
  }

  private getConnectionConfig(): pg.PoolConfig {
    const config = this.config;

    if ('dsn' in config) {
      return { connectionString: (config as DsnSourceConfig).dsn };
    }

    const hostConfig = config as HostBasedSourceConfig;
    return {
      host: hostConfig.host,
      port: hostConfig.port ?? DEFAULT_PORTS.postgres,
      database: hostConfig.database,
      user: hostConfig.user,
      password: hostConfig.password,
      ssl: hostConfig.ssl ? { rejectUnauthorized: false } : undefined,
    };
  }
}
