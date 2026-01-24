import type { ThreadSummary } from "../../../types";
import type { ChatHistoryItem } from "./contextBuilder";

export type SummarizeInput = {
  nodeTitle?: string;
  promptTemplate?: string;
  status?: "locked" | "available" | "next" | "completed" | "unknown";
  unmetDependencies?: string[];
  currentNodeId?: string | null;
  currentSpiralOrder?: number | null;
  nextNode?: { id: string; title: string } | null;
  existingSummary?: ThreadSummary | null;
  history: ChatHistoryItem[];
};

function formatList(items: string[] | undefined) {
  if (!items || items.length === 0) return "None";
  return items.join(", ");
}

function buildJourneyStateBlock(input: SummarizeInput) {
  return [
    "Journey State:",
    `- nodeTitle: ${input.nodeTitle ?? "Unknown"}`,
    `- status: ${input.status ?? "unknown"}`,
    `- unmetDependencies: ${formatList(input.unmetDependencies)}`,
    `- currentNodeId: ${input.currentNodeId ?? "unknown"}`,
    `- currentSpiralOrder: ${input.currentSpiralOrder ?? "unknown"}`,
    `- nextNodeId: ${input.nextNode?.id ?? "unknown"}`,
    `- nextNodeTitle: ${input.nextNode?.title ?? "unknown"}`,
  ].join("\n");
}

export function buildSummarizePrompt(input: SummarizeInput) {
  const system = [
    "You summarize chat threads for future context building.",
    "Preserve decisions, commitments, constraints, recurring motifs, and personal symbol meanings discovered.",
    "Use hypothesis language; avoid therapy tone.",
    "Keep the summary concise (<= ~700 words).",
    "Return JSON only with keys: summary (string) and keyMotifs (array of 5-12 short phrases).",
  ].join("\n");

  const user = [
    input.promptTemplate?.trim() || "No prompt template provided.",
    "",
    buildJourneyStateBlock(input),
    "",
    input.existingSummary?.summary
      ? `Existing summary:\n${input.existingSummary.summary}`
      : "Existing summary: None",
    input.existingSummary?.keyMotifs?.length
      ? `Existing key motifs: ${input.existingSummary.keyMotifs.join(", ")}`
      : "Existing key motifs: None",
    "",
    "Messages:",
    input.history
      .map((message, index) => `[${index + 1}] ${message.role.toUpperCase()}: ${message.content}`)
      .join("\n"),
  ].join("\n");

  return { system, user };
}

export function parseSummaryResponse(text: string) {
  try {
    const parsed = JSON.parse(text) as { summary?: string; keyMotifs?: string[] };
    if (!parsed || typeof parsed !== "object") return null;
    const summary = String(parsed.summary ?? "").trim();
    const keyMotifs = Array.isArray(parsed.keyMotifs)
      ? parsed.keyMotifs.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
      : [];
    return { summary, keyMotifs };
  } catch {
    return null;
  }
}
