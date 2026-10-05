create table if not exists public.feedback_requests (
    id uuid primary key default gen_random_uuid(),
    message text not null check (char_length(btrim(message)) between 1 and 3000),
    created_at timestamptz not null default now()
);

alter table public.feedback_requests enable row level security;
revoke all on public.feedback_requests from anon, authenticated;
grant insert (message) on public.feedback_requests to anon, authenticated;

create policy "Visitors can submit feedback"
    on public.feedback_requests for insert to anon, authenticated
    with check (char_length(btrim(message)) between 1 and 3000);
