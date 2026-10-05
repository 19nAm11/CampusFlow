create table if not exists public.saved_quizzes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    title text not null,
    questions jsonb not null,
    answers jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint saved_quizzes_questions_array check (jsonb_typeof(questions) = 'array'),
    constraint saved_quizzes_answers_object check (jsonb_typeof(answers) = 'object')
);

create index if not exists saved_quizzes_user_created_idx
    on public.saved_quizzes (user_id, created_at desc);

alter table public.saved_quizzes enable row level security;

grant select, insert, update, delete on public.saved_quizzes to authenticated;
revoke all on public.saved_quizzes from anon;

create policy "Users can read their own quizzes"
    on public.saved_quizzes for select to authenticated
    using ((select auth.uid()) = user_id);

create policy "Users can create their own quizzes"
    on public.saved_quizzes for insert to authenticated
    with check ((select auth.uid()) = user_id);

create policy "Users can update their own quizzes"
    on public.saved_quizzes for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create policy "Users can delete their own quizzes"
    on public.saved_quizzes for delete to authenticated
    using ((select auth.uid()) = user_id);
