import * as z from "zod/v4";
import { runGit, stripUrlCredentials } from "../git.js";
import { defineTool } from "./types.js";

const remoteSchema = z.object({ name: z.string(), url: z.string() });

export const repoSummaryTool = defineTool({
  name: "repo_summary",
  title: "Repository summary",
  description:
    "Summarize a local git repository: current branch, HEAD commit, remotes (credentials removed), " +
    "dirty and untracked file counts, ahead/behind counts against the upstream branch, and total commits on HEAD.",
  inputShape: {
    path: z.string().min(1).describe("Absolute path to a git repository directory inside an allowed root."),
  },
  outputSchema: z.object({
    branch: z.string(),
    headCommit: z.object({
      sha: z.string(),
      subject: z.string(),
      author: z.string(),
      date: z.string(),
    }),
    remotes: z.array(remoteSchema),
    dirtyFiles: z.number().int(),
    untrackedFiles: z.number().int(),
    ahead: z.number().int().nullable(),
    behind: z.number().int().nullable(),
    totalCommits: z.number().int(),
  }),
  run: async (dir) => {
    const branch = (await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();

    const [sha = "", subject = "", author = "", date = ""] = (
      await runGit(dir, ["log", "-1", "--format=%H%x1f%s%x1f%an%x1f%aI"])
    )
      .trim()
      .split("\x1f");

    const remotes = (await runGit(dir, ["remote", "-v"]))
      .split(/\r?\n/)
      .filter((line) => line.endsWith("(fetch)"))
      .map((line) => {
        const [name = "", url = ""] = line.split(/\s+/);
        return { name, url: stripUrlCredentials(url) };
      });

    let dirtyFiles = 0;
    let untrackedFiles = 0;
    for (const line of (await runGit(dir, ["status", "--porcelain=v1"])).split(/\r?\n/)) {
      if (line.length === 0) continue;
      if (line.startsWith("??")) untrackedFiles += 1;
      else dirtyFiles += 1;
    }

    let ahead: number | null = null;
    let behind: number | null = null;
    try {
      const counts = (await runGit(dir, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])).trim();
      const [left = "0", right = "0"] = counts.split(/\s+/);
      behind = Number(left);
      ahead = Number(right);
    } catch {
      // No upstream configured: ahead/behind stay null.
    }

    const totalCommits = Number((await runGit(dir, ["rev-list", "--count", "HEAD"])).trim());

    return {
      branch,
      headCommit: { sha, subject, author, date },
      remotes,
      dirtyFiles,
      untrackedFiles,
      ahead,
      behind,
      totalCommits,
    };
  },
});
