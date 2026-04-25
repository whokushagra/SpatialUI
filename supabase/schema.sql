create extension if not exists "pgcrypto";

create table if not exists void_board_documents (
  id uuid primary key default gen_random_uuid(),
  title text default 'Untitled',
  payload jsonb not null default '{"version":1,"void":true,"screens":[]}'::jsonb,
  exported_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists screens (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references void_board_documents(id) on delete cascade,
  screen_key text not null,
  name text not null,
  sort_order int default 0,
  unique (document_id, screen_key)
);

create table if not exists ui_elements (
  document_id uuid not null references void_board_documents(id) on delete cascade,
  element_uuid text not null,
  screen_key text not null,
  parent_element_uuid text,
  void_type text not null,
  props jsonb not null default '{}'::jsonb,
  primary key (document_id, element_uuid)
);

create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references void_board_documents(id) on delete cascade,
  source_element_uuid text not null,
  target_screen_key text not null,
  click_animation text default 'none'
);

create table if not exists screen_flow_runtime (
  document_id uuid primary key references void_board_documents(id) on delete cascade,
  active_screen_key text not null,
  exported_at timestamptz
);

create table if not exists scene_environment (
  document_id uuid primary key references void_board_documents(id) on delete cascade,
  viewport jsonb default '{}'::jsonb,
  extras jsonb default '{}'::jsonb
);

create index if not exists idx_screens_document on screens(document_id);
create index if not exists idx_ui_elements_doc_screen on ui_elements(document_id, screen_key);
create index if not exists idx_interactions_document on interactions(document_id);

alter table void_board_documents enable row level security;
alter table screens enable row level security;
alter table ui_elements enable row level security;
alter table interactions enable row level security;
alter table screen_flow_runtime enable row level security;
alter table scene_environment enable row level security;

drop policy if exists void_documents_anon_all on void_board_documents;
drop policy if exists screens_anon_all on screens;
drop policy if exists ui_elements_anon_all on ui_elements;
drop policy if exists interactions_anon_all on interactions;
drop policy if exists screen_flow_anon_all on screen_flow_runtime;
drop policy if exists scene_env_anon_all on scene_environment;

create policy "void_documents_anon_all" on void_board_documents for all using (true) with check (true);
create policy "screens_anon_all" on screens for all using (true) with check (true);
create policy "ui_elements_anon_all" on ui_elements for all using (true) with check (true);
create policy "interactions_anon_all" on interactions for all using (true) with check (true);
create policy "screen_flow_anon_all" on screen_flow_runtime for all using (true) with check (true);
create policy "scene_env_anon_all" on scene_environment for all using (true) with check (true);
