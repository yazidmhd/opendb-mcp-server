/**
 * TypeScript interfaces for configuration
 */

export type DatabaseType =
  | 'postgres'
  | 'mysql'
  | 'mariadb'
  | 'sqlserver'
  | 'sqlite'
  | 'hive'
  | 'impala';

export type AuthMechanism = 'NONE' | 'PLAIN' | 'KERBEROS';

export interface BaseSourceConfig {
  id: string;
  type: DatabaseType;
  readonly?: boolean;
}

export interface DsnSourceConfig extends BaseSourceConfig {
  dsn: string;
}

export interface HostBasedSourceConfig extends BaseSourceConfig {
  host: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export interface SqliteSourceConfig extends BaseSourceConfig {
  type: 'sqlite';
  path: string;
}

export interface KerberosSourceConfig extends BaseSourceConfig {
  type: 'hive' | 'impala';
  host: string;
  port?: number;
  database?: string;
  auth_mechanism: AuthMechanism;
  principal?: string;
  keytab?: string;
  user_principal?: string;
}

export type SourceConfig =
  | DsnSourceConfig
  | HostBasedSourceConfig
  | SqliteSourceConfig
  | KerberosSourceConfig;

export interface Settings {
  readonly: boolean;
  max_rows: number;
  query_timeout?: number;
  connection_timeout?: number;
}

export interface OpenDBConfig {
  settings: Settings;
  sources: SourceConfig[];
}

export interface ParsedConfig {
  settings: Settings;
  sources: Map<string, SourceConfig>;
}
