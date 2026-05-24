create table if not exists sync_state (
  id text primary key,
  revision integer not null,
  progress_json text not null,
  totals_json text not null,
  updated_at integer not null
);
