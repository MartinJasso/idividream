"use client";

import { useSearchParams } from "next/navigation";
import ChatPage from "../../components/ChatPage";

export default function ChatPageRoute() {
  const searchParams = useSearchParams();
  const nodeId = searchParams.get("nodeId");

  return <ChatPage nodeId={nodeId} />;
}
