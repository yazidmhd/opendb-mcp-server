/**
 * Shared error handling utilities
 */

import { logger } from './logger.js';

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly sourceId: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ConnectionError extends DatabaseError {
  constructor(sourceId: string, originalError?: Error) {
    super(
      `Failed to connect to database: ${originalError?.message || 'Unknown error'}`,
      sourceId,
      originalError
    );
    this.name = 'ConnectionError';
  }
}

export class QueryError extends DatabaseError {
  constructor(
    sourceId: string,
    public readonly query: string,
    originalError?: Error
  ) {
    super(
      `Query execution failed: ${originalError?.message || 'Unknown error'}`,
      sourceId,
      originalError
    );
    this.name = 'QueryError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class KerberosError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = 'KerberosError';
  }
}

/**
 * Formats an error for MCP tool response
 */
export function formatErrorForResponse(error: unknown): string {
  if (error instanceof DatabaseError) {
    return `Database Error (${error.sourceId}): ${error.message}`;
  }

  if (error instanceof ConfigurationError) {
    return `Configuration Error: ${error.message}`;
  }

  if (error instanceof KerberosError) {
    return `Kerberos Authentication Error: ${error.message}`;
  }

  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return `Unknown error: ${String(error)}`;
}

/**
 * Handles and logs errors consistently
 */
export function handleError(error: unknown, context: string): never {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${context}: ${message}`, error);

  if (error instanceof Error) {
    throw error;
  }

  throw new Error(message);
}

/**
 * Wraps an async function with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, context);
    }
  }) as T;
}
