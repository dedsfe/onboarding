begin;

create table public.carousel_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  x_handle text not null,
  created_at timestamptz not null default now(),
  constraint carousel_waitlist_email_valid check (
    email = lower(btrim(email))
    and char_length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint carousel_waitlist_x_valid check (
    x_handle ~ '^[A-Za-z0-9_]{1,15}$'
  )
);

alter table public.carousel_waitlist enable row level security;

revoke all on table public.carousel_waitlist
  from public, anon, authenticated, service_role;
grant select, insert on table public.carousel_waitlist to service_role;

commit;
