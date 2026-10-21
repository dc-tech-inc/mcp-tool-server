import type * as z from "zod/v4";

/**
 * One tool: a fixed name and description, a zod input shape, a zod output
 * schema, and a handler that receives an already-validated repository directory.
 */
export interface ToolDefinition<I extends z.ZodRawShape, O extends z.ZodType> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputShape: I;
  readonly outputSchema: O;
  readonly run: (repoDir: string, args: z.infer<z.ZodObject<I>>) => Promise<z.infer<O>>;
}

export function defineTool<I extends z.ZodRawShape, O extends z.ZodType>(
  tool: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return tool;
}
