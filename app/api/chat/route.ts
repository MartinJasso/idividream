import { NextResponse } from "next/server";
import {
  buildChatContext,
  type ChatHistoryItem,
} from "../../../src/lib/server/contextBuilder";
import {
  buildSummarizePrompt,
  normalizeSummaryResult,
  safeParseSummary,
  shouldSummarize,
} from "../../../src/lib/server/summarization";
import type { ThreadSummary } from "../../../types";

type ChatRequest = {
  nodeId: string;
  threadId: string;
  userMessage: string;
  mode?: "chat" | "dream";
  node?: {
    id: string;
    title: string;
    prompt_template: string;
    domain?: string;
    tags?: string[];
  };
  status?: {
    status: "locked" | "available" | "next" | "completed";
    unmetDependencies?: string[];
  };
  settings?: {
    currentNodeId?: string | null;
    currentSpiralOrder?: number | null;
  };
  threadSummary?: ThreadSummary | null;
  history?: ChatHistoryItem[];
  apiKey?: string;
  model?: string;
  modelSummarize?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest;

  if (!payload?.nodeId || !payload?.threadId || !payload?.userMessage) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const apiKey =
    payload.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OpenAI API key." }, { status: 400 });
  }

  const context = buildChatContext({
    nodeId: payload.nodeId,
    threadId: payload.threadId,
    userMessage: payload.userMessage,
    mode: payload.mode ?? "chat",
    node: payload.node,
    status: payload.status ?? null,
    settings: payload.settings ?? null,
    threadSummary: payload.threadSummary ?? null,
    history: payload.history ?? [],
  });

  const body = {
    model: payload.model ?? "gpt-5-nano",
    messages: [
      { role: "system", content: context.systemPrompt },
      ...(context.assistantSummary
        ? [{ role: "assistant", content: context.assistantSummary }]
        : []),
      ...context.history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: context.userMessage },
    ],
  };

  let updatedSummary: ThreadSummary | null = null;
  const history = payload.history ?? [];
  if (shouldSummarize(history)) {
    const keepCount = 20;
    const olderMessages = history.slice(0, Math.max(0, history.length - keepCount));
    if (olderMessages.length > 0) {
      const prompt = buildSummarizePrompt({
        nodeId: payload.nodeId,
        nodeTitle: payload.node?.title,
        promptTemplate: payload.node?.prompt_template,
        statusLabel: payload.status?.status,
        unmetDependencies: payload.status?.unmetDependencies,
        currentNodeId: payload.settings?.currentNodeId ?? null,
        currentSpiralOrder: payload.settings?.currentSpiralOrder ?? null,
        existingSummary: payload.threadSummary ?? null,
        messages: olderMessages,
      });

      const summarizeResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: payload.modelSummarize ?? payload.model ?? "gpt-5-nano",
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
      });

      if (summarizeResponse.ok) {
        const summarizeData = await summarizeResponse.json();
        const summarizeText = summarizeData?.choices?.[0]?.message?.content ?? "";
        const parsed = safeParseSummary(summarizeText);
        const normalized = parsed ? normalizeSummaryResult(parsed) : null;
        if (normalized) {
          updatedSummary = {
            threadId: payload.threadId,
            summary: normalized.summary,
            keyMotifs: normalized.keyMotifs,
            updatedAt: new Date().toISOString(),
          };
        }
      }
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const errorMessage = errorPayload?.error?.message ?? "OpenAI request failed.";
    return NextResponse.json({ error: errorMessage }, { status: response.status });
  }

  const data = await response.json();
  const assistant = data?.choices?.[0]?.message?.content ?? "";

  return NextResponse.json({ assistant, threadSummary: updatedSummary });
}
