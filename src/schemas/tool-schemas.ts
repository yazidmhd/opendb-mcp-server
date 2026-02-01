/**
 * Zod schemas for MCP tool inputs
 */

import { z } from 'zod';

// Response format enum
export const responseFormatSchema = z.enum(['markdown', 'json']).default('markdown');

// Execute SQL tool input schema
export const executeSqlSchema = z.object({
  source_id: z.string().optional().describe('Database source ID (optional if single db configured)'),
  sql: z.string().min(1).describe('SQL query to execute'),
  params: z.array(z.unknown()).optional().describe('Prepared statement parameters'),
  response_format: responseFormatSchema.describe('Output format (markdown or json)'),
});

export type ExecuteSqlInput = z.infer<typeof executeSqlSchema>;

// Search objects tool input schema
export const searchObjectsSchema = z.object({
  source_id: z.string().optional().describe('Database source ID (optional if single db configured)'),
  object_type: z
    .enum(['schema', 'table', 'column', 'index', 'procedure'])
    .optional()
    .describe('Type of database object to search for'),
  schema: z.string().optional().describe('Schema/database name to search within'),
  table: z.string().optional().describe('Table name (required when searching columns)'),
  pattern: z.string().optional().describe('Search pattern (supports % wildcard)'),
  response_format: responseFormatSchema.describe('Output format (markdown or json)'),
});

export type SearchObjectsInput = z.infer<typeof searchObjectsSchema>;

// List sources tool input schema
export const listSourcesSchema = z.object({
  response_format: responseFormatSchema.describe('Output format (markdown or json)'),
});

export type ListSourcesInput = z.infer<typeof listSourcesSchema>;

// Convert Zod schema to JSON Schema for MCP tool registration
export function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodValue = value as z.ZodTypeAny;
    properties[key] = zodTypeToJsonSchema(zodValue);

    // Check if required (not optional and no default)
    if (!zodValue.isOptional() && !(zodValue._def as { defaultValue?: unknown }).defaultValue) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

function zodTypeToJsonSchema(zodType: z.ZodTypeAny): Record<string, unknown> {
  const def = zodType._def as {
    typeName: string;
    innerType?: z.ZodTypeAny;
    defaultValue?: unknown;
    values?: string[];
    description?: string;
    type?: z.ZodTypeAny;
    checks?: Array<{ kind: string; value?: number }>;
  };

  // Handle optional wrapper
  if (def.typeName === 'ZodOptional') {
    return zodTypeToJsonSchema(def.innerType!);
  }

  // Handle default wrapper
  if (def.typeName === 'ZodDefault') {
    const inner = zodTypeToJsonSchema(def.innerType!);
    return { ...inner, default: def.defaultValue };
  }

  // Get description if available
  const description = zodType.description;

  switch (def.typeName) {
    case 'ZodString':
      return { type: 'string', ...(description && { description }) };

    case 'ZodNumber':
      return { type: 'number', ...(description && { description }) };

    case 'ZodBoolean':
      return { type: 'boolean', ...(description && { description }) };

    case 'ZodArray':
      return {
        type: 'array',
        items: zodTypeToJsonSchema(def.type!),
        ...(description && { description }),
      };

    case 'ZodEnum':
      return {
        type: 'string',
        enum: def.values,
        ...(description && { description }),
      };

    case 'ZodUnknown':
      return { ...(description && { description }) };

    default:
      return { ...(description && { description }) };
  }
}
