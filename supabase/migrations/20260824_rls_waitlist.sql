-- Fecha a leitura anônima da waitlist.
--
-- Contexto: a anon key do projeto está hardcoded em app.js e o repositório é
-- público, então qualquer pessoa consegue fazer GET /rest/v1/waitlist e ler os
-- e-mails cadastrados. Verificado em 2026-08-22: a chamada retorna 200 com os
-- registros. São dados pessoais de terceiros — precisa fechar antes de o app
-- ser distribuído para compradores.
--
-- A landing continua conseguindo CADASTRAR e-mails (insert anônimo segue
-- liberado); o que deixa de funcionar é qualquer um LER a lista.

-- ---------------------------------------------------------------------------
-- PARTE 1 — waitlist: pode escrever, não pode ler
-- ---------------------------------------------------------------------------

alter table public.waitlist enable row level security;

-- Remove políticas antigas com estes nomes, para a migration ser reaplicável
drop policy if exists "waitlist_anon_insert"  on public.waitlist;
drop policy if exists "waitlist_anon_select"  on public.waitlist;
drop policy if exists "waitlist_auth_select"  on public.waitlist;

-- A landing precisa continuar inserindo o e-mail de quem se cadastra.
create policy "waitlist_anon_insert"
  on public.waitlist
  for insert
  to anon
  with check (true);

-- Leitura apenas para usuários autenticados (o seu dashboard, depois de logar).
-- A role anon deixa de conseguir ler: nenhuma policy de select para ela.
create policy "waitlist_auth_select"
  on public.waitlist
  for select
  to authenticated
  using (true);

-- Nota: a role `service_role` ignora RLS por padrão, então qualquer backend
-- seu que use a service key continua com acesso total.


-- ---------------------------------------------------------------------------
-- PARTE 2 — analytics_events (LEIA ANTES DE APLICAR)
-- ---------------------------------------------------------------------------
--
-- ATENÇÃO: aplicar a Parte 2 QUEBRA o dashboard de analytics enquanto ele
-- estiver lendo com a anon key (app.js, loadRealData()). Só aplique quando o
-- dashboard já autenticar, ou quando ele tiver sido separado deste projeto.
--
-- O mesmo problema existe aqui: analytics_events guarda user_id, anon_id e um
-- campo properties em jsonb que pode conter qualquer coisa — inclusive dado
-- pessoal — e hoje é legível por qualquer um com a anon key.
--
-- Para aplicar, descomente o bloco abaixo:
--
-- alter table public.analytics_events enable row level security;
--
-- drop policy if exists "analytics_anon_insert" on public.analytics_events;
-- drop policy if exists "analytics_auth_select" on public.analytics_events;
--
-- -- O app iOS e a landing precisam continuar escrevendo eventos.
-- create policy "analytics_anon_insert"
--   on public.analytics_events
--   for insert
--   to anon
--   with check (true);
--
-- -- Leitura só autenticada.
-- create policy "analytics_auth_select"
--   on public.analytics_events
--   for select
--   to authenticated
--   using (true);
