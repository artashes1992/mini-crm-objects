-- Мини-CRM «Объекты и задачи»: таблицы и справочник переходов статусов.

create type public.app_role as enum ('manager', 'executor');
comment on type public.app_role is 'manager — постановщик, executor — исполнитель';

create type public.task_status as enum ('new', 'in_progress', 'review', 'accepted', 'rework');
comment on type public.task_status is
  'new — Новая, in_progress — В работе, review — На проверке, accepted — Принята, rework — На доработке';

-- Профиль сотрудника: имя и роль. Создаётся автоматически при создании пользователя в Supabase Auth.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  role public.app_role not null,
  created_at timestamptz not null default now()
);

-- Объект — стройка.
create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  address text not null check (btrim(address) <> ''),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Задача по объекту. Объект с задачами удалить нельзя (on delete restrict).
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references public.objects (id) on delete restrict,
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  assignee_id uuid not null references public.profiles (id),
  status public.task_status not null default 'new',
  author_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_object_id_idx on public.tasks (object_id);
create index tasks_assignee_id_idx on public.tasks (assignee_id);

-- История смены статусов. Пишется только функциями базы, клиент может её только читать.
create table public.task_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  from_status public.task_status, -- null: задача только что создана («— → Новая»)
  to_status public.task_status not null,
  comment text,
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now()
);

create index task_history_task_id_idx on public.task_history (task_id, changed_at);

-- Разрешённые переходы. По этой таблице база проверяет каждый переход,
-- а интерфейс решает, какие кнопки показать. Всё, чего здесь нет, запрещено.
-- actor = executor означает «назначенный исполнитель этой задачи».
create table public.status_transitions (
  from_status public.task_status not null,
  to_status public.task_status not null,
  actor public.app_role not null,
  comment_required boolean not null default false,
  primary key (from_status, to_status)
);

insert into public.status_transitions (from_status, to_status, actor, comment_required) values
  ('new',         'in_progress', 'executor', false),
  ('in_progress', 'review',      'executor', false),
  ('review',      'accepted',    'manager',  false),
  ('review',      'rework',      'manager',  true),
  ('rework',      'in_progress', 'executor', false);
