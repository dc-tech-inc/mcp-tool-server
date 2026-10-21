import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Fixture {
  /** Parent temp directory; removed by `cleanup`. */
  readonly root: string;
  /** The fixture git repository, `<root>/alpha`. */
  readonly repo: string;
  cleanup(): Promise<void>;
}

interface CommitSpec {
  author: string;
  /** Committer and author date, ISO 8601. */
  date: string;
  message: string;
  files: Record<string, string>;
}

const DAY_MS = 86_400_000;

/** Noon UTC, `days` days before `now`, so per-day buckets are stable. */
export function daysAgoIso(days: number, now = Date.now()): string {
  const day = new Date(now - days * DAY_MS);
  day.setUTCHours(12, 0, 0, 0);
  return day.toISOString();
}

async function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
  return stdout;
}

async function commit(repo: string, spec: CommitSpec): Promise<void> {
  for (const [file, content] of Object.entries(spec.files)) {
    const target = path.join(repo, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await git(repo, ["add", "-A"]);
  await git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", spec.message], {
    GIT_AUTHOR_NAME: spec.author,
    GIT_AUTHOR_EMAIL: `${spec.author.toLowerCase()}@example.com`,
    GIT_AUTHOR_DATE: spec.date,
    GIT_COMMITTER_NAME: spec.author,
    GIT_COMMITTER_EMAIL: `${spec.author.toLowerCase()}@example.com`,
    GIT_COMMITTER_DATE: spec.date,
  });
}

/**
 * Builds a temp repository with scripted history so tests can assert exact counts:
 *
 *   c1  10 days ago  Alice  README, LICENSE, .gitignore, src/a.ts (3 lines)
 *   c2   3 days ago  Bob    src/a.ts (+2 -1), src/b.ts (+4),
 *   c3   now         Alice  src/a.ts (+1), .env (tracked on purpose, for hygiene)
 *
 * Branch `old-feature` gets one commit dated 120 days ago and is not merged.
 * Afterwards src/a.ts is modified and `scratch.txt` is created, uncommitted.
 */
export async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repo-health-"));
  const repo = path.join(root, "alpha");
  await mkdir(repo);
  await git(repo, ["init", "-q", "-b", "main"]);

  await commit(repo, {
    author: "Alice",
    date: daysAgoIso(10),
    message: "Initial commit",
    files: {
      "README.md": "# alpha\n",
      LICENSE: "MIT\n",
      ".gitignore": "node_modules/\n",
      "src/a.ts": "one\ntwo\nthree\n",
    },
  });

  await commit(repo, {
    author: "Bob",
    date: daysAgoIso(3),
    message: "Revise a and add b",
    files: {
      "src/a.ts": "one\nTWO\nthree\nfour\n",
      "src/b.ts": "x\ny\nz\nw\n",
    },
  });

  await commit(repo, {
    author: "Alice",
    date: new Date().toISOString(),
    message: "Extend a and track env",
    files: {
      "src/a.ts": "one\nTWO\nthree\nfour\nfive\n",
      ".env": "EXAMPLE=1\n",
    },
  });

  await git(repo, ["branch", "old-feature", "HEAD~1"]);
  await git(repo, ["checkout", "-q", "old-feature"]);
  await commit(repo, {
    author: "Bob",
    date: daysAgoIso(120),
    message: "Old experiment",
    files: { "experiment.txt": "old\n" },
  });
  await git(repo, ["checkout", "-q", "main"]);

  // Dirty state: one modified tracked file, one untracked file.
  await writeFile(path.join(repo, "src", "a.ts"), "one\nTWO\nthree\nfour\nfive\nsix\n", "utf8");
  await writeFile(path.join(repo, "scratch.txt"), "not committed\n", "utf8");

  return {
    root,
    repo,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** A second, unrelated git repository, used to prove path containment. */
export async function createOutsideRepo(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repo-health-outside-"));
  const repo = path.join(root, "outside");
  await mkdir(repo);
  await git(repo, ["init", "-q", "-b", "main"]);
  await commit(repo, {
    author: "Carol",
    date: daysAgoIso(1),
    message: "Outside commit",
    files: { "secret-note.txt": "outside the allowed root\n" },
  });
  return { root, repo, cleanup: () => rm(root, { recursive: true, force: true }) };
}
