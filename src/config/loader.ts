/**
 * TOML configuration loader with environment variable substitution
 */

import * as fs from 'fs';
import * as path from 'path';
import * as TOML from '@iarna/toml';
import { configSchema } from './schema.js';
import type { ParsedConfig, SourceConfig } from './types.js';
import { ENV_VAR_PATTERN } from '../constants.js';
import { logger } from '../utils/logger.js';

/**
 * Substitutes environment variables in a string
 * Format: ${VAR_NAME} or ${VAR_NAME:-default}
 */
function substituteEnvVars(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (match, varExpression) => {
    const [varName, defaultValue] = varExpression.split(':-');
    const envValue = process.env[varName];

    if (envValue !== undefined) {
      return envValue;
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    logger.warn(`Environment variable ${varName} is not set and has no default`);
    return match;
  });
}

/**
 * Recursively substitutes environment variables in an object
 */
function substituteEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => substituteEnvVarsInObject(item)) as T;
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsInObject(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Validates keytab file exists and has appropriate permissions
 */
function validateKeytab(keytabPath: string): void {
  const resolvedPath = path.resolve(keytabPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Keytab file not found: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);

  // Check file permissions (should not be world-readable)
  const mode = stats.mode & 0o777;
  if (mode & 0o004) {
    logger.warn(
      `Keytab file ${resolvedPath} is world-readable. Consider restricting permissions.`
    );
  }
}

/**
 * Loads and parses a TOML configuration file
 */
export function loadConfig(configPath: string): ParsedConfig {
  const resolvedPath = path.resolve(configPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = TOML.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to parse TOML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Substitute environment variables
  const substituted = substituteEnvVarsInObject(parsed);

  // Validate with Zod schema
  const result = configSchema.safeParse(substituted);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  const config = result.data;

  // Validate keytab files for Kerberos sources
  for (const source of config.sources) {
    if (
      (source.type === 'hive' || source.type === 'impala') &&
      'auth_mechanism' in source &&
      source.auth_mechanism === 'KERBEROS' &&
      'keytab' in source &&
      source.keytab
    ) {
      validateKeytab(source.keytab);
    }
  }

  // Build sources map
  const sourcesMap = new Map<string, SourceConfig>();
  for (const source of config.sources) {
    if (sourcesMap.has(source.id)) {
      throw new Error(`Duplicate source ID: ${source.id}`);
    }
    sourcesMap.set(source.id, source as SourceConfig);
  }

  return {
    settings: config.settings,
    sources: sourcesMap,
  };
}

/**
 * Creates a config from a DSN string for single-database mode
 */
export function createConfigFromDsn(dsn: string): ParsedConfig {
  // Parse DSN to determine database type
  let type: 'postgres' | 'mysql' | 'mariadb' | 'sqlserver';

  if (dsn.startsWith('postgres://') || dsn.startsWith('postgresql://')) {
    type = 'postgres';
  } else if (dsn.startsWith('mysql://')) {
    type = 'mysql';
  } else if (dsn.startsWith('mariadb://')) {
    type = 'mariadb';
  } else if (dsn.startsWith('mssql://') || dsn.startsWith('sqlserver://')) {
    type = 'sqlserver';
  } else {
    throw new Error(
      `Unsupported DSN format. Expected postgres://, mysql://, mariadb://, or mssql://`
    );
  }

  const source: SourceConfig = {
    id: 'default',
    type,
    dsn,
  };

  return {
    settings: {
      readonly: false,
      max_rows: 1000,
    },
    sources: new Map([['default', source]]),
  };
}
