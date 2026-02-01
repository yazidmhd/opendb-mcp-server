#!/bin/bash
kill $(lsof -t -i :3000) 2>/dev/null && echo "OpenDB MCP Server stopped" || echo "Server not running"
