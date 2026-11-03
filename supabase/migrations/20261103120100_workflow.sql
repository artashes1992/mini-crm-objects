-- Логика: роли, создание профилей, триггеры задач и истории, смена статуса.

-- Постановщик ли текущий пользователь. security definer — чтобы политики RLS
-- могли прочитать роль из profiles, не завися от прав самого пользователя.
create function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'manager' from public.profiles p where p.id = (select auth.uid())),
    false
  )
$$;

create function public.status_label(s public.task_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case s
    when 'new' then 'Новая'
    when 'in_progress' then 'В работе'
    when 'review' then 'На проверке'
    when 'accepted' then 'Принята'
    when 'rework' then 'На доработке'
  end
$$;

-- Профиль создаётся вместе с пользователем. Роль берётся из app_metadata:
-- его может задать только администратор (service_role), сам пользователь — нет.
-- Без роли пользователь становится исполнителем.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
    coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'executor')
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Задачи: служебные поля ставит база, а не клиент.
create function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    if not exists (
      select 1 from public.profiles p where p.id = new.assignee_id and p.role = 'executor'
    ) then
      raise exception 'Исполнителем можно назначить только сотрудника с ролью «Исполнитель»'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'new';
    new.author_id := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- Статус меняет только change_task_status(): она ставит этот флаг на время своей транзакции.
  -- Права на колонку status у клиента и так нет, это вторая линия защиты.
  if new.status is distinct from old.status
     and coalesce(current_setting('app.status_change', true), '') <> 'on' then
    raise exception 'Статус задачи меняется только через действие с задачей' using errcode = '42501';
  end if;

  if old.status = 'accepted'
     and (new.title, new.description, new.object_id, new.assignee_id)
         is distinct from (old.title, old.description, old.object_id, old.assignee_id) then
    raise exception 'Принятую задачу изменить нельзя' using errcode = '42501';
  end if;

  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end
$$;

create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- Первая запись истории: «— → Новая».
create function public.tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_history (task_id, from_status, to_status, changed_by)
  values (new.id, null, new.status, new.author_id);
  return null;
end
$$;

create trigger tasks_after_insert
  after insert on public.tasks
  for each row execute function public.tasks_after_insert();

-- История только дополняется. Изменить запись нельзя никому, даже владельцу базы.
-- Удалить можно только вместе с задачей (каскадом): прямой DELETE отклоняется.
create function public.task_history_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.changed_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Историю статусов изменить нельзя' using errcode = '42501';
  end if;

  -- При каскадном удалении задачи этот триггер вызывается изнутри триггера внешнего ключа (глубина 2).
  if pg_trigger_depth() < 2 then
    raise exception 'Историю статусов удалить нельзя' using errcode = '42501';
  end if;
  return old;
end
$$;

create trigger task_history_guard
  before insert or update or delete on public.task_history
  for each row execute function public.task_history_guard();

create trigger task_history_no_truncate
  before truncate on public.task_history
  for each statement execute function public.task_history_guard();

-- Единственный способ сменить статус. Проверяет роль, исполнителя, переход и комментарий,
-- меняет статус и пишет историю в одной транзакции.
create function public.change_task_status(
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_task public.tasks;
  v_rule public.status_transitions;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;

  select * into v_task from public.tasks t where t.id = p_task_id for update;
  -- Про чужую задачу исполнитель получает тот же ответ, что и про несуществующую.
  if not found or (v_role = 'executor' and v_task.assignee_id <> v_uid) then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  select * into v_rule
  from public.status_transitions st
  where st.from_status = v_task.status and st.to_status = p_to_status;

  if not found or v_rule.actor <> v_role then
    raise exception 'Переход «%» → «%» вам недоступен',
      public.status_label(v_task.status), public.status_label(p_to_status)
      using errcode = '42501';
  end if;

  if v_rule.comment_required and v_comment is null then
    raise exception 'Для этого действия нужен комментарий' using errcode = '23514';
  end if;

  perform set_config('app.status_change', 'on', true);
  update public.tasks set status = p_to_status where id = p_task_id returning * into v_task;
  perform set_config('app.status_change', '', true);

  insert into public.task_history (task_id, from_status, to_status, comment, changed_by)
  values (v_task.id, v_rule.from_status, p_to_status, v_comment, v_uid);

  return v_task;
end
$$;

-- Вызывать функции через API могут только вошедшие пользователи.
revoke execute on function public.change_task_status(uuid, public.task_status, text) from public, anon;
grant execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;
revoke execute on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tasks_before_write() from public, anon, authenticated;
revoke execute on function public.tasks_after_insert() from public, anon, authenticated;
revoke execute on function public.task_history_guard() from public, anon, authenticated;
