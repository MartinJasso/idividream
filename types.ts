// types.ts
// Shared types for the local-first individuation app.
// Keep this file aligned with nodes.schema.json.

export type NodeType = "spiral" | "tree" | "hybrid";

export type NodePhase =
  | "ego"
  | "persona"
  | "shadow"
  | "inner_other"
  | "disintegration"
  | "recenter"
  | "integration"
  | "reentry"
  | "domain"
  | "meta";

export type NodeDomain = "meta" | "inner" | "work" | "relationships" | "meaning" | "body";

export interface SpiralPosition {
  theta: number;
  radius: number;
  order: number;
}

export interface TreePosition {
  x: number;
  y: number;
  branch: string;
  level: number;
  parent_id: string | null;
}

export interface UIPosition {
  spiral?: SpiralPosition;
  tree?: TreePosition;
}

export interface NodeDefinition {
  id: string;
  title: string;
  type: NodeType;
  phase: NodePhase;
  domain: NodeDomain;
  description: string;
  dependencies: string[];
  tags: string[];
  prompt_template: string;
  ui_position: UIPosition;
  version: number;

  personalization_prompts?: string[];
  symbol_focus?: string[];
}

export interface NodesFile {
  schema_version: number;
  generated_at?: string;
  nodes: NodeDefinition[];
}

export interface UserNodeState {
  nodeId: string;                // same as NodeDefinition.id
  completedAt?: string | null;   // ISO datetime
  progressNotes?: string;
  personalizedSummary?: string;
  commitments?: Record<string, unknown>;
  updatedAt: string;             // ISO datetime
}

// Chat layer
export interface Thread {
  id: string;        // uuid
  nodeId: string;    // NodeDefinition.id
  title: string;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;         // uuid
  threadId: string;   // Thread.id
  role: MessageRole;
  content: string;
  createdAt: string;  // ISO datetime
  metadata?: Record<string, unknown>;
}

export interface ThreadSummary {
  threadId: string;
  summary: string;
  keyMotifs: string[];
  updatedAt: string;
}

// Symbol library
export interface SymbolDef {
  id: string;            // stable id (slug)
  label: string;         // display label
  category?: string;     // place/object/person/animal/action/emotion/other
  globalNotes?: string;  // optional, brief
  createdAt: string;
}

export interface PersonalSymbolMeaning {
  symbolId: string;                 // SymbolDef.id
  personalMeaning: string;
  valence?: number;                 // -2..+2
  linkedDomains?: string[];         // tags/domains
  originMessageIds?: string[];      // evidence pointers
  confidence?: number;              // 0..1
  lastUpdated: string;              // ISO datetime
}

export interface SymbolOccurrence {
  id: string;          // uuid
  symbolId: string;    // SymbolDef.id
  messageId: string;   // Message.id
  nodeId: string;      // NodeDefinition.id (context)
  contextSnippet: string;
  emotionTags?: string[];
  createdAt: string;   // ISO datetime
}

// App settings (single-user local-first)
export interface AppSettings {
  key: string;                 // settings key (e.g. "global")
  currentNodeId?: string;      // where user "is" on the journey (optional)
  currentSpiralOrder?: number; // optional tracking
  openAiApiKey?: string;       // BYOK (store locally)
  modelChat?: string;          // e.g. "gpt-5-nano" (your chosen runtime model)
  modelExtract?: string;       // e.g. "gpt-5-nano" or a cheaper model later
  modelSummarize?: string;
  updatedAt: string;           // ISO datetime
}

// Computed UI status (not stored by default)
export type NodeStatus = "locked" | "available" | "next" | "completed";

export interface ComputedNodeStatus {
  nodeId: string;
  status: NodeStatus;
  unmetDependencies?: string[];
  recommendedReason?: string;
}
