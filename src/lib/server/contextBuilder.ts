import type {
  AppSettings,
  ComputedNodeStatus,
  MessageRole,
  NodeDefinition,
  ThreadSummary,
} from "../../../types";

export type ChatHistoryItem = {
  role: MessageRole;
  content: string;
};

export type BuildChatContextInput = {
  nodeId: string;
  threadId: string;
  userMessage: string;
  mode?: "chat" | "dream";
  node?: Pick<NodeDefinition, "id" | "title" | "prompt_template" | "domain" | "tags">;
  status?: ComputedNodeStatus | null;
  settings?: Pick<AppSettings, "currentNodeId" | "currentSpiralOrder"> | null;
  threadSummary?: ThreadSummary | null;
  history?: ChatHistoryItem[];
  maxHistoryMessages?: number;
};

export type BuiltChatContext = {
  systemPrompt: string;
  assistantSummary?: string;
  history: ChatHistoryItem[];
  userMessage: string;
};

function formatList(items: string[]) {
  if (!items.length) return "None";
  return items.join(", ");
}

export function buildJourneyStateBlock(input: {
  nodeId: string;
  nodeTitle?: string;
  status?: ComputedNodeStatus | null;
  currentNodeId?: string | null;
  currentSpiralOrder?: number | null;
}) {
  const unmet = input.status?.unmetDependencies ?? [];
  return [
    "Journey state:",
    `- nodeId: ${input.nodeId}`,
    `- nodeTitle: ${input.nodeTitle ?? "Unknown"}`,
    `- status: ${input.status?.status ?? "unknown"}`,
    `- unmetDependencies: ${formatList(unmet)}`,
    `- currentNodeId: ${input.currentNodeId ?? "unknown"}`,
    `- currentSpiralOrder: ${input.currentSpiralOrder ?? "unknown"}`,
  ].join("\n");
}

function buildSummaryBlock(summary: ThreadSummary) {
  const motifs = summary.keyMotifs?.length ? `Key motifs: ${summary.keyMotifs.join(", ")}` : "";
  return [
    "Thread summary (approximate; prioritize recent messages for specifics):",
    summary.summary.trim(),
    motifs,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChatContext(input: BuildChatContextInput): BuiltChatContext {
  const maxHistoryMessages = input.maxHistoryMessages ?? 20;
  const history = (input.history ?? [])
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-maxHistoryMessages);

  const promptTemplate = input.node?.prompt_template?.trim() || "You are a helpful assistant.";
  const journeyState = buildJourneyStateBlock({
    nodeId: input.nodeId,
    nodeTitle: input.node?.title,
    status: input.status ?? null,
    currentNodeId: input.settings?.currentNodeId ?? null,
    currentSpiralOrder: input.settings?.currentSpiralOrder ?? null,
  });

  const summaryGuidance = [
    "Summary usage:",
    "- Treat the summary as a compact, possibly incomplete snapshot.",
    "- Use it to maintain continuity, but rely on the latest messages for detail.",
    "- Use hypothesis language and avoid certainty claims.",
  ].join("\n");

  const modeLine = `Conversation mode: ${input.mode ?? "chat"}`;

  const systemPrompt = [promptTemplate, "", journeyState, "", summaryGuidance, "", modeLine].join(
    "\n"
  );

  const assistantSummary = input.threadSummary?.summary
    ? buildSummaryBlock(input.threadSummary)
    : undefined;

  return {
    systemPrompt,
    assistantSummary,
    history,
    userMessage: input.userMessage,
  };
}
