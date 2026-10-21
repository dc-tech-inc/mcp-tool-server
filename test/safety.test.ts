import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripUrlCredentials } from "../src/git.js";
import {
  CREDENTIAL_REMOTES,
  type Fixture,
  addCredentialRemotes,
  createFixture,
  createOutsideRepo,
} from "./fixtures.js";
import { type Connected, connect, errorText, expectNoCredentials } from "./helpers.js";

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

describe("repository containment", () => {
  it("rejects an allowed root that is a plain folder inside a repository outside the roots", async () => {
    // git would otherwise walk up from the root and report on the enclosing repository.
    const allowed = path.join(outside.repo, "allowed");
    await mkdir(path.join(allowed, "sub"), { recursive: true });
    await writeFile(path.join(allowed, "sub", "f.txt"), "inside the parent repo\n", "utf8");
    const narrow = await connect([allowed]);
    try {
      for (const target of [allowed, path.join(allowed, "sub")]) {
        const result = await narrow.client.callTool({ name: "repo_summary", arguments: { path: target } });
        expect(result.isError).toBe(true);
        expect(errorText(result)).toMatch(/not a git repository|outside the allowed roots/);
        expect(errorText(result)).not.toContain("Outside commit");
      }
    } finally {
      await narrow.close();
    }
  });

  it("rejects a folder whose .git file points to a git directory outside the roots", async () => {
    const pointer = path.join(fixture.root, "pointer");
    await mkdir(pointer);
    await writeFile(path.join(pointer, ".git"), `gitdir: ${path.join(outside.repo, ".git").replaceAll("\\", "/")}\n`);
    const wide = await connect([fixture.root]);
    try {
      const result = await wide.client.callTool({ name: "repo_summary", arguments: { path: pointer } });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("outside the allowed roots");
      expect(errorText(result)).not.toContain("Outside commit");
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
  it("repo_summary returns credentialed remotes stripped, with no part of any secret", async () => {
    await addCredentialRemotes(outside.repo);
    const other = await connect([outside.root]);
    try {
      const result = await other.client.callTool({ name: "repo_summary", arguments: { path: outside.repo } });
      expect(result.isError).toBeFalsy();
      expectNoCredentials(result);
    } finally {
      await other.close();
    }
  });

  it.each(CREDENTIAL_REMOTES.map((remote) => [remote.name, remote] as const))(
    "removes every part of the credentials: %s",
    (_label, remote) => {
      const stripped = stripUrlCredentials(remote.url);
      expect(stripped).toBe(remote.stripped);
      expect(stripped).not.toContain(remote.secret);
    },
  );

  it("drops the user part of scp-style remotes, password or not", () => {
    expect(stripUrlCredentials("git@example.com:acme/alpha.git")).toBe("example.com:acme/alpha.git");
    expect(stripUrlCredentials(["user:", "pw/x@y", "@example.com:acme/alpha.git"].join(""))).toBe(
      "example.com:acme/alpha.git",
    );
  });

  it("leaves credential-free remotes unchanged", () => {
    expect(stripUrlCredentials("https://example.com/acme/alpha.git")).toBe("https://example.com/acme/alpha.git");
    expect(stripUrlCredentials("ssh://example.com:2222/acme/alpha.git")).toBe("ssh://example.com:2222/acme/alpha.git");
    expect(stripUrlCredentials("C:\\repos\\alpha")).toBe("C:\\repos\\alpha");
    expect(stripUrlCredentials("/srv/git/alpha.git")).toBe("/srv/git/alpha.git");
  });
});
