begin;

-- Settings are changed by the project owner, never by browser callers.
create table if not exists public.ai_usage_settings (
    id boolean primary key default true check (id),
    requests_per_minute integer not null default 6 check (requests_per_minute between 1 and 1000),
    requests_per_day integer not null default 50 check (requests_per_day between 1 and 100000),
    max_concurrent integer not null default 2 check (max_concurrent between 1 and 20)
);
insert into public.ai_usage_settings (id) values (true) on conflict (id) do nothing;

-- Lock one row per user, so admission is serialized across both functions and
-- across all Edge Function instances without holding a lock during AI calls.
create table if not exists public.ai_usage_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.ai_usage_tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    task_type text not null check (task_type in ('study-assistant', 'analyze-course-file')),
    started_at timestamptz not null,
    expires_at timestamptz not null,
    finished_at timestamptz,
    outcome text check (outcome in ('succeeded', 'failed')),
    check (expires_at > started_at),
    check ((finished_at is null) = (outcome is null))
);
create index if not exists ai_usage_tasks_user_started_idx
    on public.ai_usage_tasks (user_id, started_at desc);
create index if not exists ai_usage_tasks_active_idx
    on public.ai_usage_tasks (user_id, expires_at) where finished_at is null;

alter table public.ai_usage_settings enable row level security;
alter table public.ai_usage_accounts enable row level security;
alter table public.ai_usage_tasks enable row level security;
revoke all on public.ai_usage_settings, public.ai_usage_accounts, public.ai_usage_tasks
    from public, anon, authenticated;
grant select, insert, update, delete on public.ai_usage_settings, public.ai_usage_accounts, public.ai_usage_tasks
    to service_role;

create or replace function public.reserve_ai_task(p_user_id uuid, p_task_type text, p_lease_seconds integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    limits public.ai_usage_settings%rowtype;
    current_time_utc timestamptz;
    day_start timestamptz;
    minute_count integer;
    day_count integer;
    active_count integer;
    earliest_minute timestamptz;
    earliest_expiry timestamptz;
    task_id uuid;
begin
    if p_user_id is null or p_task_type is null or
       p_task_type not in ('study-assistant', 'analyze-course-file') or
       p_lease_seconds is null or p_lease_seconds not between 30 and 150 then
        raise exception 'Invalid AI task reservation';
    end if;

    insert into public.ai_usage_accounts (user_id) values (p_user_id)
        on conflict (user_id) do nothing;
    perform 1 from public.ai_usage_accounts where user_id = p_user_id for update;
    current_time_utc := clock_timestamp();
    day_start := date_trunc('day', current_time_utc at time zone 'UTC') at time zone 'UTC';
    select * into strict limits from public.ai_usage_settings where id = true;

    -- Bound history storage per returning user; completed and expired tasks
    -- still count toward quotas until they age out of the relevant window.
    delete from public.ai_usage_tasks
        where user_id = p_user_id and started_at < current_time_utc - interval '2 days';

    select count(*), min(expires_at) into active_count, earliest_expiry
        from public.ai_usage_tasks
        where user_id = p_user_id and finished_at is null and expires_at > current_time_utc;
    if active_count >= limits.max_concurrent then
        return jsonb_build_object('allowed', false, 'reason', 'concurrent_limit',
            'retry_after', greatest(1, ceil(extract(epoch from earliest_expiry - current_time_utc))::integer));
    end if;

    select count(*), min(started_at) into minute_count, earliest_minute
        from public.ai_usage_tasks
        where user_id = p_user_id and started_at > current_time_utc - interval '60 seconds';
    if minute_count >= limits.requests_per_minute then
        return jsonb_build_object('allowed', false, 'reason', 'minute_limit',
            'retry_after', greatest(1, ceil(extract(epoch from earliest_minute + interval '60 seconds' - current_time_utc))::integer));
    end if;

    select count(*) into day_count from public.ai_usage_tasks
        where user_id = p_user_id and started_at >= day_start;
    if day_count >= limits.requests_per_day then
        return jsonb_build_object('allowed', false, 'reason', 'daily_limit',
            'retry_after', greatest(1, ceil(extract(epoch from day_start + interval '1 day' - current_time_utc))::integer));
    end if;

    insert into public.ai_usage_tasks (user_id, task_type, started_at, expires_at)
        values (p_user_id, p_task_type, current_time_utc,
            current_time_utc + make_interval(secs => p_lease_seconds)) returning id into task_id;
    return jsonb_build_object('allowed', true, 'task_id', task_id,
        'remaining_minute', limits.requests_per_minute - minute_count - 1,
        'remaining_day', limits.requests_per_day - day_count - 1);
end;
$$;

create or replace function public.finish_ai_task(p_user_id uuid, p_task_id uuid, p_outcome text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
    if p_outcome is null or p_outcome not in ('succeeded', 'failed') then
        raise exception 'Invalid AI task outcome';
    end if;
    -- Idempotent release; finishing never refunds usage or releases another user's task.
    update public.ai_usage_tasks set finished_at = clock_timestamp(), outcome = p_outcome
        where id = p_task_id and user_id = p_user_id and finished_at is null;
end;
$$;

revoke all on function public.reserve_ai_task(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finish_ai_task(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_task(uuid, text, integer) to service_role;
grant execute on function public.finish_ai_task(uuid, uuid, text) to service_role;

commit;
