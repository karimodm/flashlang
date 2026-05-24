drop table if exists sync_state;
drop table if exists sync_codes;

create table sync_codes (
  code text primary key,
  created_at integer not null,
  last_used_at integer not null
);

create table sync_state (
  code text primary key references sync_codes(code) on delete cascade,
  revision integer not null,
  snapshot_json text not null,
  updated_at integer not null
);
