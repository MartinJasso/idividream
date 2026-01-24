// First-time guidance prompts per journey point (node).
// Used when a user opens /chat?nodeId=<id> for the first time.
//
// Design goals:
// - Guided onboarding per node (one “first assistant message”)
// - Personal-first, hypothesis language, no certainty claims
// - Re-usable placeholders so a default prompt can cover most nodes

import type { NodeDefinition } from "../../types";

export type FirstTimePromptsConfig = {
  schemaVersion: 1;
  /**
   * Default template used when nodeId has no override.
   * Placeholders are replaced via renderFirstTimePrompt():
   *  - {{nodeId}}
   *  - {{nodeTitle}}
   *  - {{nodeDescription}}
   *  - {{nodePhase}}
   *  - {{nodeDomain}}
   */
  defaultTemplate: string;

  /**
   * Optional per-node overrides. Key must match NodeDefinition.id from nodes.json.
   * Each value is a full prompt template (can still include placeholders).
   */
  byNodeId: Record<string, string>;
};

export const firstTimePrompts: FirstTimePromptsConfig = {
  schemaVersion: 1,
  defaultTemplate: `
You are my guide for this journey point.

Journey point:
- id: {{nodeId}}
- title: {{nodeTitle}}
- phase: {{nodePhase}}
- domain: {{nodeDomain}}

Context (what this point is about):
{{nodeDescription}}

Your job for the FIRST message in this chat:
1) Give a crisp 2–4 sentence orientation: what this node is trying to build (benefit) and what can go wrong if unsteered (tradeoff). Use hypothesis language.
2) Ask me 3 focused questions that help personalize this node for me (no therapy tone; practical and concrete).
3) Propose ONE small next action I can do in 10–20 minutes today, and ONE “done definition” so I know when to mark this node completed.
4) Keep it short. No long lecture. One clarifying question max.
`.trim(),

  // Populate these over time for higher quality guidance.
  // Example:
  byNodeId: {
    // "ego_formation": `...`,
    // "shadow_work": `...`,
  },
};

function fill(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v ?? ""),
    template
  );
}

/**
 * Render the first-time prompt for a node.
 */
export function renderFirstTimePrompt(node: NodeDefinition): string {
  const template = firstTimePrompts.byNodeId[node.id] ?? firstTimePrompts.defaultTemplate;
  return fill(template, {
    nodeId: node.id,
    nodeTitle: node.title,
    nodeDescription: node.description,
    nodePhase: node.phase,
    nodeDomain: node.domain,
  });
}
