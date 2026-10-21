import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { ToolError } from "./errors.js";

const execFileAsync = promisify(execFile);

export const GIT_TIMEOUT_MS = 10_000;
export const GIT_MAX_BUFFER = 10 * 1024 * 1024;

interface GitExecError extends NodeJS.ErrnoException {
  stderr?: string;
  killed?: boolean;
}

/**
 * Runs a fixed git subcommand inside `dir`. Arguments are passed as an array to
 * `execFile` (never a shell), and every caller supplies its own fixed flags.
 * Caller-provided data never becomes a git option.
 *
 * `ceiling` becomes `GIT_CEILING_DIRECTORIES`: git never walks up into it while
 * looking for a repository. The default, the parent of `dir`, means git only
 * uses a repository whose top level is `dir` itself.
 */
export async function runGit(
  dir: string,
  args: readonly string[],
  ceiling: string = path.dirname(dir),
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dir, "--no-optional-locks", "-c", "core.quotePath=false", ...args],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: "utf8",
        windowsHide: true,
        // No optional locks: `git status` must not refresh `.git/index` on disk.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_CEILING_DIRECTORIES: ceiling },
      },
    );
    return stdout;
  } catch (err) {
    const e = err as GitExecError;
    if (e.code === "ENOENT") {
      throw new ToolError("git executable was not found on PATH");
    }
    if (e.killed) {
      throw new ToolError(`git ${args[0] ?? ""} timed out after ${GIT_TIMEOUT_MS / 1000} s`);
    }
    const firstLine = (e.stderr ?? "").split(/\r?\n/).find((line) => line.trim() !== "") ?? "unknown error";
    throw new ToolError(`git ${args[0] ?? ""} failed: ${firstLine.trim()}`);
  }
}

/**
 * Removes the user and password from a remote URL. A URL that parses is
 * rebuilt without them. Anything else that contains `@` (scp-style
 * `user@host:path`, or a password with `/` that breaks parsing) loses
 * everything between the scheme and the last `@`, so no part of a password
 * survives even if a little of the host or path is dropped with it.
 */
export function stripUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username !== "" || parsed.password !== "") {
      parsed.username = "";
      parsed.password = "";
      // The setters are no-ops for a few schemes; fall through to the cut then.
      if (parsed.username === "" && parsed.password === "") return parsed.href;
    } else if (!url.includes("@")) {
      return url;
    }
  } catch {
    // Not a WHATWG URL: handled below.
  }
  const at = url.lastIndexOf("@");
  if (at === -1) return url;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)?.[0] ?? "";
  return scheme + url.slice(at + 1);
}
