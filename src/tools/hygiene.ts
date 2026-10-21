import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";
import { runGit } from "../git.js";
import { defineTool } from "./types.js";

export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
];

const checkSchema = z.object({
  id: z.enum([
    "readme",
    "license",
    "gitignore",
    "ci_workflow",
    "lockfile",
    "no_env_file_tracked",
    "no_large_tracked_files",
  ]),
  passed: z.boolean(),
  detail: z.string(),
});

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export const hygieneTool = defineTool({
  name: "hygiene_check",
  title: "Repository hygiene check",
  description:
    "Run seven static checks on a repository's working tree and tracked files: README, LICENSE, .gitignore, " +
    "a GitHub Actions workflow, a known lockfile, no tracked .env files (except .env.example), and no tracked " +
    "files over 5 MB. Returns a score from 0 to 100 (share of checks passed).",
  inputShape: {
    path: z.string().min(1).describe("Absolute path to a git repository directory inside an allowed root."),
  },
  outputSchema: z.object({
    checks: z.array(checkSchema),
    score: z.number().int().min(0).max(100),
  }),
  run: async (dir) => {
    const rootEntries = await listDir(dir);
    const workflowEntries = await listDir(path.join(dir, ".github", "workflows"));
    const tracked = (await runGit(dir, ["ls-files", "-z"])).split("\0").filter((f) => f.length > 0);

    const readme = rootEntries.filter((e) => /^readme(\.|$)/i.test(e));
    const license = rootEntries.filter((e) => /^(license|licence|copying)(\.|$)/i.test(e));
    const lockfiles = rootEntries.filter((e) => LOCKFILES.includes(e));
    const workflows = workflowEntries.filter((e) => /\.ya?ml$/i.test(e));

    const envFiles = tracked.filter((f) => {
      const base = path.posix.basename(f);
      return base.startsWith(".env") && base !== ".env.example";
    });

    const large: string[] = [];
    for (const file of tracked) {
      try {
        const info = await stat(path.join(dir, file));
        if (info.isFile() && info.size > LARGE_FILE_BYTES) large.push(file);
      } catch {
        // Tracked but deleted in the working tree: nothing to measure.
      }
    }

    const checks = [
      {
        id: "readme" as const,
        passed: readme.length > 0,
        detail: readme.length > 0 ? `found ${readme[0]}` : "no README at the repository root",
      },
      {
        id: "license" as const,
        passed: license.length > 0,
        detail: license.length > 0 ? `found ${license[0]}` : "no LICENSE file at the repository root",
      },
      {
        id: "gitignore" as const,
        passed: rootEntries.includes(".gitignore"),
        detail: rootEntries.includes(".gitignore") ? "found .gitignore" : "no .gitignore at the repository root",
      },
      {
        id: "ci_workflow" as const,
        passed: workflows.length > 0,
        detail: workflows.length > 0 ? `found ${workflows.length} workflow file(s)` : "no .github/workflows/*.yml",
      },
      {
        id: "lockfile" as const,
        passed: lockfiles.length > 0,
        detail: lockfiles.length > 0 ? `found ${lockfiles.join(", ")}` : "no known lockfile at the repository root",
      },
      {
        id: "no_env_file_tracked" as const,
        passed: envFiles.length === 0,
        detail: envFiles.length === 0 ? "no tracked .env files" : `tracked: ${envFiles.join(", ")}`,
      },
      {
        id: "no_large_tracked_files" as const,
        passed: large.length === 0,
        detail: large.length === 0 ? "no tracked file over 5 MB" : `over 5 MB: ${large.join(", ")}`,
      },
    ];

    const passed = checks.filter((c) => c.passed).length;
    return { checks, score: Math.round((passed / checks.length) * 100) };
  },
});
