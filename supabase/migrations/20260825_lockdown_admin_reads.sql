-- ============================================================================
-- FECHA A LEITURA AMPLA DE USUÁRIO AUTENTICADO + ENDURECE O INSERT ANÔNIMO
--
-- Problema encontrado no audit de 2026-08-24:
--
--   As policies de select da waitlist e de analytics_events usavam
--   `to authenticated using (true)`. Como o cadastro por e-mail é aberto,
--   QUALQUER pessoa que criasse uma conta passava a ler a waitlist inteira
--   (e-mails de terceiros) e todos os analytics_events (user_id, anon_id e o
--   jsonb `properties`, que pode conter dado pessoal).
--
--   "authenticated" não é o mesmo que "eu". Leitura desses dados agora é só
--   para admin explicitamente cadastrado em public.admins.
--
-- O que NÃO muda:
--   - a landing continua inserindo e-mail na waitlist anonimamente;
--   - o app e a landing continuam registrando eventos anonimamente;
--   - public.projects já era dono-ou-nada e fica como está.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Quem é admin
--    Tabela sem NENHUMA policy: invisível pela API REST para anon e para
--    authenticated. Só service_role (que ignora RLS) e o SQL editor mexem
--    aqui — de propósito, para ninguém conseguir se auto-promover.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

revoke all on table public.admins from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Helper de checagem
--    security definer para ler public.admins sem esbarrar no RLS dela e sem
--    recursão de policy. search_path fixo para não ser sequestrado.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. waitlist
--    Ler: só admin. Escrever: anon continua podendo, agora com validação —
--    antes o `with check (true)` aceitava qualquer string em qualquer campo.
-- ---------------------------------------------------------------------------
alter table public.waitlist enable row level security;

drop policy if exists "waitlist_anon_select"  on public.waitlist;
drop policy if exists "waitlist_auth_select"  on public.waitlist;
drop policy if exists "waitlist_admin_select" on public.waitlist;

create policy "waitlist_admin_select"
  on public.waitlist for select
  to authenticated
  using (public.is_admin());

drop policy if exists "waitlist_anon_insert" on public.waitlist;

create policy "waitlist_anon_insert"
  on public.waitlist for insert
  to anon
  with check (
    email is not null
    and length(email) between 6 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and (source     is null or length(source)     <= 64)
    and (user_agent is null or length(user_agent) <= 512)
  );


-- ---------------------------------------------------------------------------
-- 4. analytics_events
--    Ler: só admin. Escrever: anon continua podendo, com teto de tamanho para
--    a chave pública não virar storage grátis para qualquer um.
--
--    Havia DUAS policies de insert anônimo fazendo a mesma coisa
--    ("analytics_anon_insert" e "anon pode registrar eventos"); ficou uma.
--
--    `platform` é nullable e não tem default no banco: o check precisa aceitar
--    null, senão quebra quem já escreve sem mandar o campo.
-- ---------------------------------------------------------------------------
alter table public.analytics_events enable row level security;

drop policy if exists "analytics_auth_select"  on public.analytics_events;
drop policy if exists "analytics_admin_select" on public.analytics_events;

create policy "analytics_admin_select"
  on public.analytics_events for select
  to authenticated
  using (public.is_admin());

drop policy if exists "anon pode registrar eventos" on public.analytics_events;
drop policy if exists "analytics_anon_insert"       on public.analytics_events;

create policy "analytics_anon_insert"
  on public.analytics_events for insert
  to anon
  with check (
    event is not null
    and length(event) <= 64
    and (step        is null or length(step)        <= 64)
    and (user_id     is null or length(user_id)     <= 128)
    and (anon_id     is null or length(anon_id)     <= 128)
    and (app_version is null or length(app_version) <= 32)
    and (platform    is null or length(platform)    <= 32)
    and pg_column_size(properties) <= 4096
  );

-- Nota: isto limita o TAMANHO do abuso, não a FREQUÊNCIA. Rate limit de
-- verdade (por IP) precisa de Edge Function na frente do insert — fora do
-- alcance de RLS.


-- ---------------------------------------------------------------------------
-- 5. get_waitlist_count(): contagem pública sem expor e-mail
--    Reforça os grants, caso tenham sido afrouxados no dashboard.
-- ---------------------------------------------------------------------------
revoke all on function public.get_waitlist_count() from public, anon;
grant execute on function public.get_waitlist_count() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Semeia o admin
--    insert..select: não faz nada se o e-mail ainda não tiver conta criada.
--    Para promover alguém depois, rode no SQL editor:
--      insert into public.admins (user_id, note)
--      select id, 'motivo' from auth.users where email = 'fulano@exemplo.com'
--      on conflict (user_id) do nothing;
-- ---------------------------------------------------------------------------
insert into public.admins (user_id, note)
select id, 'dono do projeto (seed da migration 20260824180000)'
from auth.users
where email in ('dedsfelps3@gmail.com', 'dedsfelps2@gmail.com')
on conflict (user_id) do nothing;
