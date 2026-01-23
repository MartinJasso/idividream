// db.ts
// Dexie (IndexedDB) schema for the local-first individuation app.

import Dexie, { Table } from "dexie";
import type {
  NodeDefinition,
  UserNodeState,
  Thread,
  Message,
  ThreadSummary,
  SymbolDef,
  PersonalSymbolMeaning,
  SymbolOccurrence,
  AppSettings,
} from "./types";

export class JourneyDB extends Dexie {
  nodeDefinitions!: Table<NodeDefinition, string>;
  userNodeStates!: Table<UserNodeState, string>;

  threads!: Table<Thread, string>;
  messages!: Table<Message, string>;
  threadSummaries!: Table<ThreadSummary, string>;

  symbols!: Table<SymbolDef, string>;
  personalSymbolMeanings!: Table<PersonalSymbolMeaning, string>;
  symbolOccurrences!: Table<SymbolOccurrence, string>;

  appSettings!: Table<AppSettings, string>;

  constructor() {
    super("individuation_journey_db");

    // Notes on indexes:
    // - Use '&' for unique primary keys.
    // - Use compound indexes to speed common queries.
    this.version(1).stores({
      nodeDefinitions: "&id, type, phase, domain, *tags",
      userNodeStates: "&nodeId, completedAt, updatedAt",

      threads: "&id, nodeId, updatedAt",
      messages: "&id, threadId, createdAt, role",
      threadSummaries: "&threadId, updatedAt",

      symbols: "&id, label, category, createdAt",
      personalSymbolMeanings: "&symbolId, lastUpdated",
      symbolOccurrences: "&id, symbolId, messageId, nodeId, createdAt",

      appSettings: "&key, updatedAt",
    });
  }
}

export const db = new JourneyDB();
