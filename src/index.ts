#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

// stdout carries the MCP protocol, so every human-readable message goes to stderr.
const config = await loadConfig(process.argv.slice(2), process.env, process.cwd()).catch((err: unknown) => {
  console.error(`${SERVER_NAME}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

console.error(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio; roots: ${config.roots.join(", ")}`);
serveStdio(() => createServer(config));
