import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, createFixture, daysAgoIso } from "./fixtures.js";
import { type Connected, connect } from "./helpers.js";

let fixture: Fixture;
let client: Connected;

beforeAll(async () => {
  fixture = await createFixture();
  client = await connect([fixture.root]);
});

afterAll(async () => {
  await client?.close();
  await fixture?.cleanup();
});

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.client.callTool({ name, arguments: args });
  return result;
}

describe("tool discovery", () => {
  it("lists exactly five read-only tools with input and output schemas", async () => {
    const { tools } = await client.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "change_hotspots",
      "hygiene_check",
      "recent_activity",
      "repo_summary",
      "stale_branches",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
  });
});

describe("repo_summary", () => {
  it("reports branch, head, dirty state and commit count from the fixture", async () => {
    const result = await call("repo_summary", { path: fixture.repo });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as Record<string, unknown>;
    expect(out.branch).toBe("main");
    expect(out.totalCommits).toBe(3);
    expect(out.dirtyFiles).toBe(1);
    expect(out.untrackedFiles).toBe(1);
    expect(out.ahead).toBeNull();
    expect(out.behind).toBeNull();
    expect(out.headCommit).toMatchObject({ subject: "Extend a and track env", author: "Alice" });
    expect(out.remotes).toEqual([]);
  });

  it("returns the text content block as JSON matching structuredContent", async () => {
    const result = await call("repo_summary", { path: fixture.repo });
    const text = (result.content as { type: string; text: string }[])[0];
    expect(text?.type).toBe("text");
    expect(JSON.parse(text?.text ?? "{}")).toEqual(result.structuredContent);
  });
});

describe("recent_activity", () => {
  it("counts commits in the last 30 days by author and by day, without emails", async () => {
    const result = await call("recent_activity", { path: fixture.repo, days: 30 });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as {
      commitCount: number;
      byAuthor: { author: string; commits: number }[];
      byDay: { date: string; commits: number }[];
    };
    expect(out.commitCount).toBe(3);
    expect(out.byAuthor).toEqual([
      { author: "Alice", commits: 2 },
      { author: "Bob", commits: 1 },
    ]);
    expect(out.byDay.map((d) => d.date)).toEqual([
      daysAgoIso(10).slice(0, 10),
      daysAgoIso(3).slice(0, 10),
      new Date().toISOString().slice(0, 10),
    ]);
    expect(JSON.stringify(out)).not.toContain("@example.com");
  });

  it("applies the default 30-day window when days is omitted", async () => {
    const result = await call("recent_activity", { path: fixture.repo });
    expect((result.structuredContent as { commitCount: number }).commitCount).toBe(3);
  });

  it("narrows to commits inside a 5-day window", async () => {
    const result = await call("recent_activity", { path: fixture.repo, days: 5 });
    expect((result.structuredContent as { commitCount: number }).commitCount).toBe(2);
  });
});

describe("change_hotspots", () => {
  it("ranks files by commit count with exact line totals", async () => {
    const result = await call("change_hotspots", { path: fixture.repo, days: 30, limit: 10 });
    expect(result.isError).toBeFalsy();
    const { files } = result.structuredContent as {
      files: { path: string; commits: number; linesAdded: number; linesDeleted: number }[];
    };
    expect(files[0]).toEqual({ path: "src/a.ts", commits: 3, linesAdded: 6, linesDeleted: 1 });
    expect(files).toContainEqual({ path: "src/b.ts", commits: 1, linesAdded: 4, linesDeleted: 0 });
    expect(files).toContainEqual({ path: ".env", commits: 1, linesAdded: 1, linesDeleted: 0 });
  });

  it("honours limit", async () => {
    const result = await call("change_hotspots", { path: fixture.repo, limit: 1 });
    expect((result.structuredContent as { files: unknown[] }).files).toHaveLength(1);
  });
});

describe("hygiene_check", () => {
  it("passes README, LICENSE, .gitignore and size checks, fails CI, lockfile and tracked .env", async () => {
    const result = await call("hygiene_check", { path: fixture.repo });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { checks: { id: string; passed: boolean }[]; score: number };
    const passed = Object.fromEntries(out.checks.map((c) => [c.id, c.passed]));
    expect(passed).toEqual({
      readme: true,
      license: true,
      gitignore: true,
      ci_workflow: false,
      lockfile: false,
      no_env_file_tracked: false,
      no_large_tracked_files: true,
    });
    expect(out.score).toBe(57);
  });
});

describe("stale_branches", () => {
  it("returns only the unmerged branch older than 90 days", async () => {
    const result = await call("stale_branches", { path: fixture.repo, olderThanDays: 90 });
    expect(result.isError).toBeFalsy();
    const { branches } = result.structuredContent as {
      branches: { name: string; ageDays: number; merged: boolean }[];
    };
    expect(branches).toHaveLength(1);
    expect(branches[0]?.name).toBe("old-feature");
    expect(branches[0]?.merged).toBe(false);
    expect(branches[0]?.ageDays).toBeGreaterThanOrEqual(119);
    expect(branches[0]?.ageDays).toBeLessThanOrEqual(121);
  });

  it("with a 1-day threshold, still omits the fresh main branch", async () => {
    const result = await call("stale_branches", { path: fixture.repo, olderThanDays: 1 });
    const { branches } = result.structuredContent as { branches: { name: string }[] };
    expect(branches.map((b) => b.name)).toEqual(["old-feature"]);
  });
});
