create table if not exists public.saved_conversations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 120),
    messages jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint saved_conversations_messages_array check (jsonb_typeof(messages) = 'array'),
    constraint saved_conversations_size check (octet_length(messages::text) <= 2097152)
);

create index if not exists saved_conversations_user_updated_idx
    on public.saved_conversations (user_id, updated_at desc);

alter table public.saved_conversations enable row level security;
revoke all on public.saved_conversations from anon;
grant select, insert, update, delete on public.saved_conversations to authenticated;

create policy "Users can read their own conversations"
    on public.saved_conversations for select to authenticated
    using ((select auth.uid()) = user_id);
create policy "Users can create their own conversations"
    on public.saved_conversations for insert to authenticated
    with check ((select auth.uid()) = user_id);
create policy "Users can update their own conversations"
    on public.saved_conversations for update to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own conversations"
    on public.saved_conversations for delete to authenticated
    using ((select auth.uid()) = user_id);
