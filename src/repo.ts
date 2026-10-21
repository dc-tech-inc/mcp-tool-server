import { realpath } from "node:fs/promises";
import path from "node:path";
import { type Config, containingRoot, resolveInsideRoots } from "./config.js";
import { ToolError } from "./errors.js";
import { runGit } from "./git.js";

/**
 * Validates a caller-supplied path (inside an allowed root, a directory, and a
 * git work tree) and returns the canonical top level of its repository.
 *
 * The path check alone is not enough: git looks upward for an enclosing
 * repository, and a `.git` file can point anywhere with `gitdir:`. So the
 * discovery is capped at the root's parent, and the work tree, the git
 * directory and the common git directory must all resolve inside a root.
 */
export async function resolveRepo(config: Config, input: string): Promise<string> {
  const dir = await resolveInsideRoots(config, input);
  const root = containingRoot(config, dir) ?? dir;

  let lines: string[];
  try {
    const out = await runGit(
      dir,
      ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"],
      path.dirname(root),
    );
    lines = out.split(/\r?\n/).filter((line) => line.length > 0);
  } catch {
    throw new ToolError("not a git repository");
  }

  const located = await Promise.all(
    lines.map((line) => realpath(path.resolve(dir, line)).catch(() => undefined)),
  );
  if (located.length !== 3 || located.some((real) => real === undefined || containingRoot(config, real) === undefined)) {
    throw new ToolError("git repository is outside the allowed roots");
  }
  return located[0] as string;
}

export const MS_PER_DAY = 86_400_000;

/** ISO timestamp for `days` days before `now`, used as `git log --since`. */
export function sinceIso(days: number, now: number): string {
  return new Date(now - days * MS_PER_DAY).toISOString();
}
