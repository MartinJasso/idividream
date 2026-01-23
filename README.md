# Local-first library files

These files assume:
- You serve `nodes.json` at `/nodes.json` (e.g. in Next.js `public/nodes.json`).
- You use IndexedDB via Dexie for persistence (serverless/local-first).
- Node status is computed, not stored (completed/locked/available/next).

## Install
```bash
npm i dexie
```

## Seed nodes on app start
```ts
import { seedNodeDefinitionsFromUrl } from "./seed";

await seedNodeDefinitionsFromUrl("/nodes.json");
```

## Compute UI statuses
```ts
import { computeNodeStatuses } from "./journey";

const statuses = await computeNodeStatuses();
console.log(statuses.get("persona_building"));
```
