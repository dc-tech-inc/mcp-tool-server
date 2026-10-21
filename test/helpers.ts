import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

export interface Connected {
  client: Client;
  close(): Promise<void>;
}

/** Connects an MCP client to a server built from `roots` over in-memory transport. */
export async function connect(roots: string[]): Promise<Connected> {
  const config = await loadConfig(roots, {}, process.cwd());
  const server = createServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "repo-health-tests", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Text of the first content block of a tool result, for error assertions. */
export function errorText(result: { content: unknown }): string {
  const blocks = result.content as { type: string; text?: string }[];
  return blocks.map((block) => block.text ?? "").join("\n");
}
