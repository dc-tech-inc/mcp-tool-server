/**
 * An expected, user-facing failure (bad path, not a repo, git timeout).
 * The MCP SDK turns any thrown error into an `isError: true` tool result;
 * this class exists so the message is intentional and readable.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
