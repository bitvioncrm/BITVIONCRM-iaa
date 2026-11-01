alter table public.call_time_sessions
  add column if not exists party_name text not null default '';
