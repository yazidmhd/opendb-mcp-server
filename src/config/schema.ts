/**
 * Zod validation schemas for configuration
 */

import { z } from 'zod';

// Base source schema fields
const baseSourceFields = {
  id: z.string().min(1, 'Source ID is required'),
  readonly: z.boolean().optional(),
};

// DSN-based source (PostgreSQL, MySQL, etc.)
const dsnSourceSchema = z
  .object({
    ...baseSourceFields,
    type: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']),
    dsn: z.string().min(1, 'DSN is required'),
  })
  .strict();

// Host-based source (alternative to DSN)
const hostBasedSourceSchema = z
  .object({
    ...baseSourceFields,
    type: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']),
    host: z.string().min(1, 'Host is required'),
    port: z.number().int().positive().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
  })
  .strict();

// Kerberos-enabled source (Hive/Impala)
const kerberosSourceSchema = z
  .object({
    ...baseSourceFields,
    type: z.enum(['hive', 'impala']),
    host: z.string().min(1, 'Host is required'),
    port: z.number().int().positive().optional(),
    database: z.string().optional(),
    auth_mechanism: z.enum(['NONE', 'PLAIN', 'KERBEROS']).default('NONE'),
    principal: z.string().optional(),
    keytab: z.string().optional(),
    user_principal: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.auth_mechanism === 'KERBEROS') {
        return data.keytab && data.user_principal;
      }
      return true;
    },
    {
      message: 'Kerberos authentication requires keytab and user_principal',
    }
  );

// Union of all source types
export const sourceSchema = z.union([
  dsnSourceSchema,
  hostBasedSourceSchema,
  kerberosSourceSchema,
]);

// Settings schema
export const settingsSchema = z
  .object({
    readonly: z.boolean().default(false),
    max_rows: z.number().int().positive().default(1000),
    query_timeout: z.number().int().positive().optional(),
    connection_timeout: z.number().int().positive().optional(),
  })
  .strict();

// Full config schema
export const configSchema = z
  .object({
    settings: settingsSchema.default({
      readonly: false,
      max_rows: 1000,
    }),
    sources: z.array(sourceSchema).min(1, 'At least one source is required'),
  })
  .strict();

// Type exports from schemas
export type SourceSchemaType = z.infer<typeof sourceSchema>;
export type SettingsSchemaType = z.infer<typeof settingsSchema>;
export type ConfigSchemaType = z.infer<typeof configSchema>;
