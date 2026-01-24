import { NextResponse } from "next/server";
import { buildJourneyStateBlock } from "../../../src/lib/server/contextBuilder";

type DreamExtractRequest = {
  nodeId: string;
  threadId: string;
  messageId: string;
  dreamText: string;
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
  relevantNextNodes?: {
    id: string;
    title: string;
    promptTemplate?: string;
    domain?: string;
    tags?: string[];
  }[];
  apiKey?: string;
  model?: string;
};

type DreamExtraction = {
  scenes: { idx: number; summary: string; emotions: string[] }[];
  symbols: {
    label: string;
    category?: string;
    contextSnippet: string;
    emotionTags?: string[];
    suggestedMeaning?: string;
  }[];
  hypotheses: string[];
  question: string;
};

function safeParseExtraction(text: string): DreamExtraction | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      symbols: Array.isArray(parsed.symbols) ? parsed.symbols : [],
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [],
      question: String(parsed.question ?? "").trim(),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const payload = (await request.json()) as DreamExtractRequest;

  if (!payload?.nodeId || !payload?.threadId || !payload?.messageId || !payload?.dreamText) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const apiKey =
    payload.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OpenAI API key." }, { status: 400 });
  }

  const journeyState = buildJourneyStateBlock({
    nodeId: payload.nodeId,
    nodeTitle: payload.nodeTitle,
    status: payload.status ?? null,
    currentNodeId: payload.settings?.currentNodeId ?? null,
    currentSpiralOrder: payload.settings?.currentSpiralOrder ?? null,
  });

  const nextNodesText = (payload.relevantNextNodes ?? [])
    .map((node, index) => {
      const tags = node.tags?.length ? `tags: ${node.tags.join(", ")}` : "tags: none";
      const domain = node.domain ? `domain: ${node.domain}` : "domain: unknown";
      const template = node.promptTemplate ? `prompt: ${node.promptTemplate}` : "prompt: none";
      return `(${index + 1}) ${node.title} [${node.id}] ${domain} ${tags}\n${template}`;
    })
    .join("\n");

  const system = [
    "You extract structured dream symbols and scenes for a local-first journaling app.",
    "Use hypothesis language; avoid certainty claims or therapy tone.",
    "Prioritize personal meaning over archetypes.",
    "Return JSON only with keys: scenes, symbols, hypotheses, question.",
  ].join("\n");

  const user = [
    payload.promptTemplate?.trim() || "No prompt template provided.",
    "",
    journeyState,
    "",
    "Current next nodes (first is the primary next node if available):",
    nextNodesText || "None provided.",
    "",
    "Dream text:",
    payload.dreamText,
    "",
    "Output requirements:",
    "- scenes: list with idx (1..n), summary, emotions[]",
    "- symbols: list with label, category (if any), contextSnippet, emotionTags[], suggestedMeaning (optional)",
    "- hypotheses: 3-6 bullets that explicitly reference the next node title and include 1-2 lines on relevance (hypothesis language)",
    "- question: exactly one clarifying question to refine personal symbol meanings",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: payload.model ?? "gpt-5-nano",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const errorMessage = errorPayload?.error?.message ?? "Dream extraction request failed.";
    return NextResponse.json({ error: errorMessage }, { status: response.status });
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseExtraction(text);
  if (!parsed) {
    return NextResponse.json({ error: "Failed to parse dream extraction." }, { status: 500 });
  }

  return NextResponse.json({ extraction: parsed });
}
