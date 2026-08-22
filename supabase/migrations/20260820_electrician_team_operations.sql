-- Modulo Minha Equipe: cadastro solicitado, equipes, custodia, uso e medidores.
-- Todas as mutacoes operacionais passam por RPCs atomicos e auditaveis.

alter table public.profiles
  add column if not exists requested_role text,
  add column if not exists requested_base_id uuid references public.bases(id),
  add column if not exists employee_number text,
  add column if not exists requested_team_code text,
  add column if not exists requested_partner_name text,
  add column if not exists access_review_reason text,
  add column if not exists access_reviewed_by uuid references auth.users(id),
  add column if not exists access_reviewed_at timestamptz;

do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
    where conrelid='public.profiles'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I',v_constraint.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (role in ('consulta','almoxarife','aprovador','administrador','eletricista')),
  add constraint profiles_requested_role_check check (requested_role is null or requested_role in ('consulta','almoxarife','eletricista')),
  add constraint profiles_employee_number_check check (employee_number is null or char_length(btrim(employee_number)) between 1 and 40),
  add constraint profiles_team_code_check check (requested_team_code is null or char_length(btrim(requested_team_code)) between 1 and 60),
  add constraint profiles_partner_check check (requested_partner_name is null or char_length(btrim(requested_partner_name)) between 2 and 120),
  add constraint profiles_review_reason_check check (access_review_reason is null or char_length(btrim(access_review_reason)) between 5 and 1000);

create index if not exists profiles_requested_base_id_idx on public.profiles(requested_base_id);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  base_id uuid not null references public.bases(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_code_check check (char_length(btrim(code)) between 1 and 60),
  constraint teams_name_check check (char_length(btrim(name)) between 2 and 120)
);
create unique index if not exists teams_base_code_unique on public.teams(base_id,lower(btrim(code)));
create index if not exists teams_base_active_idx on public.teams(base_id,is_active);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_role text not null default 'integrante' check (membership_role in ('responsavel','integrante')),
  is_active boolean not null default true,
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists team_members_one_active_team on public.team_members(user_id) where is_active;
create unique index if not exists team_members_team_user_unique on public.team_members(team_id,user_id);
create index if not exists team_members_team_active_idx on public.team_members(team_id,is_active);

alter table public.material_requests add column if not exists team_id uuid references public.teams(id);
create index if not exists material_requests_team_id_idx on public.material_requests(team_id);

create table if not exists public.team_material_custody (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  base_id uuid not null references public.bases(id),
  material_id uuid not null references public.materials(id),
  source_request_id uuid references public.material_requests(id),
  source_request_item_id uuid references public.material_request_items(id),
  received_quantity numeric(14,3) not null check (received_quantity > 0),
  available_quantity numeric(14,3) not null check (available_quantity >= 0 and available_quantity <= received_quantity),
  received_at timestamptz not null default now(),
  received_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint team_material_custody_source_unique unique(source_request_item_id)
);
create index if not exists team_material_custody_team_material_idx on public.team_material_custody(team_id,material_id,received_at);
create index if not exists team_material_custody_base_idx on public.team_material_custody(base_id);

create sequence if not exists public.team_usage_protocol_seq;
create table if not exists public.team_material_usage (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique,
  team_id uuid not null references public.teams(id),
  base_id uuid not null references public.bases(id),
  material_id uuid not null references public.materials(id),
  quantity numeric(14,3) not null check (quantity > 0),
  used_on date not null default current_date,
  reference_type text not null check (reference_type in ('OC','NT','outro')),
  reference_number text not null,
  service_location text,
  notes text,
  evidence_path text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint team_usage_reference_check check (char_length(btrim(reference_number)) between 1 and 120),
  constraint team_usage_location_check check (service_location is null or char_length(btrim(service_location)) <= 180),
  constraint team_usage_notes_check check (notes is null or char_length(btrim(notes)) <= 1000)
);
create index if not exists team_material_usage_team_date_idx on public.team_material_usage(team_id,used_on desc);
create index if not exists team_material_usage_material_idx on public.team_material_usage(material_id);

create table if not exists public.team_material_usage_allocations (
  id uuid primary key default gen_random_uuid(),
  usage_id uuid not null references public.team_material_usage(id) on delete cascade,
  custody_id uuid not null references public.team_material_custody(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unique(usage_id,custody_id)
);
create index if not exists team_usage_allocations_custody_idx on public.team_material_usage_allocations(custody_id);

create sequence if not exists public.meter_transfer_protocol_seq;
create table if not exists public.team_meters (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  base_id uuid not null references public.bases(id),
  material_id uuid references public.materials(id),
  internal_code text not null,
  serial_number text not null,
  manufacturer text,
  model text,
  source_request_id uuid references public.material_requests(id),
  received_at timestamptz not null default now(),
  status text not null default 'disponivel' check (status in ('disponivel','instalado','aguardando_devolucao','devolvido')),
  installation_reference_type text check (installation_reference_type is null or installation_reference_type in ('OC','NT','outro')),
  installation_reference text,
  installed_at timestamptz,
  scrap_reason text,
  scrap_condition text,
  evidence_path text,
  return_protocol text,
  returned_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_meters_code_check check (char_length(btrim(internal_code)) between 1 and 80),
  constraint team_meters_serial_check check (char_length(btrim(serial_number)) between 1 and 120)
);
create unique index if not exists team_meters_serial_unique on public.team_meters(lower(btrim(serial_number)));
create index if not exists team_meters_team_status_idx on public.team_meters(team_id,status);
create index if not exists team_meters_base_idx on public.team_meters(base_id);

create table if not exists public.team_meter_history (
  id uuid primary key default gen_random_uuid(),
  meter_id uuid not null references public.team_meters(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  from_status text,
  to_status text not null,
  protocol text,
  reference_type text,
  reference_number text,
  notes text,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists team_meter_history_meter_date_idx on public.team_meter_history(meter_id,changed_at desc);
create index if not exists team_meter_history_team_date_idx on public.team_meter_history(team_id,changed_at desc);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_material_custody enable row level security;
alter table public.team_material_usage enable row level security;
alter table public.team_material_usage_allocations enable row level security;
alter table public.team_meters enable row level security;
alter table public.team_meter_history enable row level security;

create or replace function private.can_access_team(target_team_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.account_status='ativo' and (
      p.role in ('administrador','aprovador')
      or (p.role in ('almoxarife','consulta') and exists(
        select 1 from public.teams t join public.user_bases ub on ub.base_id=t.base_id
        where t.id=target_team_id and ub.user_id=p.id
      ))
      or (p.role='eletricista' and exists(
        select 1 from public.team_members tm
        where tm.team_id=target_team_id and tm.user_id=p.id and tm.is_active
      ))
    )
  )
$$;
revoke all on function private.can_access_team(uuid) from public,anon,service_role;
grant execute on function private.can_access_team(uuid) to authenticated;

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated using ((select private.can_access_team(id)));
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select to authenticated using ((select private.can_access_team(team_id)));
drop policy if exists team_custody_select on public.team_material_custody;
create policy team_custody_select on public.team_material_custody for select to authenticated using ((select private.can_access_team(team_id)));
drop policy if exists team_usage_select on public.team_material_usage;
create policy team_usage_select on public.team_material_usage for select to authenticated using ((select private.can_access_team(team_id)));
drop policy if exists team_usage_allocations_select on public.team_material_usage_allocations;
create policy team_usage_allocations_select on public.team_material_usage_allocations for select to authenticated using (exists(
  select 1 from public.team_material_usage u where u.id=usage_id and (select private.can_access_team(u.team_id))
));
drop policy if exists team_meters_select on public.team_meters;
create policy team_meters_select on public.team_meters for select to authenticated using ((select private.can_access_team(team_id)));
drop policy if exists team_meter_history_select on public.team_meter_history;
create policy team_meter_history_select on public.team_meter_history for select to authenticated using ((select private.can_access_team(team_id)));

revoke all on public.teams,public.team_members,public.team_material_custody,public.team_material_usage,public.team_material_usage_allocations,public.team_meters,public.team_meter_history from anon;
revoke insert,update,delete on public.teams,public.team_members,public.team_material_custody,public.team_material_usage,public.team_material_usage_allocations,public.team_meters,public.team_meter_history from authenticated;
grant select on public.teams,public.team_members,public.team_material_custody,public.team_material_usage,public.team_material_usage_allocations,public.team_meters,public.team_meter_history to authenticated;
grant all on public.teams,public.team_members,public.team_material_custody,public.team_material_usage,public.team_material_usage_allocations,public.team_meters,public.team_meter_history to service_role;

create or replace function public.registration_base_options()
returns table(id uuid,name text,abbreviation text)
language sql stable security definer set search_path=''
as $$ select b.id,b.name,b.abbreviation from public.bases b where b.is_active order by b.name $$;
revoke all on function public.registration_base_options() from public;
grant execute on function public.registration_base_options() to anon,authenticated,service_role;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_role text; v_base uuid;
begin
  v_role:=case when new.raw_user_meta_data->>'requested_role' in ('consulta','almoxarife','eletricista') then new.raw_user_meta_data->>'requested_role' else 'consulta' end;
  begin v_base:=nullif(new.raw_user_meta_data->>'requested_base_id','')::uuid; exception when others then v_base:=null; end;
  if v_base is not null and not exists(select 1 from public.bases where id=v_base and is_active) then v_base:=null; end if;
  insert into public.profiles(id,email,display_name,role,account_status,requested_role,requested_base_id,employee_number,requested_team_code,requested_partner_name)
  values(new.id,lower(new.email),nullif(btrim(new.raw_user_meta_data->>'full_name'),''),'consulta','pendente',v_role,v_base,
    nullif(btrim(new.raw_user_meta_data->>'employee_number'),''),nullif(btrim(new.raw_user_meta_data->>'team_code'),''),nullif(btrim(new.raw_user_meta_data->>'partner_name'),''))
  on conflict(id) do update set email=excluded.email;
  return new;
end $$;

create or replace function private.approve_access_request(p_user_id uuid,p_role text,p_base_id uuid,p_team_id uuid default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=(select auth.uid()); v_team_id uuid:=p_team_id; v_profile public.profiles%rowtype;
begin
  if not exists(select 1 from public.profiles where id=v_actor and role='administrador' and account_status='ativo') then raise exception 'Somente administradores podem liberar acessos.'; end if;
  if p_role not in ('consulta','almoxarife','aprovador','administrador','eletricista') then raise exception 'Perfil invalido.'; end if;
  select * into v_profile from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Usuario nao encontrado.'; end if;
  if p_role in ('consulta','almoxarife','eletricista') and not exists(select 1 from public.bases where id=p_base_id and is_active) then raise exception 'Selecione uma UTD ativa.'; end if;
  if p_role='eletricista' then
    if v_team_id is null and nullif(btrim(v_profile.requested_team_code),'') is not null then
      select id into v_team_id from public.teams where base_id=p_base_id and lower(btrim(code))=lower(btrim(v_profile.requested_team_code)) limit 1;
      if v_team_id is null then
        insert into public.teams(base_id,code,name,created_by,updated_by) values(p_base_id,btrim(v_profile.requested_team_code),'Equipe '||btrim(v_profile.requested_team_code),v_actor,v_actor) returning id into v_team_id;
      end if;
    end if;
    if v_team_id is null or not exists(select 1 from public.teams where id=v_team_id and base_id=p_base_id and is_active) then raise exception 'Selecione ou informe uma equipe valida.'; end if;
  end if;
  delete from public.user_bases where user_id=p_user_id;
  if p_role in ('consulta','almoxarife','eletricista') then insert into public.user_bases(user_id,base_id,assigned_by) values(p_user_id,p_base_id,v_actor); end if;
  update public.team_members set is_active=false,updated_at=now(),assigned_by=v_actor where user_id=p_user_id and is_active;
  if p_role='eletricista' then
    insert into public.team_members(team_id,user_id,membership_role,is_active,assigned_by) values(v_team_id,p_user_id,'integrante',true,v_actor)
    on conflict(team_id,user_id) do update set is_active=true,assigned_by=excluded.assigned_by,updated_at=now();
  end if;
  update public.profiles set role=p_role,account_status='ativo',access_review_reason=null,access_reviewed_by=v_actor,access_reviewed_at=now(),updated_at=now() where id=p_user_id;
  return v_team_id;
end $$;
revoke all on function private.approve_access_request(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.approve_access_request(uuid,text,uuid,uuid) to authenticated,service_role;
create or replace function public.approve_access_request(p_user_id uuid,p_role text,p_base_id uuid,p_team_id uuid default null)
returns uuid language sql security invoker set search_path='' as $$ select private.approve_access_request(p_user_id,p_role,p_base_id,p_team_id) $$;
revoke all on function public.approve_access_request(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.approve_access_request(uuid,text,uuid,uuid) to authenticated,service_role;

create or replace function private.create_team(p_base_id uuid,p_code text,p_name text)
returns uuid language plpgsql security definer set search_path=''
as $$ declare v_user uuid:=(select auth.uid()); v_id uuid; begin
  if not exists(select 1 from public.profiles where id=v_user and role='administrador' and account_status='ativo') then raise exception 'Somente administradores podem criar equipes.'; end if;
  if not exists(select 1 from public.bases where id=p_base_id and is_active) then raise exception 'UTD invalida.'; end if;
  insert into public.teams(base_id,code,name,created_by,updated_by) values(p_base_id,btrim(p_code),btrim(p_name),v_user,v_user) returning id into v_id; return v_id;
end $$;
revoke all on function private.create_team(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.create_team(uuid,text,text) to authenticated,service_role;
create or replace function public.create_team(p_base_id uuid,p_code text,p_name text)
returns uuid language sql security invoker set search_path='' as $$ select private.create_team(p_base_id,p_code,p_name) $$;
revoke all on function public.create_team(uuid,text,text) from public,anon;
grant execute on function public.create_team(uuid,text,text) to authenticated,service_role;

create or replace function private.register_team_material_usage(p_team_id uuid,p_material_id uuid,p_quantity numeric,p_used_on date,p_reference_type text,p_reference_number text,p_service_location text default null,p_notes text default null,p_evidence_path text default null)
returns public.team_material_usage language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=(select auth.uid()); v_usage public.team_material_usage%rowtype; v_base uuid; v_remaining numeric:=p_quantity; v_lot public.team_material_custody%rowtype; v_take numeric;
begin
  perform set_config('lock_timeout','5s',true); perform set_config('statement_timeout','15s',true);
  if v_user is null or not (select private.can_access_team(p_team_id)) then raise exception 'Equipe nao autorizada.'; end if;
  if not exists(select 1 from public.profiles where id=v_user and account_status='ativo' and role in ('eletricista','almoxarife','administrador')) then raise exception 'Perfil sem permissao para registrar uso.'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Quantidade invalida.'; end if;
  if p_reference_type not in ('OC','NT','outro') or nullif(btrim(p_reference_number),'') is null then raise exception 'Informe OC, NT ou outra referencia.'; end if;
  select base_id into v_base from public.teams where id=p_team_id and is_active;
  perform id from public.team_material_custody where team_id=p_team_id and material_id=p_material_id and available_quantity>0 order by received_at,id for update;
  if coalesce((select sum(available_quantity) from public.team_material_custody where team_id=p_team_id and material_id=p_material_id),0)<p_quantity then raise exception 'Saldo insuficiente na posse da equipe.'; end if;
  insert into public.team_material_usage(protocol,team_id,base_id,material_id,quantity,used_on,reference_type,reference_number,service_location,notes,evidence_path,created_by)
  values('USO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.team_usage_protocol_seq')::text,6,'0'),p_team_id,v_base,p_material_id,p_quantity,coalesce(p_used_on,current_date),p_reference_type,btrim(p_reference_number),nullif(btrim(p_service_location),''),nullif(btrim(p_notes),''),nullif(btrim(p_evidence_path),''),v_user) returning * into v_usage;
  for v_lot in select * from public.team_material_custody where team_id=p_team_id and material_id=p_material_id and available_quantity>0 order by received_at,id for update loop
    exit when v_remaining<=0; v_take:=least(v_lot.available_quantity,v_remaining);
    update public.team_material_custody set available_quantity=available_quantity-v_take where id=v_lot.id;
    insert into public.team_material_usage_allocations(usage_id,custody_id,quantity) values(v_usage.id,v_lot.id,v_take);
    v_remaining:=v_remaining-v_take;
  end loop;
  return v_usage;
end $$;
revoke all on function private.register_team_material_usage(uuid,uuid,numeric,date,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.register_team_material_usage(uuid,uuid,numeric,date,text,text,text,text,text) to authenticated,service_role;
create or replace function public.register_team_material_usage(p_team_id uuid,p_material_id uuid,p_quantity numeric,p_used_on date,p_reference_type text,p_reference_number text,p_service_location text default null,p_notes text default null,p_evidence_path text default null)
returns public.team_material_usage language sql security invoker set search_path='' as $$ select private.register_team_material_usage(p_team_id,p_material_id,p_quantity,p_used_on,p_reference_type,p_reference_number,p_service_location,p_notes,p_evidence_path) $$;
revoke all on function public.register_team_material_usage(uuid,uuid,numeric,date,text,text,text,text,text) from public,anon;
grant execute on function public.register_team_material_usage(uuid,uuid,numeric,date,text,text,text,text,text) to authenticated,service_role;

create or replace function private.register_team_meter(p_team_id uuid,p_material_id uuid,p_internal_code text,p_serial_number text,p_manufacturer text default null,p_model text default null,p_source_request_id uuid default null)
returns public.team_meters language plpgsql security definer set search_path=''
as $$ declare v_user uuid:=(select auth.uid()); v_role text; v_base uuid; v_meter public.team_meters%rowtype; begin
  select role into v_role from public.profiles where id=v_user and account_status='ativo';
  if v_role not in ('almoxarife','administrador') or not (select private.can_access_team(p_team_id)) then raise exception 'Perfil sem permissao para vincular medidores.'; end if;
  select base_id into v_base from public.teams where id=p_team_id and is_active; if v_base is null then raise exception 'Equipe invalida.'; end if;
  insert into public.team_meters(team_id,base_id,material_id,internal_code,serial_number,manufacturer,model,source_request_id,created_by,updated_by)
  values(p_team_id,v_base,p_material_id,btrim(p_internal_code),btrim(p_serial_number),nullif(btrim(p_manufacturer),''),nullif(btrim(p_model),''),p_source_request_id,v_user,v_user) returning * into v_meter;
  insert into public.team_meter_history(meter_id,team_id,to_status,notes,changed_by) values(v_meter.id,p_team_id,'disponivel','Medidor vinculado a equipe.',v_user);
  return v_meter;
end $$;
revoke all on function private.register_team_meter(uuid,uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.register_team_meter(uuid,uuid,text,text,text,text,uuid) to authenticated,service_role;
create or replace function public.register_team_meter(p_team_id uuid,p_material_id uuid,p_internal_code text,p_serial_number text,p_manufacturer text default null,p_model text default null,p_source_request_id uuid default null)
returns public.team_meters language sql security invoker set search_path='' as $$ select private.register_team_meter(p_team_id,p_material_id,p_internal_code,p_serial_number,p_manufacturer,p_model,p_source_request_id) $$;
revoke all on function public.register_team_meter(uuid,uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.register_team_meter(uuid,uuid,text,text,text,text,uuid) to authenticated,service_role;

create or replace function private.transition_team_meter(p_meter_id uuid,p_to_status text,p_reference_type text default null,p_reference_number text default null,p_notes text default null,p_evidence_path text default null)
returns public.team_meters language plpgsql security definer set search_path=''
as $$ declare v_user uuid:=(select auth.uid()); v_role text; v_meter public.team_meters%rowtype; v_protocol text; v_from_status text; begin
  select role into v_role from public.profiles where id=v_user and account_status='ativo';
  select * into v_meter from public.team_meters where id=p_meter_id for update; if not found or not (select private.can_access_team(v_meter.team_id)) then raise exception 'Medidor nao autorizado.'; end if;
  v_from_status:=v_meter.status;
  if p_to_status='instalado' then
    if v_meter.status<>'disponivel' or p_reference_type not in ('OC','NT','outro') or nullif(btrim(p_reference_number),'') is null then raise exception 'Informe a referencia para instalar um medidor disponivel.'; end if;
  elsif p_to_status='aguardando_devolucao' then
    if v_meter.status not in ('disponivel','instalado') or nullif(btrim(p_notes),'') is null then raise exception 'Informe o motivo e a condicao da sucata.'; end if;
  elsif p_to_status='devolvido' then
    if v_role not in ('almoxarife','administrador') or v_meter.status<>'aguardando_devolucao' then raise exception 'A devolucao deve ser confirmada pelo almoxarifado.'; end if;
    v_protocol:='DEV-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.meter_transfer_protocol_seq')::text,6,'0');
  else raise exception 'Transicao de medidor invalida.'; end if;
  update public.team_meters set status=p_to_status,installation_reference_type=case when p_to_status='instalado' then p_reference_type else installation_reference_type end,installation_reference=case when p_to_status='instalado' then btrim(p_reference_number) else installation_reference end,installed_at=case when p_to_status='instalado' then now() else installed_at end,scrap_reason=case when p_to_status='aguardando_devolucao' then btrim(p_notes) else scrap_reason end,evidence_path=coalesce(nullif(btrim(p_evidence_path),''),evidence_path),return_protocol=coalesce(v_protocol,return_protocol),returned_at=case when p_to_status='devolvido' then now() else returned_at end,updated_by=v_user,updated_at=now() where id=p_meter_id returning * into v_meter;
  insert into public.team_meter_history(meter_id,team_id,from_status,to_status,protocol,reference_type,reference_number,notes,changed_by) values(v_meter.id,v_meter.team_id,v_from_status,p_to_status,v_protocol,p_reference_type,nullif(btrim(p_reference_number),''),nullif(btrim(p_notes),''),v_user);
  return v_meter;
end $$;
revoke all on function private.transition_team_meter(uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.transition_team_meter(uuid,text,text,text,text,text) to authenticated,service_role;
create or replace function public.transition_team_meter(p_meter_id uuid,p_to_status text,p_reference_type text default null,p_reference_number text default null,p_notes text default null,p_evidence_path text default null)
returns public.team_meters language sql security invoker set search_path='' as $$ select private.transition_team_meter(p_meter_id,p_to_status,p_reference_type,p_reference_number,p_notes,p_evidence_path) $$;
revoke all on function public.transition_team_meter(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.transition_team_meter(uuid,text,text,text,text,text) to authenticated,service_role;

create or replace function private.resolve_request_team()
returns trigger language plpgsql set search_path='' as $$ begin
  if new.team_id is null and nullif(btrim(new.team_number),'') is not null then
    select id into new.team_id from public.teams where base_id=new.base_id and is_active and lower(btrim(code))=lower(btrim(new.team_number)) limit 1;
  end if; return new;
end $$;
drop trigger if exists resolve_request_team on public.material_requests;
create trigger resolve_request_team before insert or update of team_number,base_id on public.material_requests for each row execute function private.resolve_request_team();

create or replace function private.delivered_request_to_team_custody()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  if new.status='entregue' and old.status is distinct from 'entregue' and new.team_id is not null then
    insert into public.team_material_custody(team_id,base_id,material_id,source_request_id,source_request_item_id,received_quantity,available_quantity,received_at,received_by)
    select new.team_id,new.base_id,sr.material_id,new.id,sr.request_item_id,sr.quantity,sr.quantity,coalesce(new.stock_posted_at,now()),new.stock_posted_by
    from public.stock_reservations sr where sr.request_id=new.id and sr.status='consumida'
    on conflict(source_request_item_id) do nothing;
  end if; return new;
end $$;
drop trigger if exists delivered_request_to_team_custody on public.material_requests;
create trigger delivered_request_to_team_custody after update of status on public.material_requests for each row execute function private.delivered_request_to_team_custody();

create or replace function public.create_material_request(
  p_base_id uuid,p_withdrawal_date date,p_team_number text,p_participant_one text,
  p_participant_two text,p_separator_name text,p_notes text,p_items jsonb
)
returns uuid language plpgsql security invoker set search_path=''
as $$
declare new_request_id uuid; item jsonb; v_team_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Usuario nao autenticado.'; end if;
  if not (select private.has_role(array['consulta','eletricista','almoxarife','administrador'])) then raise exception 'Perfil sem permissao para criar requisicoes.'; end if;
  if p_base_id is null or not exists(select 1 from public.bases b where b.id=p_base_id and b.is_active) or not (select private.can_access_base(p_base_id)) then raise exception 'Selecione uma UTD ativa permitida para o seu perfil.'; end if;
  if nullif(btrim(p_participant_one),'') is null or nullif(btrim(p_separator_name),'') is null then raise exception 'Informe o participante e o separador.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then raise exception 'Inclua entre 1 e 100 itens na requisicao.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) value where nullif(btrim(value->>'material_code'),'') is null or nullif(btrim(value->>'description'),'') is null or coalesce((value->>'quantity')::numeric,0)<=0) then raise exception 'Existem itens com codigo, descricao ou quantidade invalidos.'; end if;
  select t.id into v_team_id from public.teams t where t.base_id=p_base_id and t.is_active and lower(btrim(t.code))=lower(btrim(p_team_number)) limit 1;
  if (select role from public.profiles where id=(select auth.uid()))='eletricista' then
    select tm.team_id into v_team_id from public.team_members tm join public.teams t on t.id=tm.team_id where tm.user_id=(select auth.uid()) and tm.is_active and t.base_id=p_base_id;
    if v_team_id is null then raise exception 'Seu perfil nao esta vinculado a uma equipe nesta UTD.'; end if;
  end if;
  insert into public.material_requests(base_id,withdrawal_date,team_number,team_id,participant_one,participant_two,separator_name,notes,status,created_by)
  values(p_base_id,coalesce(p_withdrawal_date,current_date),nullif(btrim(p_team_number),''),v_team_id,btrim(p_participant_one),nullif(btrim(p_participant_two),''),btrim(p_separator_name),nullif(btrim(p_notes),''),'aberta',(select auth.uid())) returning id into new_request_id;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.material_request_items(request_id,source_type,source_id,material_code,description,unit_of_measure,quantity,scanned,notes)
    values(new_request_id,coalesce(nullif(item->>'source_type',''),'manual'),case when nullif(item->>'source_id','') is null then null else (item->>'source_id')::uuid end,btrim(item->>'material_code'),btrim(item->>'description'),coalesce(nullif(btrim(item->>'unit_of_measure'),''),'unidade'),(item->>'quantity')::numeric,coalesce((item->>'scanned')::boolean,false),nullif(btrim(item->>'notes'),''));
  end loop;
  delete from public.material_request_drafts where user_id=(select auth.uid());
  return new_request_id;
end $$;
revoke all on function public.create_material_request(uuid,date,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_material_request(uuid,date,text,text,text,text,text,jsonb) to authenticated,service_role;

-- Eletricistas podem solicitar materiais e consultar somente sua UTD/equipe.
create or replace function private.can_access_base(target_base_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.account_status='ativo' and (
    p.role in ('aprovador','administrador') or exists(select 1 from public.user_bases ub where ub.user_id=p.id and ub.base_id=target_base_id)
  ))
$$;

drop policy if exists material_requests_insert on public.material_requests;
create policy material_requests_insert on public.material_requests for insert to authenticated with check (
  (select private.has_role(array['consulta','eletricista','almoxarife','administrador'])) and created_by=(select auth.uid()) and (select private.can_access_base(base_id))
);
drop policy if exists material_request_items_insert on public.material_request_items;
create policy material_request_items_insert on public.material_request_items for insert to authenticated with check (
  (select private.has_role(array['consulta','eletricista','almoxarife','administrador'])) and (select private.can_access_material_request(request_id)) and exists(select 1 from public.material_requests r where r.id=request_id and r.created_by=(select auth.uid()))
);

-- Auditoria para todas as tabelas novas.
drop trigger if exists teams_audit on public.teams;
create trigger teams_audit after insert or update or delete on public.teams for each row execute function private.audit_row_change();
drop trigger if exists team_members_audit on public.team_members;
create trigger team_members_audit after insert or update or delete on public.team_members for each row execute function private.audit_row_change();
drop trigger if exists team_custody_audit on public.team_material_custody;
create trigger team_custody_audit after insert or update or delete on public.team_material_custody for each row execute function private.audit_row_change();
drop trigger if exists team_usage_audit on public.team_material_usage;
create trigger team_usage_audit after insert or update or delete on public.team_material_usage for each row execute function private.audit_row_change();
drop trigger if exists team_meters_audit on public.team_meters;
create trigger team_meters_audit after insert or update or delete on public.team_meters for each row execute function private.audit_row_change();
