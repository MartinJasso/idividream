import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequest = {
  nodeId: string;
  threadId: string;
  userMessage: string;
  nodeTitle?: string;
  promptTemplate?: string;
  status?: string;
  unmetDependencies?: string[];
  currentNodeId?: string | null;
  currentSpiralOrder?: number | null;
  history?: ChatHistoryItem[];
  apiKey?: string;
  model?: string;
};

function buildStateBlock(payload: ChatRequest) {
  const unmet = payload.unmetDependencies?.length
    ? payload.unmetDependencies.join(", ")
    : "None";
  return [
    "Current state:",
    `- nodeId: ${payload.nodeId}`,
    `- nodeTitle: ${payload.nodeTitle ?? "Unknown"}`,
    `- status: ${payload.status ?? "unknown"}`,
    `- unmetDependencies: ${unmet}`,
    `- currentNodeId: ${payload.currentNodeId ?? "unknown"}`,
    `- currentSpiralOrder: ${payload.currentSpiralOrder ?? "unknown"}`,
  ].join("\n");
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest;
  const headerKey = request.headers.get("x-openai-api-key")?.trim();

  if (!payload?.nodeId || !payload?.threadId || !payload?.userMessage) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const apiKey = [
    payload.apiKey?.trim(),
    headerKey,
    process.env.OPENAI_API_KEY?.trim(),
    process.env.NEXT_PUBLIC_OPENAI_API_KEY?.trim(),
  ].find((value) => value);
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Missing OpenAI API key. Provide openAiApiKey in local settings or set OPENAI_API_KEY / NEXT_PUBLIC_OPENAI_API_KEY.",
      },
      { status: 400 }
    );
  }

  const systemPrompt = [
    payload.promptTemplate?.trim() || "You are a helpful assistant.",
    "",
    buildStateBlock(payload),
  ].join("\n");

  const history = (payload.history ?? []).filter((item) =>
    item.role === "user" || item.role === "assistant"
  );

  const model = (payload.model ?? "gpt-5-nano").trim() || "gpt-5-nano";
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: payload.userMessage },
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
  const assistant = data?.choices?.[0]?.message?.content ?? "";

  return NextResponse.json({ assistant });
}
