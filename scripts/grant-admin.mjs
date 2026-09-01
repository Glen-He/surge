import { Pool } from "pg";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("usage: pnpm admin:grant <email>");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(
    `UPDATE "user"
     SET role = CASE
       WHEN role IS NULL OR btrim(role) = '' OR role = 'user' THEN 'admin'
       WHEN 'admin' = ANY(regexp_split_to_array(lower(role), '\\s*,\\s*')) THEN role
       ELSE role || ',admin'
     END,
     "updatedAt" = NOW()
     WHERE lower(email) = $1
       AND email NOT LIKE '%@guest.invalid'
     RETURNING id, email, role`,
    [email],
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error("a non-guest user with this email was not found");
  }
  process.stdout.write(`admin granted: ${user.email} (${user.id})\n`);
} finally {
  await pool.end();
}
