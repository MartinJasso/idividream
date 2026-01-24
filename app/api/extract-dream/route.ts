import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import type { NodesFile } from "../../../types";

type ExtractDreamRequest = {
  nodeId: string;
  threadId: string;
  messageId: string;
  dreamText: string;
  nodeTitle?: string;
  nodePromptTemplate?: string;
  nextNode?: { id: string; title: string; promptTemplate?: string } | null;
  personalSymbolMeanings?: {
    symbolId: string;
    label: string;
    personalMeaning: string;
    valence?: number;
    confidence?: number;
  }[];
  apiKey?: string;
  model?: string;
};

type NodeSnapshot = {
  id: string;
  title: string;
  prompt_template: string;
};

async function loadNodes(): Promise<NodesFile | null> {
  try {
    const raw = await readFile("public/nodes.json", "utf-8");
    return JSON.parse(raw) as NodesFile;
  } catch {
    return null;
  }
}

async function getNodeSnapshot(nodeId: string): Promise<NodeSnapshot | null> {
  const data = await loadNodes();
  const node = data?.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  return { id: node.id, title: node.title, prompt_template: node.prompt_template };
}

function compactTemplate(template?: string) {
  if (!template) return "None";
  return template.replace(/\s+/g, " ").trim().slice(0, 600);
}

function formatPersonalMeanings(meanings?: ExtractDreamRequest["personalSymbolMeanings"]) {
  if (!meanings || meanings.length === 0) return "None provided.";
  return meanings
    .map((item) => {
      const valence =
        typeof item.valence === "number" ? ` (valence ${item.valence})` : "";
      const confidence =
        typeof item.confidence === "number" ? ` (confidence ${item.confidence})` : "";
      return `- ${item.label}${valence}${confidence}: ${item.personalMeaning}`;
    })
    .join("\n");
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ExtractDreamRequest;

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

  const nodeSnapshot = await getNodeSnapshot(payload.nodeId);
  const currentTitle = payload.nodeTitle ?? nodeSnapshot?.title ?? "Unknown";
  const currentPrompt = payload.nodePromptTemplate ?? nodeSnapshot?.prompt_template ?? "";

  const nextNodeTitle = payload.nextNode?.title ?? null;
  const nextNodeId = payload.nextNode?.id ?? null;
  const nextNodePrompt = payload.nextNode?.promptTemplate ?? "";

  const system = [
    "You extract dream scenes, symbols, and practical relevance to the user's next journey step.",
    "Rules:",
    "- Use hypothesis language (no certainty).",
    "- Prioritize PERSONAL symbol meanings when provided.",
    "- If a symbol meaning is unknown, list 2–3 plausible meanings but do not decide.",
    "- Ask exactly ONE clarifying question at the end.",
    "- Avoid therapy tone; keep it practical and grounded.",
    "Output JSON only, matching the required schema.",
  ].join("\n");

  const user = [
    "Dream text:",
    payload.dreamText,
    "",
    "Current node:",
    `- id: ${payload.nodeId}`,
    `- title: ${currentTitle}`,
    `- prompt focus: ${compactTemplate(currentPrompt)}`,
    "",
    "Next node:",
    `- id: ${nextNodeId ?? "None"}`,
    `- title: ${nextNodeTitle ?? "None"}`,
    `- prompt focus: ${compactTemplate(nextNodePrompt)}`,
    "",
    "Personal symbol meanings (if provided):",
    formatPersonalMeanings(payload.personalSymbolMeanings),
    "",
    "Return JSON with this exact shape:",
    `{
  "scenes": [{ "idx": number, "summary": string, "emotions": string[] }],
  "symbols": [{
    "label": string,
    "category": "place"|"object"|"person"|"animal"|"action"|"emotion"|"other",
    "contextSnippet": string,
    "emotionTags": string[]
  }],
  "relevance": {
    "nextNodeId": string | null,
    "nextNodeTitle": string | null,
    "hypotheses": string[]
  },
  "clarifyingQuestion": string
}`,
    "Ensure hypotheses is 3–6 bullets, and only one clarifying question.",
  ].join("\n");

  const body = {
    model: payload.model ?? "gpt-5-nano",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

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
  const content = data?.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: "Failed to parse extraction response." }, { status: 500 });
  }
}
