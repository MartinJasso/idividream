"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatPage from "../../components/ChatPage";
import { computeNodeStatuses, getGlobalSettings } from "../../journey";
import { ensureUserNodeStateRows, seedNodeDefinitionsFromUrl } from "../../seed";

export default function ChatPageRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nodeId = searchParams.get("nodeId");
  const seededRef = useRef(false);

  useEffect(() => {
    if (nodeId) return;
    let active = true;

    const resolveNode = async () => {
      if (!seededRef.current) {
        seededRef.current = true;
        await seedNodeDefinitionsFromUrl("/nodes.json");
        await ensureUserNodeStateRows();
      }

      const [settings, statusMap] = await Promise.all([
        getGlobalSettings(),
        computeNodeStatuses(),
      ]);

      if (!active) return;
      const nextNodeId =
        settings?.currentNodeId ??
        Array.from(statusMap.values()).find((status) => status.status === "next")
          ?.nodeId ??
        null;

      if (nextNodeId) {
        router.replace(`/chat?nodeId=${nextNodeId}`);
      }
    };

    resolveNode();

    return () => {
      active = false;
    };
  }, [nodeId, router]);

  if (!nodeId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-300">
        Resolving your current node…
      </div>
    );
  }

  return <ChatPage nodeId={nodeId} />;
}
