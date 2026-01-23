// journey.ts
// Query helpers + computed node statuses + "next node" recommendation.
// Status is derived (completed/locked/available/next) from NodeDefinitions + UserNodeState.

import { db } from "./db";
import type {
  NodeDefinition,
  ComputedNodeStatus,
  NodeStatus,
  AppSettings,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

export async function getAllNodes(): Promise<NodeDefinition[]> {
  return db.nodeDefinitions.toArray();
}

export async function getNodeById(id: string): Promise<NodeDefinition | undefined> {
  return db.nodeDefinitions.get(id);
}

export async function getNodesByTag(tag: string): Promise<NodeDefinition[]> {
  // Dexie multiEntry index (*tags) enables this query.
  return db.nodeDefinitions.where("tags").equals(tag).toArray();
}

export async function getNodesByTags(tags: string[], limit = 20): Promise<NodeDefinition[]> {
  if (!tags.length) return [];
  // Simple union (dedupe). For MVP: fetch per tag; later: use compound query or better ranking.
  const results: NodeDefinition[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const r = await getNodesByTag(t);
    for (const n of r) {
      if (!seen.has(n.id)) {
        results.push(n);
        seen.add(n.id);
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

export async function getCompletedNodeIds(): Promise<Set<string>> {
  const rows = await db.userNodeStates.toArray();
  const completed = new Set<string>();
  for (const r of rows) {
    if (r.completedAt) completed.add(r.nodeId);
  }
  return completed;
}

export async function markNodeCompleted(nodeId: string, completed = true) {
  const row = await db.userNodeStates.get(nodeId);
  if (!row) throw new Error(`Missing UserNodeState for ${nodeId}`);
  await db.userNodeStates.put({
    ...row,
    completedAt: completed ? nowIso() : null,
    updatedAt: nowIso(),
  });
}

export async function getGlobalSettings(): Promise<AppSettings | undefined> {
  return db.appSettings.get("global");
}

export async function setCurrentNode(nodeId: string) {
  const s = await db.appSettings.get("global");
  await db.appSettings.put({
    key: "global",
    currentNodeId: nodeId,
    currentSpiralOrder: s?.currentSpiralOrder,
    openAiApiKey: s?.openAiApiKey,
    modelChat: s?.modelChat ?? "gpt-5.2-thinking",
    modelExtract: s?.modelExtract ?? "gpt-5.2-thinking",
    modelSummarize: s?.modelSummarize ?? "gpt-5.2-thinking",
    updatedAt: nowIso(),
  });
}

function depsMet(node: NodeDefinition, completed: Set<string>) {
  const unmet = (node.dependencies ?? []).filter((d) => !completed.has(d));
  return { ok: unmet.length === 0, unmet };
}

export async function computeNodeStatuses(opts?: {
  preferNextBySpiral?: boolean;
}): Promise<Map<string, ComputedNodeStatus>> {
  const preferNextBySpiral = opts?.preferNextBySpiral ?? true;

  const nodes = await getAllNodes();
  const completed = await getCompletedNodeIds();
  const settings = await getGlobalSettings();

  const statusMap = new Map<string, ComputedNodeStatus>();

  // First pass: completed/locked/available
  for (const n of nodes) {
    if (completed.has(n.id)) {
      statusMap.set(n.id, { nodeId: n.id, status: "completed" });
      continue;
    }
    const { ok, unmet } = depsMet(n, completed);
    if (!ok) statusMap.set(n.id, { nodeId: n.id, status: "locked", unmetDependencies: unmet });
    else statusMap.set(n.id, { nodeId: n.id, status: "available" });
  }

  // Second pass: compute a recommended "next"
  const nextNodeId = computeRecommendedNextNodeId(nodes, statusMap, settings, { preferNextBySpiral });
  if (nextNodeId) {
    const entry = statusMap.get(nextNodeId);
    if (entry && entry.status === "available") {
      statusMap.set(nextNodeId, { ...entry, status: "next", recommendedReason: "recommended_next" });
    }
  }

  return statusMap;
}

export function computeRecommendedNextNodeId(
  nodes: NodeDefinition[],
  statusMap: Map<string, ComputedNodeStatus>,
  settings?: { currentNodeId?: string; currentSpiralOrder?: number },
  opts?: { preferNextBySpiral?: boolean }
): string | null {
  const preferNextBySpiral = opts?.preferNextBySpiral ?? true;

  const available = nodes.filter((n) => statusMap.get(n.id)?.status === "available");

  if (!available.length) return null;

  // If spiral preference: choose the next spiral node (lowest order) whose deps are met.
  if (preferNextBySpiral) {
    const spirals = available
      .filter((n) => n.type === "spiral" && n.ui_position?.spiral)
      .sort((a, b) => (a.ui_position!.spiral!.order - b.ui_position!.spiral!.order));

    const currentOrder = settings?.currentSpiralOrder ?? null;

    if (currentOrder != null) {
      const after = spirals.find((n) => n.ui_position!.spiral!.order >= currentOrder);
      if (after) return after.id;
    }
    if (spirals.length) return spirals[0].id;
  }

  // Fallback: choose the available node that shares the most tags with the current node.
  const currentId = settings?.currentNodeId ?? null;
  const current = currentId ? nodes.find((n) => n.id === currentId) : null;
  if (!current) return available[0].id;

  const currentTags = new Set(current.tags ?? []);
  const scored = available
    .map((n) => {
      const overlap = (n.tags ?? []).reduce((acc, t) => acc + (currentTags.has(t) ? 1 : 0), 0);
      return { id: n.id, overlap, isSpiral: n.type === "spiral" };
    })
    .sort((a, b) => (b.overlap - a.overlap) || (b.isSpiral ? 1 : -1));

  return scored[0]?.id ?? available[0].id;
}

/**
 * A convenience helper for UI: returns node lists grouped by status.
 */
export async function getNodesGroupedByStatus() {
  const nodes = await getAllNodes();
  const statuses = await computeNodeStatuses();
  const groups: Record<NodeStatus, NodeDefinition[]> = {
    completed: [],
    locked: [],
    available: [],
    next: [],
  };
  for (const n of nodes) {
    const s = statuses.get(n.id)?.status ?? "locked";
    groups[s].push(n);
  }
  return groups;
}

/**
 * For "why locked" tooltip.
 */
export async function getLockReason(nodeId: string): Promise<string | null> {
  const statuses = await computeNodeStatuses();
  const s = statuses.get(nodeId);
  if (!s || s.status !== "locked") return null;
  return s.unmetDependencies?.length ? `Requires: ${s.unmetDependencies.join(", ")}` : "Locked";
}
