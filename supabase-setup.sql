/*
Dashboard setup steps (in this exact order):
1. Open Supabase Dashboard > SQL Editor > New query, paste this entire file, and click Run.
2. Open Authentication > Providers > Anonymous Sign-Ins and enable anonymous sign-ins.
3. Open Authentication > Users > Add user, create segmaf@outlook.com, and set a strong password.
4. Return to SQL Editor and run this final insert only after that user exists:

insert into private.app_admins (user_id)
select id from auth.users where lower(email) = 'segmaf@outlook.com'
on conflict (user_id) do nothing;
*/

begin;

create schema if not exists private;

create table if not exists private.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

comment on table private.app_admins is
  'Auth user UUID allowlist. Manage only from the SQL Editor or another trusted server context.';

create table if not exists public.solicitacoes (
  id bigint generated always as identity primary key,
  legacy_id bigint unique,
  owner_id uuid not null references auth.users (id) on delete restrict,
  criado_em timestamptz not null default now(),
  nome varchar(120),
  email varchar(120),
  telefone varchar(40),
  cidade varchar(120),
  endereco varchar(255),
  latitude double precision,
  longitude double precision,
  assunto varchar(120),
  mensagem text,
  lido boolean not null default false,
  atendido boolean not null default false,
  enviada boolean not null default false,
  constraint solicitacoes_latitude_check
    check (latitude is null or latitude between -90 and 90),
  constraint solicitacoes_longitude_check
    check (longitude is null or longitude between -180 and 180)
);

drop index if exists public.solicitacoes_um_rascunho_por_owner;
create index if not exists solicitacoes_criado_em_idx
  on public.solicitacoes (criado_em desc);
create index if not exists solicitacoes_nao_lidas_idx
  on public.solicitacoes (id) where not lido and enviada;

create table if not exists public.anexos (
  id uuid primary key default gen_random_uuid(),
  legacy_id bigint unique,
  solicitacao_id bigint not null references public.solicitacoes (id) on delete cascade,
  nome_arquivo varchar(255) not null,
  mime_type varchar(120) not null,
  tamanho bigint not null,
  storage_path text not null unique,
  constraint anexos_tamanho_check check (tamanho > 0 and tamanho <= 5242880),
  constraint anexos_mime_check
    check (lower(mime_type) in (
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'
    ))
);

create index if not exists anexos_solicitacao_id_idx
  on public.anexos (solicitacao_id);

create table if not exists public.metas (
  chave varchar(50) primary key,
  valor bigint not null default 0,
  constraint metas_valor_check check (valor >= 0)
);

insert into public.metas (chave, valor)
values ('atendidos_total', 0)
on conflict (chave) do nothing;

create table if not exists public.imagens (
  chave varchar(50) primary key,
  storage_path text unique,
  nome varchar(255),
  mime varchar(120),
  tamanho bigint,
  atualizada_em timestamptz,
  constraint imagens_chave_check check (chave in (
    'limpeza-paineis-solares',
    'limpeza-pos-obras',
    'capina-quimica-usina-solar',
    'capina-corporativa',
    'rocagem-usina-solar',
    'pulverizacao-area-irrigada',
    'captura-de-abelhas',
    'limpeza-cercamento-aceiros'
  )),
  constraint imagens_path_check
    check (storage_path is null or storage_path like chave || '/%'),
  constraint imagens_mime_check
    check (mime is null or lower(mime) like 'image/%'),
  constraint imagens_tamanho_check
    check (tamanho is null or tamanho between 1 and 3145728),
  constraint imagens_metadados_check check (
    (storage_path is null and nome is null and mime is null and tamanho is null)
    or
    (storage_path is not null and nome is not null and mime is not null and tamanho is not null)
  )
);

insert into public.imagens (chave)
values
  ('limpeza-paineis-solares'),
  ('limpeza-pos-obras'),
  ('capina-quimica-usina-solar'),
  ('capina-corporativa'),
  ('rocagem-usina-solar'),
  ('pulverizacao-area-irrigada'),
  ('captura-de-abelhas'),
  ('limpeza-cercamento-aceiros')
on conflict (chave) do nothing;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1 from private.app_admins a where a.user_id = auth.uid()
    );
$$;

create or replace function private.is_anonymous_user()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

create or replace function private.pode_ler_anexo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.anexos a
    join public.solicitacoes s on s.id = a.solicitacao_id
    where a.storage_path = p_path and s.owner_id = auth.uid() and not s.enviada
  );
$$;

create or replace function private.pode_gerenciar_anexo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.anexos a
    join public.solicitacoes s on s.id = a.solicitacao_id
    where a.storage_path = p_path
      and s.owner_id = auth.uid()
      and not s.enviada
  );
$$;

create or replace function private.pode_enviar_anexo(
  p_path text,
  p_tamanho bigint,
  p_mime text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.anexos a
    join public.solicitacoes s on s.id = a.solicitacao_id
    where a.storage_path = p_path
      and a.tamanho = p_tamanho
      and lower(a.mime_type) = lower(p_mime)
      and s.owner_id = auth.uid()
      and not s.enviada
  );
$$;

create or replace function private.atualizar_contador_atendidos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta bigint := 0;
begin
  if tg_op = 'INSERT' and new.atendido then
    v_delta := 1;
  elsif tg_op = 'UPDATE' and new.atendido is distinct from old.atendido then
    v_delta := case when new.atendido then 1 else -1 end;
  end if;

  if v_delta <> 0 then
    insert into public.metas (chave, valor)
    values ('atendidos_total', greatest(v_delta, 0))
    on conflict (chave) do update
      set valor = greatest(public.metas.valor + v_delta, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists solicitacoes_contador_atendidos on public.solicitacoes;
create trigger solicitacoes_contador_atendidos
after insert or update of atendido on public.solicitacoes
for each row execute function private.atualizar_contador_atendidos();

create or replace function private.marcar_imagem_atualizada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.atualizada_em := case when new.storage_path is null then null else now() end;
  elsif new.storage_path is distinct from old.storage_path
     or new.nome is distinct from old.nome
     or new.mime is distinct from old.mime
     or new.tamanho is distinct from old.tamanho then
    new.atualizada_em := case when new.storage_path is null then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists imagens_atualizada_em on public.imagens;
create trigger imagens_atualizada_em
before insert or update on public.imagens
for each row execute function private.marcar_imagem_atualizada();

create or replace function private.impedir_storage_orfao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'anexos' and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'anexos' and o.name = old.storage_path
  ) then
    raise exception 'Delete the attachment through the Storage API before deleting its metadata'
      using errcode = '55000';
  end if;

  if tg_table_name = 'imagens' and old.storage_path is not null then
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.storage_path is distinct from old.storage_path) then
      if exists (
        select 1 from storage.objects o
        where o.bucket_id = 'imagens-cards' and o.name = old.storage_path
      ) then
        raise exception 'Delete the old card image through the Storage API before changing its metadata'
          using errcode = '55000';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists anexos_impedir_storage_orfao on public.anexos;
create trigger anexos_impedir_storage_orfao
before delete on public.anexos
for each row execute function private.impedir_storage_orfao();

drop trigger if exists imagens_impedir_storage_orfao on public.imagens;
create trigger imagens_impedir_storage_orfao
before update or delete on public.imagens
for each row execute function private.impedir_storage_orfao();

create or replace function public.criar_rascunho(
  p_nome text,
  p_email text,
  p_assunto text,
  p_mensagem text,
  p_telefone text default null,
  p_cidade text default null,
  p_endereco text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not (private.is_anonymous_user() or private.is_admin()) then
    raise exception 'Anonymous authentication is required' using errcode = '42501';
  end if;
  if nullif(btrim(p_nome), '') is null
     or nullif(btrim(p_email), '') is null
     or nullif(btrim(p_assunto), '') is null
     or nullif(btrim(p_mensagem), '') is null then
    raise exception 'nome, email, assunto and mensagem are required' using errcode = '22023';
  end if;
  if length(btrim(p_nome)) > 120 or length(btrim(p_email)) > 120
     or length(btrim(p_assunto)) > 120 or length(p_mensagem) > 10000
     or length(coalesce(btrim(p_telefone), '')) > 40
     or length(coalesce(btrim(p_cidade), '')) > 120
     or length(coalesce(btrim(p_endereco), '')) > 255 then
    raise exception 'One or more fields exceed their maximum length' using errcode = '22001';
  end if;
  if p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if not private.is_admin()
     and (select count(*) from public.solicitacoes where owner_id = auth.uid() and not enviada) >= 3 then
    raise exception 'Too many unfinished requests. Try again later' using errcode = '54000';
  end if;
  if not private.is_admin()
     and (select count(*) from public.solicitacoes where owner_id = auth.uid() and enviada and criado_em > now() - interval '24 hours') >= 10 then
    raise exception 'Daily request limit reached' using errcode = '54000';
  end if;

  insert into public.solicitacoes (
    owner_id, nome, email, telefone, cidade, endereco,
    latitude, longitude, assunto, mensagem
  ) values (
    auth.uid(), btrim(p_nome), lower(btrim(p_email)), nullif(btrim(p_telefone), ''),
    nullif(btrim(p_cidade), ''), nullif(btrim(p_endereco), ''),
    p_latitude, p_longitude, btrim(p_assunto), btrim(p_mensagem)
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.reservar_anexo(
  p_solicitacao_id bigint,
  p_nome_arquivo text,
  p_mime_type text,
  p_tamanho bigint
)
returns table (anexo_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_enviada boolean;
  v_count integer;
  v_total bigint;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_mime text := lower(btrim(p_mime_type));
begin
  if not (private.is_anonymous_user() or private.is_admin()) then
    raise exception 'Anonymous authentication is required' using errcode = '42501';
  end if;

  select s.owner_id, s.enviada into v_owner, v_enviada
  from public.solicitacoes s where s.id = p_solicitacao_id for update;
  if not found or v_owner <> auth.uid() then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if v_enviada then
    raise exception 'The request has already been finalized' using errcode = '22023';
  end if;
  if nullif(btrim(p_nome_arquivo), '') is null or length(btrim(p_nome_arquivo)) > 255 then
    raise exception 'Invalid original file name' using errcode = '22023';
  end if;
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif') then
    raise exception 'Only images and PDF files are accepted' using errcode = '22023';
  end if;
  if p_tamanho is null or p_tamanho <= 0 or p_tamanho > 5242880 then
    raise exception 'Invalid attachment size' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(a.tamanho), 0)
    into v_count, v_total
  from public.anexos a where a.solicitacao_id = p_solicitacao_id;
  if v_count >= 3 or v_total + p_tamanho > 5242880 then
    raise exception 'Maximum 3 attachments and 5 MB total' using errcode = '22023';
  end if;

  v_path := auth.uid()::text || '/' || p_solicitacao_id::text || '/' || v_id::text;
  insert into public.anexos (
    id, solicitacao_id, nome_arquivo, mime_type, tamanho, storage_path
  ) values (
    v_id, p_solicitacao_id, btrim(p_nome_arquivo), v_mime, p_tamanho, v_path
  );

  return query select v_id, v_path;
end;
$$;

create or replace function public.finalizar_solicitacao(p_solicitacao_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_enviada boolean;
  v_reservados integer;
  v_presentes integer;
  v_total bigint;
  v_invalidos integer;
begin
  if not (private.is_anonymous_user() or private.is_admin()) then
    raise exception 'Anonymous authentication is required' using errcode = '42501';
  end if;

  select s.owner_id, s.enviada into v_owner, v_enviada
  from public.solicitacoes s where s.id = p_solicitacao_id for update;
  if not found or v_owner <> auth.uid() then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if v_enviada then
    return p_solicitacao_id;
  end if;

  select count(*) into v_reservados
  from public.anexos a where a.solicitacao_id = p_solicitacao_id;

  select count(*), coalesce(sum((o.metadata ->> 'size')::bigint), 0),
         count(*) filter (where
           coalesce((o.metadata ->> 'size')::bigint, -1) <> a.tamanho
           or lower(coalesce(o.metadata ->> 'mimetype', '')) <> lower(a.mime_type)
         )
    into v_presentes, v_total, v_invalidos
  from public.anexos a
  join storage.objects o
    on o.bucket_id = 'anexos' and o.name = a.storage_path
  where a.solicitacao_id = p_solicitacao_id;

  if v_presentes <> v_reservados or v_invalidos <> 0 or v_total > 5242880 then
    raise exception 'Attachments are missing or do not match their reservations' using errcode = '22023';
  end if;

  update public.solicitacoes set enviada = true where id = p_solicitacao_id;
  return p_solicitacao_id;
end;
$$;

create or replace function public.limpar_rascunho(p_solicitacao_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_enviada boolean;
begin
  if not (private.is_anonymous_user() or private.is_admin()) then
    raise exception 'Anonymous authentication is required' using errcode = '42501';
  end if;
  select s.owner_id, s.enviada into v_owner, v_enviada
  from public.solicitacoes s where s.id = p_solicitacao_id for update;
  if not found or v_owner <> auth.uid() then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if v_enviada then
    raise exception 'A finalized request cannot be cleaned up by its submitter' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.anexos a
    join storage.objects o on o.bucket_id = 'anexos' and o.name = a.storage_path
    where a.solicitacao_id = p_solicitacao_id
  ) then
    raise exception 'Delete uploaded objects through the Storage API before cleanup' using errcode = '55000';
  end if;
  delete from public.solicitacoes where id = p_solicitacao_id;
  return true;
end;
$$;

create or replace function public.contadores_publicos()
returns table (atendidos bigint, nao_lidos bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select m.valor from public.metas m where m.chave = 'atendidos_total'), 0),
    (select count(*) from public.solicitacoes s where s.enviada and not s.lido);
$$;

create or replace function public.admin_recalcular_atendidos()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_total bigint;
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select count(*) into v_total from public.solicitacoes where enviada and atendido;
  insert into public.metas (chave, valor) values ('atendidos_total', v_total)
  on conflict (chave) do update set valor = excluded.valor;
  return v_total;
end;
$$;

create or replace function public.admin_definir_atendidos(p_valor bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'Counter must be zero or greater' using errcode = '22023';
  end if;
  insert into public.metas (chave, valor) values ('atendidos_total', p_valor)
  on conflict (chave) do update set valor = excluded.valor;
  return p_valor;
end;
$$;

create or replace function public.admin_zerar_atendidos()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  insert into public.metas (chave, valor) values ('atendidos_total', 0)
  on conflict (chave) do update set valor = 0;
  return 0;
end;
$$;

create or replace function public.admin_importar_solicitacoes(p_registros jsonb)
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registro jsonb;
  v_id bigint;
  v_ids bigint[] := '{}'::bigint[];
  v_legacy_id bigint;
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_registros is null or jsonb_typeof(p_registros) <> 'array'
     or jsonb_array_length(p_registros) > 1000 then
    raise exception 'Expected an array of at most 1000 records' using errcode = '22023';
  end if;

  for v_registro in select value from jsonb_array_elements(p_registros)
  loop
    v_legacy_id := coalesce(
      nullif(v_registro ->> 'legacy_id', ''),
      nullif(v_registro ->> 'id', '')
    )::bigint;
    if v_legacy_id is null then
      raise exception 'Every imported record requires legacy_id' using errcode = '22023';
    end if;

    insert into public.solicitacoes (
      legacy_id, owner_id, criado_em, nome, email, telefone, cidade, endereco,
      latitude, longitude, assunto, mensagem, lido, atendido, enviada
    ) values (
      v_legacy_id,
      auth.uid(),
      coalesce(nullif(v_registro ->> 'criado_em', '')::timestamptz, now()),
      nullif(v_registro ->> 'nome', ''),
      nullif(v_registro ->> 'email', ''),
      nullif(v_registro ->> 'telefone', ''),
      nullif(v_registro ->> 'cidade', ''),
      nullif(v_registro ->> 'endereco', ''),
      nullif(v_registro ->> 'latitude', '')::double precision,
      nullif(v_registro ->> 'longitude', '')::double precision,
      nullif(v_registro ->> 'assunto', ''),
      nullif(v_registro ->> 'mensagem', ''),
      coalesce((v_registro ->> 'lido')::boolean, false),
      coalesce((v_registro ->> 'atendido')::boolean, false),
      true
    )
    on conflict (legacy_id) do update set
      criado_em = excluded.criado_em,
      nome = excluded.nome,
      email = excluded.email,
      telefone = excluded.telefone,
      cidade = excluded.cidade,
      endereco = excluded.endereco,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      assunto = excluded.assunto,
      mensagem = excluded.mensagem,
      lido = excluded.lido,
      atendido = excluded.atendido,
      enviada = true
    returning id into v_id;
    v_ids := array_append(v_ids, v_id);
  end loop;
  return v_ids;
end;
$$;

create or replace function public.admin_reservar_anexo_importado(
  p_solicitacao_id bigint,
  p_legacy_id bigint,
  p_nome_arquivo text,
  p_mime_type text,
  p_tamanho bigint
)
returns table (anexo_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_path text;
  v_count integer;
  v_total bigint;
  v_existente public.anexos%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_legacy_id is null or p_legacy_id < 1 then
    raise exception 'A valid legacy attachment id is required' using errcode = '22023';
  end if;

  select * into v_existente from public.anexos where legacy_id = p_legacy_id;
  if found then
    return query select v_existente.id, v_existente.storage_path;
    return;
  end if;
  if not exists (select 1 from public.solicitacoes where id = p_solicitacao_id and enviada) then
    raise exception 'Finalized request not found' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_nome_arquivo), '') is null or length(btrim(p_nome_arquivo)) > 255
     or lower(btrim(p_mime_type)) not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')
     or p_tamanho is null or p_tamanho <= 0 or p_tamanho > 5242880 then
    raise exception 'Invalid attachment metadata' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(tamanho), 0) into v_count, v_total
  from public.anexos where solicitacao_id = p_solicitacao_id;
  if v_count >= 3 or v_total + p_tamanho > 5242880 then
    raise exception 'Maximum 3 attachments and 5 MB total' using errcode = '22023';
  end if;

  v_path := 'importados/' || p_solicitacao_id::text || '/' || v_id::text;
  insert into public.anexos (
    id, legacy_id, solicitacao_id, nome_arquivo, mime_type, tamanho, storage_path
  ) values (
    v_id, p_legacy_id, p_solicitacao_id, btrim(p_nome_arquivo),
    lower(btrim(p_mime_type)), p_tamanho, v_path
  );
  return query select v_id, v_path;
end;
$$;

alter table public.solicitacoes enable row level security;
alter table public.anexos enable row level security;
alter table public.metas enable row level security;
alter table public.imagens enable row level security;
alter table private.app_admins enable row level security;

drop policy if exists solicitacoes_admin_select on public.solicitacoes;
create policy solicitacoes_admin_select on public.solicitacoes
for select to authenticated using (private.is_admin());
drop policy if exists solicitacoes_admin_update on public.solicitacoes;
create policy solicitacoes_admin_update on public.solicitacoes
for update to authenticated
using (private.is_admin())
with check (private.is_admin());
drop policy if exists solicitacoes_admin_delete on public.solicitacoes;
create policy solicitacoes_admin_delete on public.solicitacoes
for delete to authenticated using (private.is_admin());

drop policy if exists anexos_owner_admin_select on public.anexos;
create policy anexos_owner_admin_select on public.anexos
for select to authenticated using (private.pode_ler_anexo(storage_path));
drop policy if exists anexos_admin_delete on public.anexos;
create policy anexos_admin_delete on public.anexos
for delete to authenticated using (private.is_admin());

drop policy if exists metas_admin_select on public.metas;
create policy metas_admin_select on public.metas
for select to authenticated using (private.is_admin());

drop policy if exists imagens_public_select on public.imagens;
create policy imagens_public_select on public.imagens
for select to anon, authenticated using (true);
drop policy if exists imagens_admin_insert on public.imagens;
create policy imagens_admin_insert on public.imagens
for insert to authenticated with check (private.is_admin());
drop policy if exists imagens_admin_update on public.imagens;
create policy imagens_admin_update on public.imagens
for update to authenticated
using (private.is_admin())
with check (private.is_admin());
drop policy if exists imagens_admin_delete on public.imagens;
create policy imagens_admin_delete on public.imagens
for delete to authenticated using (private.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens-cards', 'imagens-cards', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists anexos_storage_select on storage.objects;
create policy anexos_storage_select on storage.objects
for select to authenticated
using (bucket_id = 'anexos' and private.pode_ler_anexo(name));
drop policy if exists anexos_storage_insert on storage.objects;
create policy anexos_storage_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'anexos' and private.pode_gerenciar_anexo(name));
drop policy if exists anexos_storage_update on storage.objects;
drop policy if exists anexos_storage_delete on storage.objects;
create policy anexos_storage_delete on storage.objects
for delete to authenticated
using (bucket_id = 'anexos' and private.pode_gerenciar_anexo(name));

drop policy if exists imagens_cards_public_select on storage.objects;
create policy imagens_cards_public_select on storage.objects
for select to anon, authenticated using (bucket_id = 'imagens-cards');
drop policy if exists imagens_cards_admin_insert on storage.objects;
create policy imagens_cards_admin_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'imagens-cards'
  and private.is_admin()
  and (storage.foldername(name))[1] in (
    'limpeza-paineis-solares', 'limpeza-pos-obras',
    'capina-quimica-usina-solar', 'capina-corporativa',
    'rocagem-usina-solar', 'pulverizacao-area-irrigada',
    'captura-de-abelhas', 'limpeza-cercamento-aceiros'
  )
);
drop policy if exists imagens_cards_admin_update on storage.objects;
create policy imagens_cards_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'imagens-cards' and private.is_admin())
with check (
  bucket_id = 'imagens-cards'
  and private.is_admin()
  and (storage.foldername(name))[1] in (
    'limpeza-paineis-solares', 'limpeza-pos-obras',
    'capina-quimica-usina-solar', 'capina-corporativa',
    'rocagem-usina-solar', 'pulverizacao-area-irrigada',
    'captura-de-abelhas', 'limpeza-cercamento-aceiros'
  )
);
drop policy if exists imagens_cards_admin_delete on storage.objects;
create policy imagens_cards_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'imagens-cards' and private.is_admin());

revoke all on table private.app_admins from anon, authenticated;
revoke all on table public.solicitacoes from anon, authenticated;
revoke all on table public.anexos from anon, authenticated;
revoke all on table public.metas from anon, authenticated;
revoke all on table public.imagens from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated;
grant select, delete on public.solicitacoes to authenticated;
grant update (lido, atendido) on public.solicitacoes to authenticated;
grant select, delete on public.anexos to authenticated;
grant select on public.metas to authenticated;
grant select on public.imagens to anon, authenticated;
grant insert, update, delete on public.imagens to authenticated;

revoke all on function private.is_admin() from public, anon, authenticated;
revoke all on function private.is_anonymous_user() from public, anon, authenticated;
revoke all on function private.pode_ler_anexo(text) from public, anon, authenticated;
revoke all on function private.pode_gerenciar_anexo(text) from public, anon, authenticated;
revoke all on function private.pode_enviar_anexo(text, bigint, text) from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_anonymous_user() to authenticated;
grant execute on function private.pode_ler_anexo(text) to authenticated;
grant execute on function private.pode_gerenciar_anexo(text) to authenticated;
grant execute on function private.pode_enviar_anexo(text, bigint, text) to authenticated;

revoke all on function public.criar_rascunho(text, text, text, text, text, text, text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.reservar_anexo(bigint, text, text, bigint) from public, anon, authenticated;
revoke all on function public.finalizar_solicitacao(bigint) from public, anon, authenticated;
revoke all on function public.limpar_rascunho(bigint) from public, anon, authenticated;
revoke all on function public.contadores_publicos() from public, anon, authenticated;
revoke all on function public.admin_recalcular_atendidos() from public, anon, authenticated;
revoke all on function public.admin_definir_atendidos(bigint) from public, anon, authenticated;
revoke all on function public.admin_zerar_atendidos() from public, anon, authenticated;
revoke all on function public.admin_importar_solicitacoes(jsonb) from public, anon, authenticated;
revoke all on function public.admin_reservar_anexo_importado(bigint, bigint, text, text, bigint) from public, anon, authenticated;

grant execute on function public.criar_rascunho(text, text, text, text, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.reservar_anexo(bigint, text, text, bigint) to authenticated;
grant execute on function public.finalizar_solicitacao(bigint) to authenticated;
grant execute on function public.limpar_rascunho(bigint) to authenticated;
grant execute on function public.contadores_publicos() to anon, authenticated;
grant execute on function public.admin_recalcular_atendidos() to authenticated;
grant execute on function public.admin_definir_atendidos(bigint) to authenticated;
grant execute on function public.admin_zerar_atendidos() to authenticated;
grant execute on function public.admin_importar_solicitacoes(jsonb) to authenticated;
grant execute on function public.admin_reservar_anexo_importado(bigint, bigint, text, text, bigint) to authenticated;

commit;
