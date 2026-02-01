/**
 * Apache Hive connector using hive-driver with Kerberos support
 */

import { BaseConnector } from './base.js';
import type { SchemaSearchOptions } from './types.js';
import type { KerberosSourceConfig } from '../config/types.js';
import type { SchemaObject, QueryResult } from '../utils/formatters.js';
import { ConnectionError, QueryError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { KerberosAuth } from '../services/kerberos.js';
import { DEFAULT_PORTS } from '../constants.js';

// Dynamic import for hive-driver as it may not be installed
let HiveClient: typeof import('hive-driver').HiveClient | null = null;
let TCLIService: typeof import('hive-driver').thrift.TCLIService | null = null;
let TCLIService_types: typeof import('hive-driver').thrift.TCLIService_types | null = null;

async function loadHiveDriver() {
  if (HiveClient === null) {
    try {
      const hiveDriver = await import('hive-driver');
      HiveClient = hiveDriver.HiveClient;
      TCLIService = hiveDriver.thrift.TCLIService;
      TCLIService_types = hiveDriver.thrift.TCLIService_types;
    } catch {
      throw new Error(
        'hive-driver package is not installed. Install it with: npm install hive-driver'
      );
    }
  }
}

export class HiveConnector extends BaseConnector {
  private client: InstanceType<typeof import('hive-driver').HiveClient> | null = null;
  private session: unknown = null;
  private kerberosAuth: KerberosAuth | null = null;

  get dbType(): string {
    return 'hive';
  }

  async connect(): Promise<void> {
    if (this._isConnected) return;

    await loadHiveDriver();

    const config = this.config as KerberosSourceConfig;

    try {
      // Initialize Kerberos if needed
      if (config.auth_mechanism === 'KERBEROS' && config.keytab && config.user_principal) {
        this.kerberosAuth = new KerberosAuth({
          keytab: config.keytab,
          principal: config.user_principal,
        });
        await this.kerberosAuth.initialize();
      }

      // Create Hive client
      this.client = new HiveClient!(
        TCLIService!,
        TCLIService_types!
      );

      const authOptions = this.getAuthOptions(config);

      await this.client.connect({
        host: config.host,
        port: config.port ?? DEFAULT_PORTS.hive,
        options: authOptions,
      });

      // Open session
      this.session = await this.client.openSession({
        client_protocol:
          TCLIService_types!.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10,
      });

      this._isConnected = true;
      logger.info(`Connected to Hive: ${this.sourceId}`);
    } catch (error) {
      if (this.kerberosAuth) {
        await this.kerberosAuth.destroy();
      }
      throw new ConnectionError(
        this.sourceId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.session && this.client) {
        await (this.session as { close: () => Promise<void> }).close();
      }
      if (this.client) {
        await this.client.close();
      }
      if (this.kerberosAuth) {
        await this.kerberosAuth.destroy();
      }
    } catch (error) {
      logger.warn('Error during Hive disconnect', error);
    } finally {
      this.client = null;
      this.session = null;
      this.kerberosAuth = null;
      this._isConnected = false;
      logger.info(`Disconnected from Hive: ${this.sourceId}`);
    }
  }

  protected async executeQuery(
    sql: string,
    _params: unknown[] | undefined,
    maxRows: number,
    _timeout: number | undefined
  ): Promise<QueryResult> {
    if (!this.session) {
      throw new QueryError(this.sourceId, sql, new Error('Not connected'));
    }

    try {
      const session = this.session as {
        executeStatement: (sql: string) => Promise<{
          getSchema: () => Promise<{ columns: Array<{ columnName: string }> }>;
          fetchChunk: (options: { maxRows: number }) => Promise<{ getValue: () => Record<string, unknown>[] }>;
          close: () => Promise<void>;
        }>;
      };

      const operation = await session.executeStatement(sql);

      try {
        const schema = await operation.getSchema();
        const columns = schema.columns.map((col) => col.columnName);

        const chunk = await operation.fetchChunk({ maxRows: maxRows + 1 });
        const rows = chunk.getValue();

        const { rows: formattedRows, truncated } = this.formatRows(rows, maxRows);

        return {
          columns,
          rows: formattedRows,
          rowCount: rows.length,
          truncated,
        };
      } finally {
        await operation.close();
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
    const objects: SchemaObject[] = [];
    const pattern = options?.pattern || '%';

    // Search schemas (databases in Hive)
    if (!options?.objectType || options.objectType === 'schema') {
      const result = await this.execute('SHOW DATABASES');
      for (const row of result.rows) {
        const dbName = Object.values(row)[0] as string;
        if (pattern === '%' || dbName.toLowerCase().includes(pattern.toLowerCase().replace(/%/g, ''))) {
          objects.push({
            type: 'schema',
            name: dbName,
          });
        }
      }
    }

    // Search tables
    if (!options?.objectType || options.objectType === 'table') {
      const database = options?.schema || 'default';
      const result = await this.execute(`SHOW TABLES IN ${database}`);

      for (const row of result.rows) {
        const tableName = Object.values(row)[0] as string;
        if (pattern === '%' || tableName.toLowerCase().includes(pattern.toLowerCase().replace(/%/g, ''))) {
          objects.push({
            type: 'table',
            name: tableName,
            schema: database,
          });
        }
      }
    }

    // Search columns
    if (options?.objectType === 'column' && options.table) {
      const database = options?.schema || 'default';
      const result = await this.execute(`DESCRIBE ${database}.${options.table}`);

      for (const row of result.rows) {
        const colName = (row.col_name || row.column_name || Object.values(row)[0]) as string;
        const dataType = (row.data_type || Object.values(row)[1]) as string;

        if (colName && !colName.startsWith('#')) {
          if (pattern === '%' || colName.toLowerCase().includes(pattern.toLowerCase().replace(/%/g, ''))) {
            objects.push({
              type: 'column',
              name: colName,
              schema: database,
              table: options.table,
              dataType: dataType,
              nullable: true,
              primaryKey: false,
            });
          }
        }
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

  private getAuthOptions(config: KerberosSourceConfig): Record<string, unknown> {
    const options: Record<string, unknown> = {};

    switch (config.auth_mechanism) {
      case 'KERBEROS':
        options.authMech = 'GSSAPI';
        if (config.principal) {
          options.principal = config.principal;
        }
        break;
      case 'PLAIN':
        options.authMech = 'PLAIN';
        break;
      default:
        options.authMech = 'NOSASL';
    }

    return options;
  }
}
