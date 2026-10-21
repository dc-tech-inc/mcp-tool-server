import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, createFixture } from "./fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, "..", "dist", "index.js");

let fixture: Fixture;
let client: Client;

beforeAll(async () => {
  if (!existsSync(entry)) {
    throw new Error(`Build output missing: ${entry}. Run "pnpm build" first.`);
  }
  fixture = await createFixture();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, fixture.root],
    stderr: "pipe",
  });
  client = new Client({ name: "repo-health-e2e", version: "0.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
  await fixture?.cleanup();
});

describe("stdio end-to-end", () => {
  it("completes the handshake and lists the five tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
  });

  it("calls repo_summary over the real pipe and gets the fixture's commit count", async () => {
    const result = await client.callTool({ name: "repo_summary", arguments: { path: fixture.repo } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { totalCommits: number }).totalCommits).toBe(3);
  });
});
