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
      ["-C", dir, "-c", "core.quotePath=false", ...args],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: ceiling },
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

/** Removes `user:password@` from URLs. SCP-style `user@host:path` is left alone. */
export function stripUrlCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, "$1");
}
