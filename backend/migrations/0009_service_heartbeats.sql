-- Long-running processes (the worker) check in here so the admin dashboard can tell if one stopped.
create table service_heartbeats (
  name text primary key,
  pid integer not null,
  started_at timestamptz not null,
  seen_at timestamptz not null
);
