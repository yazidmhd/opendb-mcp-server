/**
 * MCP Server setup and transport handling
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import type { ParsedConfig } from './config/types.js';
import { ConnectorManager } from './connectors/index.js';
import { registerTools } from './tools/index.js';
import { logger } from './utils/logger.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';

export interface ServerOptions {
  config: ParsedConfig;
  transport: 'stdio' | 'http';
  port?: number;
}

/**
 * Creates and configures the MCP server
 */
export async function createServer(options: ServerOptions): Promise<{
  server: McpServer;
  connectorManager: ConnectorManager;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const { config, transport, port = 3000 } = options;

  // Create connector manager
  const connectorManager = new ConnectorManager(config);

  // Create MCP server
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register tools
  registerTools(server, { connectorManager });

  // Transport-specific setup
  let transportInstance: StdioServerTransport | null = null;
  let httpServer: ReturnType<typeof express> | null = null;
  let httpServerInstance: import('http').Server | null = null;

  const start = async () => {
    // Try to connect to all databases
    try {
      await connectorManager.connectAll();
    } catch (error) {
      logger.warn('Some database connections failed', error);
    }

    if (transport === 'stdio') {
      transportInstance = new StdioServerTransport();
      await server.connect(transportInstance);
      logger.info('MCP server started with stdio transport');
    } else {
      // HTTP transport (Streamable HTTP)
      httpServer = express();
      httpServer.use(express.json());

      // Health check endpoint
      httpServer.get('/health', (_req, res) => {
        res.json({ status: 'ok', version: SERVER_VERSION });
      });

      // Store transports by session
      const transports = new Map<string, StreamableHTTPServerTransport>();

      // Handle all MCP requests (GET, POST, DELETE)
      httpServer.all('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        // Check for existing session
        if (sessionId && transports.has(sessionId)) {
          // Reuse existing transport - let it handle the request
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // No session - create new transport for initialization
        // The transport will validate the request and return proper JSON-RPC errors
        // if it's not a valid initialization request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            transports.delete(sid);
          }
        };

        // Connect the transport to the server
        await server.connect(transport);

        // Let the transport handle the request - it will return proper JSON-RPC errors
        // for invalid requests (wrong method, missing Accept header, etc.)
        await transport.handleRequest(req, res, req.body);

        // Store the transport if a session was established
        if (transport.sessionId) {
          transports.set(transport.sessionId, transport);
        }
      });

      httpServerInstance = httpServer.listen(port, '0.0.0.0', () => {
        logger.info(`MCP server started with Streamable HTTP transport on port ${port}`);
        logger.info(`MCP endpoint: http://0.0.0.0:${port}/mcp`);
        logger.info(`Health check: http://0.0.0.0:${port}/health`);
      });
    }
  };

  const stop = async () => {
    logger.info('Shutting down MCP server...');

    // Close transport
    if (transportInstance) {
      await server.close();
    }

    if (httpServerInstance) {
      await new Promise<void>((resolve) => {
        httpServerInstance!.close(() => resolve());
      });
    }

    // Disconnect all databases
    await connectorManager.disconnectAll();

    logger.info('MCP server stopped');
  };

  return { server, connectorManager, start, stop };
}
