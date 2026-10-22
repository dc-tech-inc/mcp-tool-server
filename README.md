# mcp-repo-health

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io/) server, written in TypeScript, that reports the health of local git repositories. It runs over stdio and exposes five tools.

The repository is called `mcp-tool-server` because it is the MCP example in a set of portfolio repositories; the package, the binary and the server name it reports to clients are `mcp-repo-health`, which says what it does.

## What it is

`mcp-repo-health` lets an MCP-capable AI assistant answer questions such as "how healthy is this repo?", "what changed recently?", or "which branches are stale?" by calling typed tools instead of running arbitrary shell commands. It is a reference implementation: the protocol plumbing, input validation, and tests are the point, and the five repo-health tools are a concrete domain to exercise them.

## Why it exists

Giving an assistant a shell is broad and hard to constrain. This server takes the opposite approach:

- Five fixed tools, each with a JSON input schema and a JSON output schema.
- Every path, and the repository git finds for it, is checked against an allow-list of roots.
- Git is invoked with fixed arguments through `execFile`, never through a shell, and user input never becomes a git option.
- Every tool is annotated `readOnlyHint: true`. The server never writes, fetches, or touches the network. Git runs with optional locks disabled, so even `git status` does not refresh the index file.

## Tools

| Tool | Input | Output (`structuredContent`) |
|---|---|---|
| `repo_summary` | `path` | Branch, HEAD commit (sha, subject, author name, date), remotes with credentials removed, dirty and untracked file counts, ahead/behind against the upstream (`null` when no upstream), total commits on HEAD |
| `recent_activity` | `path`, `days` (1–365, default 30) | Window start, commit count, commits per author name, commits per day. Emails are not returned. |
| `change_hotspots` | `path`, `days` (1–365, default 30), `limit` (1–100, default 10) | Files ranked by number of commits, with lines added and deleted from `git log --numstat`. Binary files count as 0 lines. |
| `hygiene_check` | `path` | Seven checks (`readme`, `license`, `gitignore`, `ci_workflow`, `lockfile`, `no_env_file_tracked`, `no_large_tracked_files`), each with `passed` and `detail`, plus a `score` from 0 to 100 |
| `stale_branches` | `path`, `olderThanDays` (1–3650, default 90) | Local branches whose last commit (committer date) is at least that old, with `ageDays` and whether each is merged into HEAD. Nothing is deleted. |

Each tool also returns the same data as a JSON text block for clients that do not read `structuredContent`. Failures (bad path, not a git repository, git timeout) come back as `isError: true` with a plain message.

A `path` inside a repository (for example its `src` folder) is accepted and resolved to the repository's top level, so every tool reports on the whole repository.

## Install and use

Requirements: Node.js 24 or newer, pnpm 11, and `git` on `PATH`.

```bash
pnpm install
pnpm build
# the server is now at dist/index.js
```

The allowed roots are the CLI arguments, or the `REPO_HEALTH_ROOTS` environment variable (separated by the platform path delimiter, `;` on Windows and `:` elsewhere), or the working directory if neither is set. Use absolute paths in client configuration.

### Claude Code

```bash
claude mcp add repo-health -- node /absolute/path/to/mcp-tool-server/dist/index.js /absolute/path/to/your/repos
```

### Claude Desktop

Add an entry under `mcpServers` in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "repo-health": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-tool-server/dist/index.js",
        "/absolute/path/to/your/repos"
      ]
    }
  }
}
```

### VS Code

Create `.vscode/mcp.json` in the workspace:

```json
{
  "servers": {
    "repo-health": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-tool-server/dist/index.js",
        "/absolute/path/to/your/repos"
      ]
    }
  }
}
```

Installation details for each host are in the MCP documentation linked under [Docs cited](#docs-cited).

## Safety model

1. **Allow-list roots.** The server refuses any path outside the roots it was started with.
2. **Canonical paths.** Each `path` must be absolute. It is resolved with `realpath` before the check, so `..` segments and symlinks or Windows junctions that point outside a root are rejected.
3. **Directory and repository checks.** The target must be a directory and a git work tree. Anything else returns `isError`.
4. **The repository must be inside a root too.** Git looks upward for an enclosing repository, and a `.git` file can point anywhere with `gitdir:`. So repository discovery is capped with `GIT_CEILING_DIRECTORIES` at the parent of the root, and the repository's top level, its git directory and its common git directory (`git rev-parse --show-toplevel --absolute-git-dir --git-common-dir`) must each resolve with `realpath` inside an allowed root. A root that is a plain folder inside a larger repository, or a folder whose `.git` file points outside the roots, is rejected. Every later git call runs on that top level with the ceiling at its parent.
5. **No shell.** Git runs through `execFile("git", ["-C", dir, "--no-optional-locks", ...fixedArgs])` with a 10-second timeout and a 10 MB output cap, and with `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0` in its environment. Only fixed flags are passed. The tools take no git refs or revisions as input.
6. **Credentials stripped.** Remote URLs are parsed with the WHATWG `URL` parser and returned without user name and password, so `https://user:token@host/repo.git` becomes `https://host/repo.git`, including passwords that contain `@`. A remote that does not parse (for example, a password containing `/`) or an scp-style remote (`user@host:path`) loses everything between the scheme and the last `@`. That can drop part of an unusual host or path, but never leaves part of a password.
7. **Logs on stderr.** stdout carries the protocol, so the server writes nothing else there.
8. **Read-only annotations.** All tools declare `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: false`.

This is a local, single-user tool. It has no authentication, because it listens on nothing: it speaks only over the stdio pipe that the host process starts.

## How to test

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test                 # build + vitest run
pnpm coverage             # vitest run --coverage; needs dist/ from pnpm build for the stdio test
pnpm secrets              # secretlint over the working tree
```

Use `pnpm coverage` for a coverage report. `pnpm test -- --coverage` runs the tests but produces no report.

CI also scans the full git history with the free [gitleaks](https://github.com/gitleaks/gitleaks) v8.30.1 release binary (`gitleaks git . --redact`, on the Linux leg; the download is checked against the published checksums). To run the same scan locally, download the binary for your platform from the gitleaks releases page and run that command in the repository.

The test suite has four files:

- `test/tools.test.ts` calls every tool through an MCP client on an in-memory transport and checks exact counts against a scripted fixture repository.
- `test/safety.test.ts` covers path containment (outside path, junction escape, relative path, missing path, regular file), repository containment (a root that is a plain folder inside an outside repository, a `.git` file pointing outside the roots), the non-repository case, schema rejection (out-of-range values and an empty path; the handler is not called and the error names the field), and credential stripping, both on the helper and through `repo_summary` with remotes whose passwords contain `@` and `/`.
- `test/git.test.ts` checks the `execFile` call (no shell, timeout, buffer cap, ceiling, no optional locks) and the error messages for a missing git, a timeout and a plain git failure, with `execFile` mocked.
- `test/stdio.e2e.test.ts` spawns the built `dist/index.js` with `StdioClientTransport`, completes the real handshake, calls a tool over the pipe, and checks that credentialed remotes come back stripped.

Fixtures are created in the OS temp directory at test time. Each one is a fresh repository with scripted commits and backdated dates. Tests never read a real repository on the machine.

Measured with `pnpm coverage` (v8 provider, `src/**` only) on the run recorded with this commit:

- 39 tests in 4 files, all passing
- Statements 92.71% (191/206), branches 77.67% (87/112), functions 88.67% (47/53), lines 94.62% (176/186)

`src/index.ts` shows 0% in this report because the stdio test runs it in a child process, which the in-process coverage collector does not see. The stdio test is the only test that covers it.

## Architecture notes

- `src/index.ts` is the CLI entry. It loads the roots, then calls `serveStdio` from `@modelcontextprotocol/server/stdio` with a server factory.
- `src/server.ts` is a factory, `createServer(config)`, which builds an `McpServer` and registers the five tools through one `register` helper. The helper runs the path check before every handler and maps the result to `content` plus `structuredContent`.
- `src/config.ts` parses roots and implements `resolveInsideRoots` (realpath, containment, directory check).
- `src/repo.ts` adds the repository checks on top of that: it asks git for the top level, git directory and common git directory with discovery capped at the root's parent, requires all three inside a root, and hands the top level to the tool.
- `src/git.ts` is the only place that spawns processes. It wraps `execFile` with the timeout, buffer limit, and error mapping, and strips credentials from URLs.
- `src/tools/*.ts` contains one module per tool. Each exports a `defineTool` object (name, title, description, zod input shape, zod output schema, handler). Handlers receive a validated directory and never see raw input paths.
- Input validation uses zod v4 (`import * as z from "zod/v4"`). The SDK rejects schema violations before a handler runs.

## Limitations

- **Local git only.** No GitHub or GitLab API calls. Remote URLs are reported from the local config only.
- **Large repositories can hit the 10-second git timeout.** The timeout is fixed in code; the tools return a clear error rather than partial data.
- **`recent_activity`, `change_hotspots`, and `stale_branches` look at HEAD or local branches only.** Remote-tracking branches and other refs are not counted.
- **`stale_branches` uses the committer date**, not the author date, and includes the checked-out branch when it is old enough.
- **Windows path handling is tested on one machine only.** The CI matrix runs Ubuntu and Windows, but the junction escape test is the most platform-specific part of the suite.
- **Client setup was not exercised against live hosts.** The install snippets follow the documentation linked below. The automated tests use the MCP client SDK over stdio and in memory. Claude Code, Claude Desktop, and VS Code were not run from this repository.
- **No HTTP transport, no authentication, no write operations.** These are out of scope.
- **Only put repositories you trust under the roots.** Git honours repository-local configuration, and some settings run programs: `core.fsmonitor`, for example, makes `git status` start a command named in `.git/config`. A repository from an untrusted source could use that to run code when a tool reads it. Modern git's `safe.directory` ownership check refuses repositories owned by another user, which helps, but it does not cover a repository you cloned or copied yourself.
- **The gitleaks history scan runs on the Linux CI leg only.** The Windows leg runs the same build and tests and the secretlint working-tree scan.

## Possible next steps

- Streamable HTTP transport with an explicit auth story, if the server ever needs to run away from the local machine.
- A `repo_diff` tool between two refs, with ref validation against a strict pattern.
- Per-tool timeouts and progress for very large histories.

## Docs cited

- MCP specification, revision 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28
- MCP TypeScript SDK (v2): https://github.com/modelcontextprotocol/typescript-sdk and https://ts.sdk.modelcontextprotocol.io/v2/
- Tools and `registerTool`: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md
- stdio server (`serveStdio`): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md
- Client: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-client.md
- Testing: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md
- Errors (`isError` vs protocol errors): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/errors.md
- Protocol eras: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md
- Host configuration: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/real-host.md
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Desktop local servers: https://modelcontextprotocol.io/docs/develop/connect-local-servers

## License

MIT. Copyright (c) 2026 DC TECH INC. See [LICENSE](LICENSE).
