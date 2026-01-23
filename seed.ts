// seed.ts
// Loads static authored nodes.json into IndexedDB (Dexie) if not present.
// Designed for serverless/local-first usage.

import { db } from "./db";
import type { NodesFile, NodeDefinition, AppSettings, UserNodeState } from "./types";

function nowIso() {
  return new Date().toISOString();
}

function assertNodeBasics(n: any): n is NodeDefinition {
  if (!n || typeof n !== "object") return false;
  if (typeof n.id !== "string") return false;
  if (!Array.isArray(n.dependencies)) return false;
  if (!Array.isArray(n.tags)) return false;
  if (!n.ui_position || typeof n.ui_position !== "object") return false;
  return true;
}

/**
 * Seed NodeDefinitions from a URL (typically "/nodes.json").
 * - If nodeDefinitions table is empty, it bulkAdds nodes.
 * - If not empty, it does nothing unless force=true.
 */
export async function seedNodeDefinitionsFromUrl(
  url = "/nodes.json",
  opts: { force?: boolean } = {}
) {
  const { force = false } = opts;

  const existingCount = await db.nodeDefinitions.count();
  if (existingCount > 0 && !force) return { seeded: false, reason: "already_seeded" as const };

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch nodes from ${url}: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as NodesFile;
  if (!data?.nodes || !Array.isArray(data.nodes)) throw new Error("Invalid nodes.json: missing nodes array");

  // Light validation (full validation can be done offline with validate-nodes.ts)
  const bad = data.nodes.find((n) => !assertNodeBasics(n));
  if (bad) throw new Error(`Invalid node shape encountered during seeding (id: ${bad?.id ?? "unknown"})`);

  await db.transaction("rw", db.nodeDefinitions, async () => {
    await db.nodeDefinitions.clear();
    await db.nodeDefinitions.bulkAdd(data.nodes);
  });

  // Ensure a default settings row exists
  await upsertGlobalSettings({
    currentNodeId: data.nodes.find((n) => n.type === "spiral")?.id ?? "ego_formation",
    currentSpiralOrder: data.nodes.find((n) => n.id === "ego_formation")?.ui_position?.spiral?.order ?? 1,
  });

  // Ensure a UserNodeState row exists per node (for completion + personal notes).
  await ensureUserNodeStateRows();

  return { seeded: true, reason: "seeded" as const, count: data.nodes.length };
}

/**
 * Creates missing UserNodeState records for all nodes.
 * Completion is stored; lock/available/next is computed at runtime.
 */
export async function ensureUserNodeStateRows() {
  const nodes = await db.nodeDefinitions.toArray();
  const existing = await db.userNodeStates.toArray();
  const existingIds = new Set(existing.map((x) => x.nodeId));

  const toAdd: UserNodeState[] = [];
  for (const n of nodes) {
    if (!existingIds.has(n.id)) {
      toAdd.push({
        nodeId: n.id,
        completedAt: null,
        progressNotes: "",
        personalizedSummary: "",
        commitments: {},
        updatedAt: nowIso(),
      });
    }
  }
  if (toAdd.length) await db.userNodeStates.bulkAdd(toAdd);
}

/**
 * Upsert the global settings row.
 */
export async function upsertGlobalSettings(partial: Partial<AppSettings>) {
  const key = "global";
  const existing = await db.appSettings.get(key);
  const next: AppSettings = {
    key,
    currentNodeId: existing?.currentNodeId,
    currentSpiralOrder: existing?.currentSpiralOrder,
    openAiApiKey: existing?.openAiApiKey,
    modelChat: existing?.modelChat ?? "gpt-5.2-thinking",
    modelExtract: existing?.modelExtract ?? "gpt-5.2-thinking",
    modelSummarize: existing?.modelSummarize ?? "gpt-5.2-thinking",
    updatedAt: nowIso(),
    ...partial,
    key,
  };
  await db.appSettings.put(next);
  return next;
}
