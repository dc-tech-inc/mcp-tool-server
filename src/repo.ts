import { type Config, resolveInsideRoots } from "./config.js";
import { ToolError } from "./errors.js";
import { runGit } from "./git.js";

/**
 * Validates a caller-supplied path (inside an allowed root, a directory, and a
 * git work tree) and returns its canonical location for the git wrapper.
 */
export async function resolveRepo(config: Config, input: string): Promise<string> {
  const dir = await resolveInsideRoots(config, input);
  try {
    await runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new ToolError("not a git repository");
  }
  return dir;
}

export const MS_PER_DAY = 86_400_000;

/** ISO timestamp for `days` days before `now`, used as `git log --since`. */
export function sinceIso(days: number, now: number): string {
  return new Date(now - days * MS_PER_DAY).toISOString();
}
