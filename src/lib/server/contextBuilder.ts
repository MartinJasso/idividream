import { readFile } from "node:fs/promises";
import type { NodesFile, ThreadSummary } from "../../../types";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type BuildChatContextInput = {
  nodeId: string;
  threadId: string;
  userMessage: string;
  history?: ChatHistoryItem[];
  threadSummary?: ThreadSummary | null;
  status?: "locked" | "available" | "next" | "completed" | "unknown";
  unmetDependencies?: string[];
  currentNodeId?: string | null;
  currentSpiralOrder?: number | null;
  nextNode?: { id: string; title: string } | null;
};

type NodeSnapshot = {
  title: string;
  prompt_template: string;
  tags: string[];
};

async function getNodeSnapshot(nodeId: string): Promise<NodeSnapshot | null> {
  try {
    const raw = await readFile("public/nodes.json", "utf-8");
    const data = JSON.parse(raw) as NodesFile;
    const node = data.nodes.find((item) => item.id === nodeId);
    if (!node) return null;
    return { title: node.title, prompt_template: node.prompt_template, tags: node.tags ?? [] };
  } catch {
    return null;
  }
}

function formatList(items: string[] | undefined) {
  if (!items || items.length === 0) return "None";
  return items.join(", ");
}

function buildJourneyStateBlock(input: BuildChatContextInput, nodeTitle?: string) {
  return [
    "Journey State:",
    `- nodeId: ${input.nodeId}`,
    `- nodeTitle: ${nodeTitle ?? "Unknown"}`,
    `- status: ${input.status ?? "unknown"}`,
    `- unmetDependencies: ${formatList(input.unmetDependencies)}`,
    `- currentNodeId: ${input.currentNodeId ?? "unknown"}`,
    `- currentSpiralOrder: ${input.currentSpiralOrder ?? "unknown"}`,
    `- nextNodeId: ${input.nextNode?.id ?? "unknown"}`,
    `- nextNodeTitle: ${input.nextNode?.title ?? "unknown"}`,
  ].join("\n");
}

function buildThreadMemoryBlock(summary?: ThreadSummary | null) {
  if (!summary) {
    return "Thread Memory:\n- Summary: None\n- Key motifs: None";
  }
  const motifs = summary.keyMotifs?.length ? summary.keyMotifs.join(", ") : "None";
  return [
    "Thread Memory:",
    `- Summary: ${summary.summary}`,
    `- Key motifs: ${motifs}`,
  ].join("\n");
}

function buildRulesBlock() {
  return [
    "Rules:",
    "- Use hypothesis language; avoid certainty claims.",
    "- Prioritize personal symbol meanings over archetypes.",
    "- Ask at most one clarifying question if needed.",
  ].join("\n");
}

export async function buildChatContext(input: BuildChatContextInput) {
  const node = await getNodeSnapshot(input.nodeId);
  const promptTemplate = node?.prompt_template?.trim() || "You are a helpful assistant.";

  const system = [
    promptTemplate,
    "",
    buildJourneyStateBlock(input, node?.title),
    "",
    buildThreadMemoryBlock(input.threadSummary),
    "",
    buildRulesBlock(),
  ].join("\n");

  const history = (input.history ?? [])
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-20);

  return {
    system,
    messages: [...history, { role: "user", content: input.userMessage }],
  };
}
