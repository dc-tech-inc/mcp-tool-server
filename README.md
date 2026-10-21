# mcp-repo-health

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io/) server, written in TypeScript, that reports the health of local git repositories. It runs over stdio and exposes five tools.

## What it is

`mcp-repo-health` lets an MCP-capable AI assistant answer questions such as "how healthy is this repo?", "what changed recently?", or "which branches are stale?" by calling typed tools instead of running arbitrary shell commands. It is a reference implementation: the protocol plumbing, input validation, and tests are the point, and the five repo-health tools are a concrete domain to exercise them.

## Why it exists

Giving an assistant a shell is broad and hard to constrain. This server takes the opposite approach:

- Five fixed tools, each with a JSON input schema and a JSON output schema.
- Every path is checked against an allow-list of roots before any git command runs.
- Git is invoked with fixed arguments through `execFile`, never through a shell, and user input never becomes a git option.
- Every tool is annotated `readOnlyHint: true`. The server never writes, fetches, or touches the network.

## Tools

| Tool | Input | Output (`structuredContent`) |
|---|---|---|
| `repo_summary` | `path` | Branch, HEAD commit (sha, subject, author name, date), remotes with credentials removed, dirty and untracked file counts, ahead/behind against the upstream (`null` when no upstream), total commits on HEAD |
| `recent_activity` | `path`, `days` (1–365, default 30) | Window start, commit count, commits per author name, commits per day. Emails are not returned. |
| `change_hotspots` | `path`, `days` (1–365, default 30), `limit` (1–100, default 10) | Files ranked by number of commits, with lines added and deleted from `git log --numstat`. Binary files count as 0 lines. |
| `hygiene_check` | `path` | Seven checks (`readme`, `license`, `gitignore`, `ci_workflow`, `lockfile`, `no_env_file_tracked`, `no_large_tracked_files`), each with `passed` and `detail`, plus a `score` from 0 to 100 |
| `stale_branches` | `path`, `olderThanDays` (1–3650, default 90) | Local branches whose last commit (committer date) is at least that old, with `ageDays` and whether each is merged into HEAD. Nothing is deleted. |

Each tool also returns the same data as a JSON text block for clients that do not read `structuredContent`. Failures (bad path, not a git repository, git timeout) come back as `isError: true` with a plain message.

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
4. **No shell.** Git runs through `execFile("git", ["-C", dir, ...fixedArgs])` with a 10-second timeout and a 10 MB output cap. Only fixed flags are passed. The tools take no git refs or revisions as input.
5. **Credentials stripped.** Remote URLs of the form `scheme://user:password@host/...` are returned without the userinfo part.
6. **Logs on stderr.** stdout carries the protocol, so the server writes nothing else there.
7. **Read-only annotations.** All tools declare `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: false`.

This is a local, single-user tool. It has no authentication, because it listens on nothing: it speaks only over the stdio pipe that the host process starts.

## How to test

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test                 # build + vitest run
pnpm vitest run --coverage
pnpm secrets              # secretlint over the working tree
```

The test suite has three files:

- `test/tools.test.ts` calls every tool through an MCP client on an in-memory transport and checks exact counts against a scripted fixture repository.
- `test/safety.test.ts` covers path containment (outside path, junction escape, relative path, missing path, regular file), the non-repository case, schema rejection (out-of-range values, empty path), and credential stripping.
- `test/stdio.e2e.test.ts` spawns the built `dist/index.js` with `StdioClientTransport`, completes the real handshake, and calls a tool over the pipe.

Fixtures are created in the OS temp directory at test time. Each one is a fresh repository with scripted commits and backdated dates. Tests never read a real repository on the machine.

Measured with `vitest run --coverage` (v8 provider, `src/**` only) on the run recorded with this commit:

- 26 tests in 3 files, all passing
- Statements 90.65% (165/182), branches 68.53% (61/89), functions 89.36% (42/47), lines 91.66% (154/168)

`src/index.ts` shows 0% in this report because the stdio test runs it in a child process, which the in-process coverage collector does not see. The stdio test is the only test that covers it.

## Architecture notes

- `src/index.ts` is the CLI entry. It loads the roots, then calls `serveStdio` from `@modelcontextprotocol/server/stdio` with a server factory.
- `src/server.ts` is a factory, `createServer(config)`, which builds an `McpServer` and registers the five tools through one `register` helper. The helper runs the path check before every handler and maps the result to `content` plus `structuredContent`.
- `src/config.ts` parses roots and implements `resolveInsideRoots` (realpath, containment, directory check).
- `src/repo.ts` adds the git work-tree check on top of that.
- `src/git.ts` is the only place that spawns processes. It wraps `execFile` with the timeout, buffer limit, and error mapping, and strips credentials from URLs.
- `src/tools/*.ts` contains one module per tool. Each exports a `defineTool` object (name, title, description, zod input shape, zod output schema, handler). Handlers receive a validated directory and never see raw input paths.
- Input validation uses zod v4 (`import * as z from "zod/v4"`). The SDK rejects schema violations before a handler runs.

## Honest limitations

- **Local git only.** No GitHub or GitLab API calls. Remote URLs are reported from the local config only.
- **Large repositories can hit the 10-second git timeout.** The timeout is fixed in code; the tools return a clear error rather than partial data.
- **`recent_activity`, `change_hotspots`, and `stale_branches` look at HEAD or local branches only.** Remote-tracking branches and other refs are not counted.
- **`stale_branches` uses the committer date**, not the author date, and includes the checked-out branch when it is old enough.
- **Windows path handling is tested on one machine only.** The CI matrix runs Ubuntu and Windows, but the junction escape test is the most platform-specific part of the suite.
- **Client setup was not exercised against live hosts.** The install snippets follow the documentation linked below. The automated tests use the MCP client SDK over stdio and in memory. Claude Code, Claude Desktop, and VS Code were not run from this repository.
- **No HTTP transport, no authentication, no write operations.** These are out of scope.
- **Secret scan uses secretlint**, not gitleaks, because it is installable from npm without a separate binary.

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
