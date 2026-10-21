import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Config } from "./config.js";
import { resolveRepo } from "./repo.js";
import { hotspotsTool } from "./tools/hotspots.js";
import { hygieneTool } from "./tools/hygiene.js";
import { recentActivityTool } from "./tools/recent-activity.js";
import { repoSummaryTool } from "./tools/repo-summary.js";
import { staleBranchesTool } from "./tools/stale-branches.js";
import type { ToolDefinition } from "./tools/types.js";

type PathShape = z.ZodRawShape & { path: z.ZodString };

export const SERVER_NAME = "mcp-repo-health";
export const SERVER_VERSION = "0.1.0";

/**
 * Registers one tool. Every call first validates `path` (inside a root, a
 * directory, a git work tree) so no tool handler sees an unchecked location.
 * Thrown `ToolError`s become `isError: true` results via the SDK.
 */
function register<I extends PathShape, O extends z.ZodType>(
  server: McpServer,
  config: Config,
  tool: ToolDefinition<I, O>,
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: z.object(tool.inputShape),
      outputSchema: tool.outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs) => {
      const args = rawArgs as unknown as z.infer<z.ZodObject<I>> & { path: string };
      const dir = await resolveRepo(config, args.path);
      const output = await tool.run(dir, args);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}

export function createServer(config: Config): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  register(server, config, repoSummaryTool);
  register(server, config, recentActivityTool);
  register(server, config, hotspotsTool);
  register(server, config, hygieneTool);
  register(server, config, staleBranchesTool);
  return server;
}
