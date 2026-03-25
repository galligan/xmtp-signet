import { z } from "zod";
import { ContentTypeId } from "./content-types.js";

/** Zod schema for an agent session's projected conversation view mode. */
export const ViewMode: z.ZodEnum<
  ["full", "thread-only", "redacted", "reveal-only"]
> = z
  .enum(["full", "thread-only", "redacted", "reveal-only"])
  .describe("Visibility mode for the agent's view of conversations");

/** Visibility mode for an agent session's projected conversation view. */
export type ViewMode = z.infer<typeof ViewMode>;

/** Allowed content types in a session view. */
export type ContentTypeAllowlist = string[];

/** Zod schema for the allowlist of visible content types. */
export const ContentTypeAllowlist: z.ZodType<ContentTypeAllowlist> = z
  .array(ContentTypeId)
  .min(1)
  .describe("Content types the agent is allowed to see");

/** Scope for a single group and optional thread within a view. */
export type ThreadScope = {
  groupId: string;
  threadId: string | null;
};

/** Zod schema for a single group/thread scope. */
export const ThreadScope: z.ZodType<ThreadScope> = z
  .object({
    groupId: z.string().describe("Group the thread belongs to"),
    threadId: z
      .string()
      .nullable()
      .describe("Specific thread ID, or null for entire group"),
  })
  .describe("Scopes a view to a specific group and optional thread");

/** Complete view configuration for an agent session. */
export type ViewConfig = {
  mode: ViewMode;
  threadScopes: ThreadScope[];
  contentTypes: ContentTypeAllowlist;
};

/** Zod schema for a complete agent view configuration. */
export const ViewConfig: z.ZodType<ViewConfig> = z
  .object({
    mode: ViewMode.describe("Base visibility mode"),
    threadScopes: z
      .array(ThreadScope)
      .min(1)
      .describe("Groups and threads this view covers"),
    contentTypes: ContentTypeAllowlist.describe(
      "Allowed content types for this view",
    ),
  })
  .describe("Complete view configuration for an agent session");
