/* validate-nodes.ts
   Validates nodes.json against nodes.schema.json + extra integrity checks.

   Usage:
     npm i -D ts-node typescript @types/node ajv ajv-formats
     npx ts-node validate-nodes.ts ./nodes.json ./nodes.schema.json
*/

import fs from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

type NodesFile = {
  schema_version: number;
  generated_at?: string;
  nodes: Array<any>;
};

function readJson(p: string) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fail(msg: string): never {
  console.error(`\nVALIDATION FAILED: ${msg}\n`);
  process.exit(1);
}

function warn(msg: string) {
  console.warn(`WARN: ${msg}`);
}

function detectCycles(ids: Set<string>, depsMap: Map<string, string[]>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string, stack: string[]) {
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      const cycle = stack.slice(cycleStart).concat(id);
      fail(`Dependency cycle detected: ${cycle.join(" -> ")}`);
    }
    if (visited.has(id)) return;

    visiting.add(id);
    const deps = depsMap.get(id) ?? [];
    for (const d of deps) {
      if (!ids.has(d)) fail(`Node '${id}' depends on missing node '${d}'`);
      dfs(d, stack.concat(id));
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of ids) dfs(id, []);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function main() {
  const nodesPath = process.argv[2];
  const schemaPath = process.argv[3];
  if (!nodesPath || !schemaPath) {
    fail("Provide paths: validate-nodes.ts <nodes.json> <nodes.schema.json>");
  }

  const nodesFile = readJson(nodesPath) as NodesFile;
  const schema = readJson(schemaPath);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ok = validate(nodesFile);
  if (!ok) {
    console.error(validate.errors);
    fail("JSON Schema validation errors (see above).");
  }

  const nodes = nodesFile.nodes;
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) fail(`Duplicate node id: ${n.id}`);
    ids.add(n.id);
  }

  const depsMap = new Map<string, string[]>();
  const byId = new Map<string, any>();
  for (const n of nodes) {
    depsMap.set(n.id, n.dependencies ?? []);
    byId.set(n.id, n);
  }

  detectCycles(ids, depsMap);

  for (const n of nodes) {
    const tp = n.ui_position?.tree;
    if (!tp) continue;
    const parent = tp.parent_id;
    if (parent == null) continue;
    if (!ids.has(parent)) fail(`Tree node '${n.id}' references missing parent_id '${parent}'`);
    const pt = byId.get(parent)?.type;
    if (pt !== "tree" && pt !== "hybrid") {
      fail(`Tree node '${n.id}' parent_id '${parent}' is type '${pt}', expected 'tree' or 'hybrid'`);
    }
  }

  const treeNodes = nodes.filter((n) => n.ui_position?.tree);
  const spiralNodes = nodes.filter((n) => n.ui_position?.spiral);

  const TREE_MIN_DIST = 8;
  const SPIRAL_MIN_DIST = 12;

  for (let i = 0; i < treeNodes.length; i++) {
    for (let j = i + 1; j < treeNodes.length; j++) {
      const a = treeNodes[i].ui_position.tree;
      const b = treeNodes[j].ui_position.tree;
      if (distance(a, b) < TREE_MIN_DIST) {
        warn(`Tree nodes too close: ${treeNodes[i].id} and ${treeNodes[j].id}`);
      }
    }
  }

  function polarToXY(s: { theta: number; radius: number }) {
    return { x: s.radius * Math.cos(s.theta), y: s.radius * Math.sin(s.theta) };
  }
  for (let i = 0; i < spiralNodes.length; i++) {
    for (let j = i + 1; j < spiralNodes.length; j++) {
      const a = polarToXY(spiralNodes[i].ui_position.spiral);
      const b = polarToXY(spiralNodes[j].ui_position.spiral);
      if (distance(a, b) < SPIRAL_MIN_DIST) {
        warn(`Spiral nodes too close: ${spiralNodes[i].id} and ${spiralNodes[j].id}`);
      }
    }
  }

  console.log("\nOK: nodes.json passes schema + integrity checks.\n");
}

main();
