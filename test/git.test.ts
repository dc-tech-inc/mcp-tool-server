import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const { execFile } = await import("node:child_process");
const { GIT_MAX_BUFFER, GIT_TIMEOUT_MS, runGit } = await import("../src/git.js");

type Callback = (error: Error | null, stdout?: string) => void;

/** Makes the mocked `execFile` call back with `error`, or succeed with empty output. */
function respond(error: Error | null): void {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    (args.at(-1) as Callback)(error, "");
  }) as never);
}

afterEach(() => {
  vi.mocked(execFile).mockReset();
});

describe("runGit", () => {
  it("runs git without a shell, with the timeout, buffer cap, ceiling and no optional locks", async () => {
    respond(null);
    const dir = path.resolve("repo");
    await runGit(dir, ["status", "--porcelain=v1"]);

    const [command, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [
      string,
      string[],
      { timeout: number; maxBuffer: number; shell?: unknown; env: Record<string, string> },
    ];
    expect(command).toBe("git");
    expect(args).toEqual(["-C", dir, "--no-optional-locks", "-c", "core.quotePath=false", "status", "--porcelain=v1"]);
    expect(options.shell).toBeUndefined();
    expect(options.timeout).toBe(GIT_TIMEOUT_MS);
    expect(options.maxBuffer).toBe(GIT_MAX_BUFFER);
    expect(options.env.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(options.env.GIT_CEILING_DIRECTORIES).toBe(path.dirname(dir));
  });

  it("maps a missing git executable to a readable error", async () => {
    respond(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }));
    await expect(runGit(path.resolve("repo"), ["status"])).rejects.toThrow("git executable was not found on PATH");
  });

  it("maps a git process killed by the timeout to a timeout error", async () => {
    respond(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM", stderr: "" }));
    await expect(runGit(path.resolve("repo"), ["log"])).rejects.toThrow(
      `git log timed out after ${GIT_TIMEOUT_MS / 1000} s`,
    );
  });

  it("reports the first stderr line of any other git failure", async () => {
    respond(Object.assign(new Error("Command failed"), { code: 128, stderr: "\nfatal: bad object HEAD\nmore\n" }));
    await expect(runGit(path.resolve("repo"), ["log"])).rejects.toThrow("git log failed: fatal: bad object HEAD");
  });
});
