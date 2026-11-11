-- Existing entries keep their Tasks / Content origin; only new Calendar entries are marked calendar.
begin;

alter table public.tasks
  add column if not exists created_from text not null default 'tasks'
  check (created_from in ('tasks', 'calendar'));

alter table public.content_items
  add column if not exists created_from text not null default 'content'
  check (created_from in ('content', 'calendar'));

commit;
