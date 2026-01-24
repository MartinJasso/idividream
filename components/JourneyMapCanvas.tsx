"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Konva from "konva";
import { Circle, Group, Layer, Line, Stage, Text } from "react-konva";
import { db } from "../db";
import type {
  AppSettings,
  ComputedNodeStatus,
  Message,
  NodeDefinition,
  NodeStatus,
  PersonalSymbolMeaning,
  SymbolOccurrence,
  Thread,
  ThreadSummary,
  UserNodeState,
} from "../types";
import {
  computeNodeStatuses,
  getAllNodes,
  getGlobalSettings,
  markNodeCompleted,
  setCurrentNode,
} from "../journey";
import { ensureUserNodeStateRows, seedNodeDefinitionsFromUrl } from "../seed";

const POSITION_SCALE = 1.2;
const NODE_RADIUS = 14;

const STATUS_LABELS: Record<NodeStatus, string> = {
  completed: "Completed",
  next: "Next",
  available: "Available",
  locked: "Locked",
};

const STATUS_STYLES: Record<
  NodeStatus,
  {
    fill: string;
    stroke: string;
    text: string;
    strokeWidth: number;
    opacity: number;
    shadowColor?: string;
    shadowBlur?: number;
    shadowOpacity?: number;
  }
> = {
  completed: {
    fill: "#22c55e",
    stroke: "#16a34a",
    text: "#0f172a",
    strokeWidth: 1,
    opacity: 1,
  },
  next: {
    fill: "#0f172a",
    stroke: "#facc15",
    text: "#f8fafc",
    strokeWidth: 4,
    opacity: 1,
    shadowColor: "#facc15",
    shadowBlur: 16,
    shadowOpacity: 0.6,
  },
  available: {
    fill: "#38bdf8",
    stroke: "#0ea5e9",
    text: "#0f172a",
    strokeWidth: 1,
    opacity: 1,
  },
  locked: {
    fill: "#334155",
    stroke: "#475569",
    text: "#94a3b8",
    strokeWidth: 1,
    opacity: 0.6,
  },
};

const CURRENT_RING = {
  stroke: "#c026d3",
  strokeWidth: 3,
  shadowColor: "#c026d3",
  shadowBlur: 10,
  shadowOpacity: 0.7,
};

const STATUS_BADGE_STYLES: Record<NodeStatus, string> = {
  completed: "bg-emerald-500/15 text-emerald-200 border-emerald-500/60",
  next: "bg-yellow-400/15 text-yellow-100 border-yellow-300/70",
  available: "bg-sky-400/15 text-sky-100 border-sky-400/70",
  locked: "bg-slate-700/40 text-slate-200 border-slate-600",
};

interface TooltipState {
  nodeId: string;
  x: number;
  y: number;
}

interface NodePoint {
  node: NodeDefinition;
  x: number;
  y: number;
  status: NodeStatus;
  unmetDependencies?: string[];
}

interface ExportPayload {
  version: number;
  exportedAt: string;
  userNodeStates: UserNodeState[];
  threads: Thread[];
  messages: Message[];
  threadSummaries: ThreadSummary[];
  personalSymbolMeanings: PersonalSymbolMeaning[];
  symbolOccurrences: SymbolOccurrence[];
  appSettings: AppSettings[];
}

function formatTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function JourneyMapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const seededRef = useRef(false);

  const [nodes, setNodes] = useState<NodeDefinition[]>([]);
  const [statusMap, setStatusMap] = useState<Map<string, ComputedNodeStatus>>(new Map());
  const [userNodeStates, setUserNodeStates] = useState<Map<string, UserNodeState>>(new Map());
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [exportPayload, setExportPayload] = useState<string>("");
  const [importPayload, setImportPayload] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);

  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const refreshData = useCallback(async () => {
    const [nodeData, statusData, userStates, settings] = await Promise.all([
      getAllNodes(),
      computeNodeStatuses(),
      db.userNodeStates.toArray(),
      getGlobalSettings(),
    ]);
    setNodes(nodeData);
    setStatusMap(new Map(statusData));
    setUserNodeStates(new Map(userStates.map((row) => [row.nodeId, row])));
    setCurrentNodeId(settings?.currentNodeId ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!seededRef.current) {
        seededRef.current = true;
        await seedNodeDefinitionsFromUrl("/nodes.json");
        await ensureUserNodeStateRows();
      }
      if (!active) return;
      await refreshData();
    };
    load();
    return () => {
      active = false;
    };
  }, [refreshData]);

  const nodePoints = useMemo<NodePoint[]>(() => {
    return nodes
      .map((node) => {
        const spiral = node.ui_position?.spiral;
        const tree = node.ui_position?.tree;
        let x: number | null = null;
        let y: number | null = null;
        if (spiral) {
          x = Math.cos(spiral.theta) * spiral.radius * POSITION_SCALE;
          y = Math.sin(spiral.theta) * spiral.radius * POSITION_SCALE;
        } else if (tree) {
          x = tree.x * POSITION_SCALE;
          y = tree.y * POSITION_SCALE;
        }
        if (x == null || y == null) return null;
        const statusEntry = statusMap.get(node.id);
        const status = statusEntry?.status ?? "locked";
        return {
          node,
          x,
          y,
          status,
          unmetDependencies: statusEntry?.unmetDependencies,
        };
      })
      .filter((point): point is NodePoint => point !== null);
  }, [nodes, statusMap]);

  const nodeById = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const spiralPoints = useMemo(() => {
    return nodes
      .filter((node) => node.ui_position?.spiral)
      .sort(
        (a, b) =>
          (a.ui_position!.spiral!.order ?? 0) -
          (b.ui_position!.spiral!.order ?? 0)
      )
      .flatMap((node) => {
        const spiral = node.ui_position!.spiral!;
        const x = Math.cos(spiral.theta) * spiral.radius * POSITION_SCALE;
        const y = Math.sin(spiral.theta) * spiral.radius * POSITION_SCALE;
        return [x, y];
      });
  }, [nodes]);

  const treeEdges = useMemo(() => {
    const pointsById = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      const tree = node.ui_position?.tree;
      if (tree) {
        pointsById.set(node.id, {
          x: tree.x * POSITION_SCALE,
          y: tree.y * POSITION_SCALE,
        });
      }
    }
    return nodes
      .map((node) => {
        const tree = node.ui_position?.tree;
        if (!tree?.parent_id) return null;
        const from = pointsById.get(tree.parent_id);
        const to = pointsById.get(node.id);
        if (!from || !to) return null;
        return { from, to, id: `${tree.parent_id}-${node.id}` };
      })
      .filter((edge): edge is { from: { x: number; y: number }; to: { x: number; y: number }; id: string } => edge !== null);
  }, [nodes]);

  const bounds = useMemo(() => {
    if (!nodePoints.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of nodePoints) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
  }, [nodePoints]);

  const fitToScreen = useCallback(() => {
    if (!bounds) return;
    const padding = 80;
    const width = bounds.maxX - bounds.minX + padding * 2;
    const height = bounds.maxY - bounds.minY + padding * 2;
    const scale = Math.min(stageSize.width / width, stageSize.height / height);
    const x = stageSize.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
    const y = stageSize.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;
    setStageScale(scale || 1);
    setStagePosition({ x, y });
  }, [bounds, stageSize]);

  useEffect(() => {
    if (bounds) {
      fitToScreen();
    }
  }, [bounds, fitToScreen]);

  const handleWheel = useCallback((event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stagePosition.x) / oldScale,
      y: (pointer.y - stagePosition.y) / oldScale,
    };
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.05;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    setStageScale(newScale);
    setStagePosition(newPos);
  }, [stagePosition, stageScale]);

  const handleDragMove = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    setStagePosition({ x: event.target.x(), y: event.target.y() });
  }, []);

  const handleNodeHover = useCallback(
    (nodeId: string | null, event?: Konva.KonvaEventObject<MouseEvent>) => {
      if (!nodeId) {
        setTooltip(null);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      const x = event?.evt.clientX ?? 0;
      const y = event?.evt.clientY ?? 0;
      setTooltip({
        nodeId,
        x: rect ? x - rect.left : x,
        y: rect ? y - rect.top : y,
      });
    },
    []
  );

  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId)
    : null;
  const selectedStatus = selectedNodeId ? statusMap.get(selectedNodeId) : null;
  const selectedUserState = selectedNodeId ? userNodeStates.get(selectedNodeId) : null;
  const unmetDetails = selectedStatus?.unmetDependencies?.map((depId) => ({
    id: depId,
    title: nodeById.get(depId)?.title ?? "Unknown node",
  }));

  const hoveredNode = tooltip ? nodes.find((node) => node.id === tooltip.nodeId) : null;
  const hoveredStatus = tooltip ? statusMap.get(tooltip.nodeId) : null;

  const handleToggleCompleted = async () => {
    if (!selectedNode) return;
    if (selectedStatus?.status === "locked") return;
    const isCompleted = selectedStatus?.status === "completed";
    await markNodeCompleted(selectedNode.id, !isCompleted);
    await refreshData();
  };

  const handleSetCurrent = async () => {
    if (!selectedNode) return;
    await setCurrentNode(selectedNode.id);
    await refreshData();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportPayload(text);
  };

  const handleExport = async () => {
    const [
      userStates,
      threads,
      messages,
      threadSummaries,
      personalSymbolMeanings,
      symbolOccurrences,
      appSettings,
    ] = await Promise.all([
      db.userNodeStates.toArray(),
      db.threads.toArray(),
      db.messages.toArray(),
      db.threadSummaries.toArray(),
      db.personalSymbolMeanings.toArray(),
      db.symbolOccurrences.toArray(),
      db.appSettings.toArray(),
    ]);

    const sanitizedSettings = appSettings.map((setting) => ({
      ...setting,
      openAiApiKey: undefined,
    }));

    const payload: ExportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      userNodeStates: userStates,
      threads,
      messages,
      threadSummaries,
      personalSymbolMeanings,
      symbolOccurrences,
      appSettings: sanitizedSettings,
    };

    setExportPayload(JSON.stringify(payload, null, 2));
  };

  const handleImport = async () => {
    setImportError(null);
    let parsed: ExportPayload;
    try {
      parsed = JSON.parse(importPayload) as ExportPayload;
    } catch (error) {
      setImportError("Invalid JSON. Please check the payload.");
      return;
    }

    const existingSettings = await db.appSettings.toArray();
    const preservedApiKey = existingSettings.find((setting) => setting.key === "global")?.openAiApiKey;

    const nextSettings =
      parsed.appSettings?.map((setting) => ({
        ...setting,
        openAiApiKey: setting.openAiApiKey ?? preservedApiKey,
      })) ?? [];

    await db.transaction(
      "rw",
      db.userNodeStates,
      db.threads,
      db.messages,
      db.threadSummaries,
      db.personalSymbolMeanings,
      db.symbolOccurrences,
      db.appSettings,
      async () => {
        await db.userNodeStates.clear();
        await db.threads.clear();
        await db.messages.clear();
        await db.threadSummaries.clear();
        await db.personalSymbolMeanings.clear();
        await db.symbolOccurrences.clear();
        await db.appSettings.clear();

        if (parsed.userNodeStates?.length) {
          await db.userNodeStates.bulkAdd(parsed.userNodeStates);
        }
        if (parsed.threads?.length) {
          await db.threads.bulkAdd(parsed.threads);
        }
        if (parsed.messages?.length) {
          await db.messages.bulkAdd(parsed.messages);
        }
        if (parsed.threadSummaries?.length) {
          await db.threadSummaries.bulkAdd(parsed.threadSummaries);
        }
        if (parsed.personalSymbolMeanings?.length) {
          await db.personalSymbolMeanings.bulkAdd(parsed.personalSymbolMeanings);
        }
        if (parsed.symbolOccurrences?.length) {
          await db.symbolOccurrences.bulkAdd(parsed.symbolOccurrences);
        }
        if (nextSettings.length) {
          await db.appSettings.bulkAdd(nextSettings);
        }
      }
    );

    await ensureUserNodeStateRows();
    await refreshData();
  };

  const handleReset = async () => {
    await db.delete();
    window.location.reload();
  };

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-4 top-4 z-10 flex items-center gap-3 rounded-full border border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-slate-200 shadow-lg">
        <span>Pan: drag · Zoom: scroll</span>
        <button
          onClick={fitToScreen}
          className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700"
        >
          Fit to screen
        </button>
      </div>

      <div ref={containerRef} className="h-full w-full">
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePosition.x}
          y={stagePosition.y}
          draggable
          onDragMove={handleDragMove}
          onWheel={handleWheel}
          ref={stageRef}
        >
          <Layer>
            {spiralPoints.length > 2 && (
              <Line
                points={spiralPoints}
                stroke="#1f2937"
                strokeWidth={4}
                lineJoin="round"
                lineCap="round"
              />
            )}
            {treeEdges.map((edge) => (
              <Line
                key={edge.id}
                points={[edge.from.x, edge.from.y, edge.to.x, edge.to.y]}
                stroke="#334155"
                strokeWidth={2}
                opacity={0.8}
              />
            ))}
            {nodePoints.map((point) => {
              const style = STATUS_STYLES[point.status];
              const isCurrent = point.node.id === currentNodeId;
              return (
                <Group
                  key={point.node.id}
                  x={point.x}
                  y={point.y}
                  onMouseEnter={(event) => handleNodeHover(point.node.id, event)}
                  onMouseMove={(event) => handleNodeHover(point.node.id, event)}
                  onMouseLeave={() => handleNodeHover(null)}
                  onClick={() => setSelectedNodeId(point.node.id)}
                >
                  {isCurrent && (
                    <Circle
                      radius={NODE_RADIUS + 8}
                      stroke={CURRENT_RING.stroke}
                      strokeWidth={CURRENT_RING.strokeWidth}
                      shadowColor={CURRENT_RING.shadowColor}
                      shadowBlur={CURRENT_RING.shadowBlur}
                      shadowOpacity={CURRENT_RING.shadowOpacity}
                    />
                  )}
                  <Circle
                    radius={NODE_RADIUS}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth={style.strokeWidth}
                    opacity={style.opacity}
                    shadowColor={style.shadowColor}
                    shadowBlur={style.shadowBlur}
                    shadowOpacity={style.shadowOpacity}
                  />
                  <Text
                    text={point.node.title}
                    offsetY={-NODE_RADIUS - 8}
                    fontSize={12}
                    fill={style.text}
                    width={160}
                    align="center"
                    offsetX={80}
                    opacity={style.opacity}
                  />
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {tooltip && hoveredNode && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-xl"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-semibold">{hoveredNode.title}</div>
          <div className="text-slate-300">{STATUS_LABELS[hoveredStatus?.status ?? "locked"]}</div>
          {hoveredStatus?.status === "locked" && hoveredStatus.unmetDependencies?.length ? (
            <div className="mt-1 text-slate-400">
              Requires: {hoveredStatus.unmetDependencies.join(", ")}
            </div>
          ) : null}
        </div>
      )}

      {selectedNode && (
        <>
          <button
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            onClick={() => setSelectedNodeId(null)}
            aria-label="Close details"
          />
          <aside className="fixed right-0 top-0 z-30 flex h-full w-full max-w-md flex-col gap-6 overflow-y-auto border-l border-slate-800 bg-slate-950/95 p-6 text-slate-100 shadow-2xl md:rounded-l-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Node</p>
                <h2 className="text-2xl font-semibold">{selectedNode.title}</h2>
              </div>
              <button
                className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                onClick={() => setSelectedNodeId(null)}
              >
                Close
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full border px-3 py-1 ${STATUS_BADGE_STYLES[selectedStatus?.status ?? "locked"]}`}
              >
                {STATUS_LABELS[selectedStatus?.status ?? "locked"]}
              </span>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-300">
                Phase: {selectedNode.phase}
              </span>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-300">
                Domain: {selectedNode.domain}
              </span>
            </div>
            <p className="text-sm text-slate-300">{selectedNode.description}</p>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Status</span>
                <span className="text-slate-300">
                  {STATUS_LABELS[selectedStatus?.status ?? "locked"]}
                </span>
              </div>
              {selectedStatus?.status === "locked" && unmetDetails?.length ? (
                <div className="mt-3 text-xs text-slate-400">
                  <div className="font-semibold text-slate-300">Unmet dependencies</div>
                  <ul className="mt-2 space-y-1">
                    {unmetDetails.map((dep) => (
                      <li key={dep.id} className="flex flex-col">
                        <span className="text-slate-200">{dep.title}</span>
                        <span className="text-[11px] text-slate-500">{dep.id}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {selectedStatus?.status === "completed" && selectedUserState?.completedAt ? (
                <div className="mt-3 text-xs text-slate-400">
                  Completed at:{" "}
                  <span className="text-slate-200">
                    {formatTimestamp(selectedUserState.completedAt)}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href={`/chat?nodeId=${selectedNode.id}`}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-center text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Open chat
              </Link>
              <button
                onClick={handleToggleCompleted}
                className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                disabled={selectedStatus?.status === "locked"}
              >
                {selectedStatus?.status === "completed" ? "Mark incomplete" : "Mark completed"}
              </button>
              <button
                onClick={handleSetCurrent}
                className="rounded-lg border border-sky-500/60 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/20"
              >
                Set as current
              </button>
              {selectedStatus?.status === "locked" ? (
                <p className="text-xs text-slate-400">
                  Complete dependencies before marking this node as finished.
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-200">
              <div className="mb-3 text-sm font-semibold text-slate-100">Local data utilities</div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleExport}
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={handleImport}
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Import JSON
                  </button>
                  <button
                    onClick={handleReset}
                    className="rounded-full border border-rose-500/70 px-3 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
                  >
                    Reset local data
                  </button>
                </div>
                <label className="flex flex-col gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">
                    Import file
                  </span>
                  <input
                    type="file"
                    accept="application/json"
                    onChange={handleImportFile}
                    className="text-xs text-slate-300"
                  />
                </label>
                {importError ? (
                  <div className="text-xs text-rose-300">{importError}</div>
                ) : null}
                <textarea
                  value={importPayload}
                  onChange={(event) => setImportPayload(event.target.value)}
                  placeholder="Paste exported JSON here for import."
                  className="h-24 w-full rounded-lg border border-slate-700 bg-slate-950/70 p-2 text-[11px] text-slate-200"
                />
                <textarea
                  value={exportPayload}
                  readOnly
                  placeholder="Exported JSON will appear here."
                  className="h-24 w-full rounded-lg border border-slate-700 bg-slate-950/70 p-2 text-[11px] text-slate-200"
                />
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
