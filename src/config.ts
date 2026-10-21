import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ToolError } from "./errors.js";

export interface Config {
  /** Canonical (realpath) directories that tools may read from. */
  readonly roots: readonly string[];
}

/**
 * Roots come from CLI arguments, else `REPO_HEALTH_ROOTS` (path-delimiter
 * separated), else the current working directory.
 */
export async function loadConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<Config> {
  const fromEnv = (env.REPO_HEALTH_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const inputs = argv.length > 0 ? [...argv] : fromEnv.length > 0 ? fromEnv : [cwd];

  const roots: string[] = [];
  for (const input of inputs) {
    try {
      roots.push(await realpath(path.resolve(cwd, input)));
    } catch {
      throw new Error(`Allowed root does not exist: ${input}`);
    }
  }
  return { roots };
}

/** True when `candidate` equals `root` or sits underneath it. */
function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Resolves a caller-supplied repository path to a real directory inside an
 * allowed root. `realpath` follows symlinks and junctions first, so a link
 * that points outside every root is rejected like any other outside path.
 */
export async function resolveInsideRoots(config: Config, input: string): Promise<string> {
  if (!path.isAbsolute(input)) {
    throw new ToolError("path must be an absolute directory path");
  }

  let real: string;
  try {
    real = await realpath(input);
  } catch {
    throw new ToolError(`path does not exist: ${input}`);
  }

  if (!config.roots.some((root) => isInside(root, real))) {
    throw new ToolError("path is outside the allowed roots");
  }

  const info = await stat(real);
  if (!info.isDirectory()) {
    throw new ToolError("path is not a directory");
  }
  return real;
}
