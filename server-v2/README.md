# Local keys for the older seed scripts

`seed-sailings`, `seed-users`, `seed-partners`, `seed-demo-enquiry` and
`seed-kevin-enquiry` reach Supabase with the project's own keys rather than
through the Management API, so they need a `.keys.json` here:

```json
{ "service_role": "eyJ…", "anon": "eyJ…", "db_password": "…" }
```

Both keys are on the Supabase dashboard under Project Settings → API for
project `izgbrdeybhbepftloxgk`. The file is gitignored and must stay that way:
`service_role` bypasses RLS entirely.

`.project.json` holds only the project ref, which is not a secret — it is
already written into `supabase-v2/run-sql.mjs`.

**You do not need any of this for the documented path.** `seed-showcase.mjs`,
which the handoff tells you to run, goes through the Management API using
`SUPABASE_ACCESS_TOKEN` from `../araxys-crm/snapserve-setup/.env` and needs
nothing here.
