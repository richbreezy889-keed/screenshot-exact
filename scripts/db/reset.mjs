import { createDatabase } from "./bootstrap.mjs";

const { db, migrations } = await createDatabase();

const { rows } = await db.query(`
  select
    (select count(*)::int from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
    (select count(*)::int from information_schema.tables
      where table_schema = 'public' and table_type = 'VIEW') as views,
    (select count(*)::int
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as rls_tables
`);

await db.close();

const summary = rows[0];
console.log(
  `db:reset rebuilt the schema from scratch: ${migrations.length} migration(s), ` +
    `${summary.tables} table(s) (${summary.rls_tables} with RLS), ${summary.views} view(s).`,
);
