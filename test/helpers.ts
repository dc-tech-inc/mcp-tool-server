import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { CREDENTIAL_REMOTES } from "./fixtures.js";

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

/** Asserts a `repo_summary` result lists `CREDENTIAL_REMOTES` stripped and contains no secret anywhere. */
export function expectNoCredentials(result: { structuredContent?: unknown; content: unknown }): void {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const remotes = (result.structuredContent as { remotes: { name: string; url: string }[] }).remotes;
  expect([...remotes].sort(byName)).toEqual(
    CREDENTIAL_REMOTES.map(({ name, stripped }) => ({ name, url: stripped })).sort(byName),
  );
  const everything = JSON.stringify(result);
  for (const remote of CREDENTIAL_REMOTES) {
    expect(everything).not.toContain(remote.secret);
  }
}
