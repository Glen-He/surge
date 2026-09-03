import type { Migration } from "./migration";


export const MAINTENANCE_STATE: Migration = {
  version: 17,
  name: "maintenance-state",
  statements: [
    `CREATE TABLE IF NOT EXISTS maintenance_state (
       name TEXT PRIMARY KEY,
       last_started_at TIMESTAMPTZ,
       last_succeeded_at TIMESTAMPTZ,
       last_error TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ],
};
