/**
 * ConnectorManager - Multi-database registry and factory
 */

import type { SourceConfig, ParsedConfig } from '../config/types.js';
import type { IConnector, ConnectorOptions } from './types.js';
import { PostgresConnector } from './postgres.js';
import { MySqlConnector } from './mysql.js';
import { SqlServerConnector } from './sqlserver.js';
import { HiveConnector } from './hive.js';
import { ImpalaConnector } from './impala.js';
import { logger } from '../utils/logger.js';

export class ConnectorManager {
  private connectors: Map<string, IConnector> = new Map();
  private readonly globalOptions: Partial<ConnectorOptions>;

  constructor(config: ParsedConfig) {
    this.globalOptions = {
      readonly: config.settings.readonly,
      maxRows: config.settings.max_rows,
      queryTimeout: config.settings.query_timeout,
      connectionTimeout: config.settings.connection_timeout,
    };

    // Create connectors for all sources
    for (const [id, sourceConfig] of config.sources) {
      const connector = this.createConnector(sourceConfig);
      this.connectors.set(id, connector);
    }
  }

  /**
   * Factory method to create appropriate connector by type
   */
  private createConnector(config: SourceConfig): IConnector {
    const options: Partial<ConnectorOptions> = {
      ...this.globalOptions,
      // Source-level readonly overrides global
      readonly: config.readonly ?? this.globalOptions.readonly,
    };

    switch (config.type) {
      case 'postgres':
        return new PostgresConnector(config, options);
      case 'mysql':
      case 'mariadb':
        return new MySqlConnector(config, options);
      case 'sqlserver':
        return new SqlServerConnector(config, options);
      case 'hive':
        return new HiveConnector(config, options);
      case 'impala':
        return new ImpalaConnector(config, options);
      default:
        throw new Error(`Unsupported database type: ${(config as SourceConfig).type}`);
    }
  }

  /**
   * Get a connector by source ID
   */
  get(sourceId: string): IConnector | undefined {
    return this.connectors.get(sourceId);
  }

  /**
   * Get the default connector (first one if only one configured)
   */
  getDefault(): IConnector | undefined {
    if (this.connectors.size === 1) {
      return this.connectors.values().next().value;
    }
    return this.connectors.get('default');
  }

  /**
   * Get a connector, resolving source ID or using default
   */
  resolve(sourceId?: string): IConnector {
    if (sourceId) {
      const connector = this.get(sourceId);
      if (!connector) {
        throw new Error(`Unknown source: ${sourceId}. Available sources: ${this.listSourceIds().join(', ')}`);
      }
      return connector;
    }

    const defaultConnector = this.getDefault();
    if (!defaultConnector) {
      throw new Error(
        `Multiple sources configured. Please specify source_id. Available: ${this.listSourceIds().join(', ')}`
      );
    }
    return defaultConnector;
  }

  /**
   * List all source IDs
   */
  listSourceIds(): string[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * List all sources with their types
   */
  listSources(): Array<{ id: string; type: string; readonly: boolean; connected: boolean }> {
    return Array.from(this.connectors.entries()).map(([id, connector]) => ({
      id,
      type: connector.dbType,
      readonly: (connector as unknown as { options: ConnectorOptions }).options?.readonly ?? false,
      connected: connector.isConnected,
    }));
  }

  /**
   * Connect to a specific source
   */
  async connect(sourceId: string): Promise<void> {
    const connector = this.get(sourceId);
    if (!connector) {
      throw new Error(`Unknown source: ${sourceId}`);
    }
    await connector.connect();
  }

  /**
   * Connect to all sources
   */
  async connectAll(): Promise<void> {
    const errors: Array<{ id: string; error: Error }> = [];

    for (const [id, connector] of this.connectors) {
      try {
        await connector.connect();
      } catch (error) {
        errors.push({
          id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        logger.error(`Failed to connect to ${id}`, error);
      }
    }

    if (errors.length > 0 && errors.length === this.connectors.size) {
      throw new Error(
        `Failed to connect to all sources: ${errors.map((e) => `${e.id}: ${e.error.message}`).join('; ')}`
      );
    }
  }

  /**
   * Disconnect from all sources
   */
  async disconnectAll(): Promise<void> {
    for (const [id, connector] of this.connectors) {
      try {
        await connector.disconnect();
      } catch (error) {
        logger.error(`Failed to disconnect from ${id}`, error);
      }
    }
  }

  /**
   * Get the number of configured sources
   */
  get size(): number {
    return this.connectors.size;
  }
}

// Re-export types and individual connectors
export type { IConnector, ConnectorOptions, ExecuteOptions, SchemaSearchOptions } from './types.js';
export { PostgresConnector } from './postgres.js';
export { MySqlConnector } from './mysql.js';
export { SqlServerConnector } from './sqlserver.js';
export { HiveConnector } from './hive.js';
export { ImpalaConnector } from './impala.js';
