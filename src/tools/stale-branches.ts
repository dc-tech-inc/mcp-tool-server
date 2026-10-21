import * as z from "zod/v4";
import { runGit } from "../git.js";
import { MS_PER_DAY } from "../repo.js";
import { defineTool } from "./types.js";

export const staleBranchesTool = defineTool({
  name: "stale_branches",
  title: "Stale local branches",
  description:
    "List local branches whose last commit (committer date) is at least N days old, with whether each " +
    "branch is already merged into HEAD. Read-only: nothing is deleted.",
  inputShape: {
    path: z.string().min(1).describe("Absolute path to a git repository directory inside an allowed root."),
    olderThanDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(90)
      .describe("Minimum branch age in days (1-3650)."),
  },
  outputSchema: z.object({
    branches: z.array(
      z.object({
        name: z.string(),
        lastCommitDate: z.string(),
        ageDays: z.number().int(),
        merged: z.boolean(),
      }),
    ),
  }),
  run: async (dir, { olderThanDays }) => {
    const now = Date.now();
    const refs = await runGit(dir, [
      "for-each-ref",
      "--format=%(refname:short)\t%(committerdate:iso-strict)",
      "refs/heads",
    ]);
    const merged = new Set(
      (await runGit(dir, ["for-each-ref", "--merged=HEAD", "--format=%(refname:short)", "refs/heads"]))
        .split(/\r?\n/)
        .filter((name) => name.length > 0),
    );

    const branches = refs
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name = "", lastCommitDate = ""] = line.split("\t");
        const ageDays = Math.floor((now - Date.parse(lastCommitDate)) / MS_PER_DAY);
        return { name, lastCommitDate, ageDays, merged: merged.has(name) };
      })
      .filter((branch) => branch.ageDays >= olderThanDays)
      .sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));

    return { branches };
  },
});
