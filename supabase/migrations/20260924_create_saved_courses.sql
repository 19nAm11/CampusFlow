create table if not exists public.saved_courses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    course_name text not null,
    schedule text,
    course_period text,
    key_points jsonb not null default '[]'::jsonb,
    small_details jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint saved_courses_user_course_unique unique (user_id, course_name),
    constraint saved_courses_key_points_array check (jsonb_typeof(key_points) = 'array'),
    constraint saved_courses_small_details_array check (jsonb_typeof(small_details) = 'array')
);

create index if not exists saved_courses_user_created_idx
    on public.saved_courses (user_id, created_at desc);

alter table public.saved_courses enable row level security;

grant select, insert, update, delete on public.saved_courses to authenticated;
revoke all on public.saved_courses from anon;

create policy "Users can read their saved courses"
    on public.saved_courses for select to authenticated
    using ((select auth.uid()) = user_id);

create policy "Users can save their own courses"
    on public.saved_courses for insert to authenticated
    with check ((select auth.uid()) = user_id);

create policy "Users can update their saved courses"
    on public.saved_courses for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create policy "Users can delete their saved courses"
    on public.saved_courses for delete to authenticated
    using ((select auth.uid()) = user_id);
