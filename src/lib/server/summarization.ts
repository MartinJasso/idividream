import type { MessageRole, ThreadSummary } from "../../../types";
import { buildJourneyStateBlock } from "./contextBuilder";

export type SummaryHistoryItem = {
  role: MessageRole;
  content: string;
};

export type SummarizeInput = {
  nodeId: string;
  nodeTitle?: string;
  promptTemplate?: string;
  statusLabel?: string;
  unmetDependencies?: string[];
  currentNodeId?: string | null;
  currentSpiralOrder?: number | null;
  existingSummary?: ThreadSummary | null;
  messages: SummaryHistoryItem[];
};

export type SummarizeResult = {
  summary: string;
  keyMotifs: string[];
};

const SAFE_TOKEN_THRESHOLD = 3200;

export function estimateTokens(messages: SummaryHistoryItem[]) {
  const text = messages.map((message) => message.content).join("\n");
  return Math.ceil(text.length / 4);
}

export function shouldSummarize(messages: SummaryHistoryItem[]) {
  return messages.length > 40 || estimateTokens(messages) > SAFE_TOKEN_THRESHOLD;
}

function formatMessages(messages: SummaryHistoryItem[]) {
  return messages
    .map((message, index) => `[${index + 1}] ${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}

export function buildSummarizePrompt(input: SummarizeInput) {
  const journeyState = buildJourneyStateBlock({
    nodeId: input.nodeId,
    nodeTitle: input.nodeTitle,
    status: input.statusLabel
      ? { nodeId: input.nodeId, status: input.statusLabel as "locked" | "available" | "next" | "completed", unmetDependencies: input.unmetDependencies }
      : null,
    currentNodeId: input.currentNodeId ?? null,
    currentSpiralOrder: input.currentSpiralOrder ?? null,
  });

  const system = [
    "You summarize chat threads for future context building.",
    "Preserve actionable decisions, recurring motifs, personal symbol meanings, and commitments.",
    "Avoid therapy tone; use hypothesis language and uncertainty where appropriate.",
    "Keep the summary under ~700 words.",
    "Return JSON only with keys: summary (string), keyMotifs (array of 5-12 short phrases).",
  ].join("\n");

  const user = [
    "Context:",
    input.promptTemplate?.trim() || "No prompt template provided.",
    "",
    journeyState,
    "",
    input.existingSummary?.summary
      ? `Existing summary:\n${input.existingSummary.summary}`
      : "Existing summary: None",
    input.existingSummary?.keyMotifs?.length
      ? `Existing key motifs: ${input.existingSummary.keyMotifs.join(", ")}`
      : "Existing key motifs: None",
    "",
    "Messages to summarize:",
    formatMessages(input.messages),
  ].join("\n");

  return { system, user };
}

export function normalizeSummaryResult(result: SummarizeResult) {
  const summary = result.summary?.trim() || "No summary returned.";
  const keyMotifs = Array.isArray(result.keyMotifs)
    ? result.keyMotifs.map((motif) => motif.trim()).filter(Boolean).slice(0, 12)
    : [];
  return { summary, keyMotifs };
}

export function safeParseSummary(text: string): SummarizeResult | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      summary: String((parsed as SummarizeResult).summary ?? "").trim(),
      keyMotifs: Array.isArray((parsed as SummarizeResult).keyMotifs)
        ? (parsed as SummarizeResult).keyMotifs.map((item) => String(item))
        : [],
    };
  } catch {
    return null;
  }
}
