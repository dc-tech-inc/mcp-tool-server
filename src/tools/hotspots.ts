import * as z from "zod/v4";
import { runGit } from "../git.js";
import { sinceIso } from "../repo.js";
import { defineTool } from "./types.js";

const RECORD_SEPARATOR = "\x1e";

export const hotspotsTool = defineTool({
  name: "change_hotspots",
  title: "Change hotspots",
  description:
    "List the files changed most often on HEAD over the last N days, with the number of commits " +
    "that touched each file and the lines added and deleted (from git log --numstat). Binary files count as 0 lines.",
  inputShape: {
    path: z.string().min(1).describe("Absolute path to a git repository directory inside an allowed root."),
    days: z.number().int().min(1).max(365).default(30).describe("Look-back window in days (1-365)."),
    limit: z.number().int().min(1).max(100).default(10).describe("Maximum number of files to return (1-100)."),
  },
  outputSchema: z.object({
    since: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        commits: z.number().int(),
        linesAdded: z.number().int(),
        linesDeleted: z.number().int(),
      }),
    ),
  }),
  run: async (dir, { days, limit }) => {
    const now = Date.now();
    const since = sinceIso(days, now);
    const out = await runGit(dir, [
      "log",
      `--since=${since}`,
      "--no-merges",
      "--no-renames",
      "--numstat",
      `--format=%x1e`,
    ]);

    const files = new Map<string, { commits: number; linesAdded: number; linesDeleted: number }>();
    for (const commitChunk of out.split(RECORD_SEPARATOR)) {
      const touched = new Set<string>();
      for (const line of commitChunk.split(/\r?\n/)) {
        const [added = "", deleted = "", filePath = ""] = line.split("\t");
        if (filePath === "") continue;
        const entry = files.get(filePath) ?? { commits: 0, linesAdded: 0, linesDeleted: 0 };
        entry.linesAdded += Number(added) || 0;
        entry.linesDeleted += Number(deleted) || 0;
        files.set(filePath, entry);
        touched.add(filePath);
      }
      for (const filePath of touched) {
        const entry = files.get(filePath);
        if (entry) entry.commits += 1;
      }
    }

    return {
      since,
      files: [...files]
        .map(([filePath, entry]) => ({ path: filePath, ...entry }))
        .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path))
        .slice(0, limit),
    };
  },
});
