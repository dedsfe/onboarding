-- ============================================================================
-- Fixa o search_path de public.touch_updated_at
--
-- Apontado pelo linter do Supabase (function_search_path_mutable).
-- Sem `set search_path`, a função resolve nomes usando o search_path de quem
-- disparou o trigger. Quem consegue criar objeto num schema que venha antes de
-- `public` pode fazer a função chamar outra coisa no lugar do que ela espera.
-- Aqui o corpo só usa now(), então o risco prático hoje é baixo — mas é o tipo
-- de coisa que só é barata de arrumar antes de a função crescer.
--
-- Recriada com o mesmo corpo; o trigger existente continua apontando para ela.
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
