import dynamic from "next/dynamic";
import { useRouter } from "next/router";

const ChatPage = dynamic(() => import("../components/ChatPage"), {
  ssr: false,
});

export default function ChatRoutePage() {
  const router = useRouter();
  const nodeIdParam = router.query.nodeId;
  const nodeId = Array.isArray(nodeIdParam) ? nodeIdParam[0] : nodeIdParam ?? null;

  return <ChatPage nodeId={nodeId} />;
}
