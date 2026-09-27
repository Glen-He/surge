import type { Migration } from "./migration";

export const REMOVE_GUEST_PAYLOAD: Migration = {
  version: 31,
  name: "remove-guest-payload",
  statements: [`ALTER TABLE guest_sessions DROP COLUMN payload`],
};
