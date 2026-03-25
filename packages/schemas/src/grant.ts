import { z } from "zod";

/** Permissions for sending, replying, and reacting in a conversation. */
export type MessagingGrant = {
  send: boolean;
  reply: boolean;
  react: boolean;
  draftOnly: boolean;
};

/** Zod schema for messaging permissions. */
export const MessagingGrant: z.ZodType<MessagingGrant> = z
  .object({
    send: z.boolean().describe("Can send messages"),
    reply: z.boolean().describe("Can reply in threads"),
    react: z.boolean().describe("Can add/remove reactions"),
    draftOnly: z
      .boolean()
      .describe("Messages require owner confirmation before sending"),
  })
  .describe("Messaging action permissions");

/** Permissions for group membership and metadata management. */
export type GroupManagementGrant = {
  addMembers: boolean;
  removeMembers: boolean;
  updateMetadata: boolean;
  inviteUsers: boolean;
};

/** Zod schema for group management permissions. */
export const GroupManagementGrant: z.ZodType<GroupManagementGrant> = z
  .object({
    addMembers: z.boolean().describe("Can add members to the group"),
    removeMembers: z.boolean().describe("Can remove members from the group"),
    updateMetadata: z.boolean().describe("Can update group metadata"),
    inviteUsers: z.boolean().describe("Can issue invitations"),
  })
  .describe("Group management permissions");

/** Permission scope for a single tool invocation surface. */
export type ToolScope = {
  toolId: string;
  allowed: boolean;
  parameters: Record<string, unknown> | null;
};

/** Zod schema for a single tool permission scope. */
export const ToolScope: z.ZodType<ToolScope> = z
  .object({
    toolId: z.string().describe("Identifier for the tool"),
    allowed: z.boolean().describe("Whether this tool is currently allowed"),
    parameters: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe("Permitted parameter constraints, null for unconstrained"),
  })
  .describe("Permission scope for a single tool");

/** Tool-level grant made up of one or more scoped tool permissions. */
export type ToolGrant = {
  scopes: ToolScope[];
};

/** Zod schema for tool capability permissions. */
export const ToolGrant: z.ZodType<ToolGrant> = z
  .object({
    scopes: z.array(ToolScope).describe("Per-tool permission scopes"),
  })
  .describe("Tool capability permissions");

/** Permissions governing what content may leave the signet boundary. */
export type EgressGrant = {
  storeExcerpts: boolean;
  useForMemory: boolean;
  forwardToProviders: boolean;
  quoteRevealed: boolean;
  summarize: boolean;
};

/** Zod schema for content egress permissions. */
export const EgressGrant: z.ZodType<EgressGrant> = z
  .object({
    storeExcerpts: z.boolean().describe("Can store message excerpts"),
    useForMemory: z.boolean().describe("Can use content for persistent memory"),
    forwardToProviders: z
      .boolean()
      .describe("Can forward content to inference providers"),
    quoteRevealed: z
      .boolean()
      .describe("Can quote revealed content in messages"),
    summarize: z.boolean().describe("Can summarize hidden or revealed content"),
  })
  .describe("Retention and egress permissions");

/** Complete grant configuration for an agent session. */
export type GrantConfig = {
  messaging: MessagingGrant;
  groupManagement: GroupManagementGrant;
  tools: ToolGrant;
  egress: EgressGrant;
};

/** Zod schema for a complete grant configuration. */
export const GrantConfig: z.ZodType<GrantConfig> = z
  .object({
    messaging: MessagingGrant.describe("Messaging action permissions"),
    groupManagement: GroupManagementGrant.describe(
      "Group management permissions",
    ),
    tools: ToolGrant.describe("Tool capability permissions"),
    egress: EgressGrant.describe("Retention and egress permissions"),
  })
  .describe("Complete grant configuration for an agent session");
