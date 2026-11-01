alter table public.students add column if not exists photo_path text not null default '';
alter table public.patients add column if not exists photo_path text not null default '';
