"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Konva from "konva";
import { Circle, Group, Layer, Line, Stage, Text } from "react-konva";
import type { ComputedNodeStatus, NodeDefinition, NodeStatus } from "../types";
import {
  computeNodeStatuses,
  getAllNodes,
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
  { fill: string; stroke: string; text: string; strokeWidth: number; opacity: number }
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
    strokeWidth: 3,
    opacity: 1,
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

export default function JourneyMapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const seededRef = useRef(false);

  const [nodes, setNodes] = useState<NodeDefinition[]>([]);
  const [statusMap, setStatusMap] = useState<Map<string, ComputedNodeStatus>>(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

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
    const [nodeData, statusData] = await Promise.all([
      getAllNodes(),
      computeNodeStatuses(),
    ]);
    setNodes(nodeData);
    setStatusMap(new Map(statusData));
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

  const hoveredNode = tooltip ? nodes.find((node) => node.id === tooltip.nodeId) : null;
  const hoveredStatus = tooltip ? statusMap.get(tooltip.nodeId) : null;

  const handleToggleCompleted = async () => {
    if (!selectedNode) return;
    const isCompleted = selectedStatus?.status === "completed";
    await markNodeCompleted(selectedNode.id, !isCompleted);
    await refreshData();
  };

  const handleSetCurrent = async () => {
    if (!selectedNode) return;
    await setCurrentNode(selectedNode.id);
    await refreshData();
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
                  <Circle
                    radius={NODE_RADIUS}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth={style.strokeWidth}
                    opacity={style.opacity}
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
          <aside className="fixed right-0 top-0 z-30 flex h-full w-full max-w-md flex-col gap-6 border-l border-slate-800 bg-slate-950/95 p-6 text-slate-100 shadow-2xl md:rounded-l-2xl">
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
            <p className="text-sm text-slate-300">{selectedNode.description}</p>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Status</span>
                <span className="text-slate-300">
                  {STATUS_LABELS[selectedStatus?.status ?? "locked"]}
                </span>
              </div>
              {selectedStatus?.status === "locked" && selectedStatus.unmetDependencies?.length ? (
                <div className="mt-2 text-xs text-slate-400">
                  Requires: {selectedStatus.unmetDependencies.join(", ")}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href={`/chat?nodeId=${selectedNode.id}`}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-center text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Open node chat
              </Link>
              <button
                onClick={handleToggleCompleted}
                className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20"
              >
                {selectedStatus?.status === "completed" ? "Mark incomplete" : "Mark completed"}
              </button>
              <button
                onClick={handleSetCurrent}
                className="rounded-lg border border-sky-500/60 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/20"
              >
                Set as current
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
