/**
 * MCP Server setup and transport handling
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
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

      // Map to store transports by session ID
      const transports = new Map<string, StreamableHTTPServerTransport>();

      // Streamable HTTP endpoint
      httpServer.post('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports.has(sessionId)) {
          transport = transports.get(sessionId)!;
        } else {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, transport);
              logger.info(`MCP session initialized: ${id}`);
            },
          });

          transport.onclose = () => {
            const id = transport.sessionId;
            if (id) {
              transports.delete(id);
              logger.info(`MCP session closed: ${id}`);
            }
          };

          await server.connect(transport);
        }

        await transport.handleRequest(req, res, req.body);
      });

      // Handle GET and DELETE for session management
      httpServer.get('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string;
        const transport = transports.get(sessionId);
        if (transport) {
          await transport.handleRequest(req, res);
        } else {
          res.status(400).json({ error: 'No active session' });
        }
      });

      httpServer.delete('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string;
        const transport = transports.get(sessionId);
        if (transport) {
          await transport.handleRequest(req, res);
          transports.delete(sessionId);
        } else {
          res.status(400).json({ error: 'No active session' });
        }
      });

      httpServerInstance = httpServer.listen(port, () => {
        logger.info(`MCP server started with HTTP transport on port ${port}`);
        logger.info(`Streamable HTTP endpoint: http://localhost:${port}/mcp`);
        logger.info(`Health check: http://localhost:${port}/health`);
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
