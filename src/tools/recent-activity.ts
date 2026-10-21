import * as z from "zod/v4";
import { sinceIso } from "../repo.js";
import { runGit } from "../git.js";
import { defineTool } from "./types.js";

/** Commits on HEAD since `days` ago, as `{ author name, author date }`. */
export async function commitsSince(
  dir: string,
  days: number,
  now: number,
): Promise<{ author: string; date: string }[]> {
  const out = await runGit(dir, [
    "log",
    `--since=${sinceIso(days, now)}`,
    "--format=%an%x1f%aI",
  ]);
  return out
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [author = "", date = ""] = line.split("\x1f");
      return { author, date };
    });
}

export const recentActivityTool = defineTool({
  name: "recent_activity",
  title: "Recent commit activity",
  description:
    "Count commits on HEAD over the last N days, grouped by author name and by author day. " +
    "Emails are never returned.",
  inputShape: {
    path: z.string().min(1).describe("Absolute path to a git repository directory inside an allowed root."),
    days: z.number().int().min(1).max(365).default(30).describe("Look-back window in days (1-365)."),
  },
  outputSchema: z.object({
    since: z.string(),
    commitCount: z.number().int(),
    byAuthor: z.array(z.object({ author: z.string(), commits: z.number().int() })),
    byDay: z.array(z.object({ date: z.string(), commits: z.number().int() })),
  }),
  run: async (dir, { days }) => {
    const now = Date.now();
    const commits = await commitsSince(dir, days, now);

    const authors = new Map<string, number>();
    const dayCounts = new Map<string, number>();
    for (const commit of commits) {
      authors.set(commit.author, (authors.get(commit.author) ?? 0) + 1);
      const day = commit.date.slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    return {
      since: sinceIso(days, now),
      commitCount: commits.length,
      byAuthor: [...authors]
        .map(([author, count]) => ({ author, commits: count }))
        .sort((a, b) => b.commits - a.commits || a.author.localeCompare(b.author)),
      byDay: [...dayCounts]
        .map(([date, count]) => ({ date, commits: count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  },
});
