import type { Migration } from "./migration";


export const SHARE_CREDENTIAL_HARDENING: Migration = {
  version: 16,
  name: "share-credential-hardening",
  statements: [
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS token_hash TEXT`,
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `ALTER TABLE report_shares ALTER COLUMN token DROP NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS report_shares_token_hash_unique
       ON report_shares (token_hash) WHERE token_hash IS NOT NULL`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS token_hash TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS access_epoch INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE share_boards ALTER COLUMN token DROP NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS share_boards_token_hash_unique
       ON share_boards (token_hash) WHERE token_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS share_boards_expires_at
       ON share_boards (expires_at) WHERE expires_at IS NOT NULL`,
  ],
};
