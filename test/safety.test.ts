import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripUrlCredentials } from "../src/git.js";
import { type Fixture, createFixture, createOutsideRepo } from "./fixtures.js";
import { type Connected, connect, errorText } from "./helpers.js";

let fixture: Fixture;
let outside: Fixture;
let client: Connected;

beforeAll(async () => {
  fixture = await createFixture();
  outside = await createOutsideRepo();
  client = await connect([fixture.repo]);

  // A plain folder inside the root, not a git repository.
  await mkdir(path.join(fixture.root, "plain-folder"));

  // Symlink (junction on Windows, which needs no privileges) that escapes the root.
  await symlink(outside.repo, path.join(fixture.repo, "escape-link"), "junction");
});

afterAll(async () => {
  await client?.close();
  await outside?.cleanup();
  await fixture?.cleanup();
});

describe("path containment", () => {
  it("rejects a repository outside the allowed root", async () => {
    const result = await client.client.callTool({ name: "repo_summary", arguments: { path: outside.repo } });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("outside the allowed roots");
  });

  it("rejects a symlink or junction that escapes the root", async () => {
    const result = await client.client.callTool({
      name: "repo_summary",
      arguments: { path: path.join(fixture.repo, "escape-link") },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("outside the allowed roots");
  });

  it("rejects a relative path", async () => {
    const result = await client.client.callTool({ name: "repo_summary", arguments: { path: "alpha" } });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("absolute");
  });

  it("rejects a path that does not exist", async () => {
    const result = await client.client.callTool({
      name: "repo_summary",
      arguments: { path: path.join(fixture.repo, "missing") },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("does not exist");
  });

  it("rejects a regular file", async () => {
    const result = await client.client.callTool({
      name: "repo_summary",
      arguments: { path: path.join(fixture.repo, "README.md") },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("not a directory");
  });
});

describe("git repository check", () => {
  it("reports a plain directory inside the root as not a git repository", async () => {
    const roots = [fixture.root];
    const wide = await connect(roots);
    try {
      const result = await wide.client.callTool({
        name: "repo_summary",
        arguments: { path: path.join(fixture.root, "plain-folder") },
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("not a git repository");
    } finally {
      await wide.close();
    }
  });
});

describe("input validation", () => {
  it.each([
    ["days below range", "recent_activity", { days: 0 }],
    ["days above range", "recent_activity", { days: 1000 }],
    ["limit above range", "change_hotspots", { limit: 1000 }],
    ["olderThanDays above range", "stale_branches", { olderThanDays: 99999 }],
    ["empty path", "repo_summary", { path: "" }],
  ])("rejects invalid arguments: %s", async (_label, name, extra) => {
    const result = await client.client.callTool({
      name,
      arguments: { path: fixture.repo, ...extra },
    });
    expect(result.isError).toBe(true);
  });
});

describe("remote URL credentials", () => {
  it("strips user and password from https remotes", () => {
    const withCredentials = ["https://", "ci-user", ":", "placeholder", "@", "example.com/acme/alpha.git"].join("");
    expect(stripUrlCredentials(withCredentials)).toBe("https://example.com/acme/alpha.git");
  });

  it("leaves credential-free and scp-style remotes unchanged", () => {
    expect(stripUrlCredentials("https://example.com/acme/alpha.git")).toBe("https://example.com/acme/alpha.git");
    expect(stripUrlCredentials("git@example.com:acme/alpha.git")).toBe("git@example.com:acme/alpha.git");
  });
});
