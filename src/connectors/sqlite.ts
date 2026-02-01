/**
 * SQLite connector using better-sqlite3
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { BaseConnector } from './base.js';
import type { SchemaSearchOptions } from './types.js';
import type { SqliteSourceConfig } from '../config/types.js';
import type { SchemaObject, QueryResult } from '../utils/formatters.js';
import { ConnectionError, QueryError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

export class SqliteConnector extends BaseConnector {
  private db: Database.Database | null = null;

  get dbType(): string {
    return 'sqlite';
  }

  async connect(): Promise<void> {
    if (this._isConnected) return;

    try {
      const config = this.config as SqliteSourceConfig;
      const isMemory = config.path === ':memory:';
      const dbPath = isMemory ? ':memory:' : path.resolve(config.path);

      // Check if file exists (unless it's :memory:)
      if (!isMemory && !fs.existsSync(dbPath)) {
        throw new Error(`SQLite database file not found: ${dbPath}`);
      }

      const dbOptions: Database.Options = {
        readonly: this.options.readonly,
      };

      if (this.options.connectionTimeout && this.options.connectionTimeout > 0) {
        dbOptions.timeout = this.options.connectionTimeout;
      }

      this.db = new Database(dbPath, dbOptions);

      this._isConnected = true;
      logger.info(`Connected to SQLite: ${this.sourceId}`);
    } catch (error) {
      throw new ConnectionError(
        this.sourceId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this._isConnected = false;
      logger.info(`Disconnected from SQLite: ${this.sourceId}`);
    }
  }

  protected async executeQuery(
    sql: string,
    params: unknown[] | undefined,
    maxRows: number,
    _timeout: number | undefined
  ): Promise<QueryResult> {
    if (!this.db) {
      throw new QueryError(this.sourceId, sql, new Error('Not connected'));
    }

    try {
      const normalized = sql.trim().toUpperCase();
      const isSelect = normalized.startsWith('SELECT') || normalized.startsWith('WITH');

      if (isSelect) {
        const wrappedSql = this.wrapWithLimit(sql, maxRows + 1);
        const stmt = this.db.prepare(wrappedSql);
        const rows = params ? stmt.all(...params) : stmt.all();

        const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
        const { rows: formattedRows, truncated } = this.formatRows(rows, maxRows);

        return {
          columns,
          rows: formattedRows,
          rowCount: rows.length,
          truncated,
        };
      } else {
        // Non-SELECT (INSERT, UPDATE, DELETE, etc.)
        const stmt = this.db.prepare(sql);
        const result = params ? stmt.run(...params) : stmt.run();

        return {
          columns: ['changes', 'lastInsertRowid'],
          rows: [{ changes: result.changes, lastInsertRowid: result.lastInsertRowid }],
          rowCount: result.changes,
          truncated: false,
        };
      }
    } catch (error) {
      throw new QueryError(
        this.sourceId,
        sql,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async searchObjects(options?: SchemaSearchOptions): Promise<SchemaObject[]> {
    if (!this.db) {
      throw new Error('Not connected');
    }

    const objects: SchemaObject[] = [];
    const pattern = options?.pattern || '%';

    // SQLite doesn't have schemas, but we still support the interface
    if (!options?.objectType || options.objectType === 'schema') {
      objects.push({
        type: 'schema',
        name: 'main',
      });
    }

    // Search tables
    if (!options?.objectType || options.objectType === 'table') {
      const stmt = this.db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name LIKE ?
        ORDER BY name
      `);

      const rows = stmt.all(pattern) as Array<{ name: string }>;

      for (const row of rows) {
        objects.push({
          type: 'table',
          name: row.name,
          schema: 'main',
        });
      }
    }

    // Search columns
    if (options?.objectType === 'column' && options.table) {
      const stmt = this.db.prepare(`PRAGMA table_info("${options.table.replace(/"/g, '""')}")`);
      const rows = stmt.all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;

      for (const row of rows) {
        if (pattern === '%' || row.name.toLowerCase().includes(pattern.toLowerCase().replace(/%/g, ''))) {
          objects.push({
            type: 'column',
            name: row.name,
            schema: 'main',
            table: options.table,
            dataType: row.type,
            nullable: row.notnull === 0,
            primaryKey: row.pk === 1,
          });
        }
      }
    }

    // Search indexes
    if (options?.objectType === 'index') {
      let query = `
        SELECT name, tbl_name
        FROM sqlite_master
        WHERE type = 'index'
        AND name NOT LIKE 'sqlite_%'
        AND name LIKE ?
      `;
      const params: string[] = [pattern];

      if (options.table) {
        query += ' AND tbl_name = ?';
        params.push(options.table);
      }

      query += ' ORDER BY tbl_name, name';

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params) as Array<{ name: string; tbl_name: string }>;

      for (const row of rows) {
        objects.push({
          type: 'index',
          name: row.name,
          schema: 'main',
          table: row.tbl_name,
        });
      }
    }

    return objects;
  }

  override async testConnection(): Promise<boolean> {
    try {
      await this.execute('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
