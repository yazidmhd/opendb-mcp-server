/**
 * Connector interface types
 */

import type { SchemaObject, QueryResult } from '../utils/formatters.js';

export interface ConnectorOptions {
  readonly: boolean;
  maxRows: number;
  queryTimeout?: number;
  connectionTimeout?: number;
}

export interface ExecuteOptions {
  params?: unknown[];
  maxRows?: number;
  timeout?: number;
}

export interface SchemaSearchOptions {
  objectType?: 'schema' | 'table' | 'column' | 'index' | 'procedure';
  schema?: string;
  table?: string;
  pattern?: string;
}

export interface IConnector {
  readonly sourceId: string;
  readonly dbType: string;
  readonly isConnected: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  execute(sql: string, options?: ExecuteOptions): Promise<QueryResult>;
  searchObjects(options?: SchemaSearchOptions): Promise<SchemaObject[]>;
  testConnection(): Promise<boolean>;
}
