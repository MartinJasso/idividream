import { NextResponse } from "next/server";
import {
  buildSummarizePrompt,
  normalizeSummaryResult,
  safeParseSummary,
} from "../../../src/lib/server/summarization";
import type { ThreadSummary } from "../../../types";

type SummarizeRequest = {
  threadId: string;
  nodeId: string;
  nodeTitle?: string;
  promptTemplate?: string;
  status?: {
    status: "locked" | "available" | "next" | "completed";
    unmetDependencies?: string[];
  };
  settings?: {
    currentNodeId?: string | null;
    currentSpiralOrder?: number | null;
  };
  history?: { role: "user" | "assistant"; content: string }[];
  existingSummary?: ThreadSummary | null;
  apiKey?: string;
  model?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as SummarizeRequest;

  if (!payload?.threadId || !payload?.nodeId) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  if (!payload.history || payload.history.length === 0) {
    return NextResponse.json({ error: "No messages provided for summarization." }, { status: 400 });
  }

  const apiKey =
    payload.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OpenAI API key." }, { status: 400 });
  }

  const prompt = buildSummarizePrompt({
    nodeId: payload.nodeId,
    nodeTitle: payload.nodeTitle,
    promptTemplate: payload.promptTemplate,
    statusLabel: payload.status?.status,
    unmetDependencies: payload.status?.unmetDependencies,
    currentNodeId: payload.settings?.currentNodeId ?? null,
    currentSpiralOrder: payload.settings?.currentSpiralOrder ?? null,
    existingSummary: payload.existingSummary ?? null,
    messages: payload.history,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: payload.model ?? "gpt-5-nano",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const errorMessage = errorPayload?.error?.message ?? "Summarization request failed.";
    return NextResponse.json({ error: errorMessage }, { status: response.status });
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseSummary(text);
  const normalized = parsed ? normalizeSummaryResult(parsed) : null;
  if (!normalized) {
    return NextResponse.json({ error: "Failed to parse summary response." }, { status: 500 });
  }

  const summary: ThreadSummary = {
    threadId: payload.threadId,
    summary: normalized.summary,
    keyMotifs: normalized.keyMotifs,
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json({ threadSummary: summary });
}
