-- Equipes editaveis, requisicoes vinculadas e arquivo digital assinado.

create table if not exists public.team_assignment_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  previous_member_ids uuid[] not null default '{}',
  new_member_ids uuid[] not null default '{}',
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
alter table public.team_assignment_history enable row level security;
create policy team_assignment_history_admin_select on public.team_assignment_history
  for select to authenticated using ((select private.has_role(array['administrador'])));

create or replace function private.admin_update_team(
  p_team_id uuid, p_code text, p_name text, p_member_ids uuid[], p_reason text
) returns public.teams language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_team public.teams;
  v_old uuid[];
  v_members uuid[] := coalesce(p_member_ids, '{}');
begin
  if v_actor is null or not (select private.has_role(array['administrador'])) then raise exception 'Somente administradores podem editar equipes.'; end if;
  select * into v_team from public.teams where id=p_team_id for update;
  if v_team.id is null then raise exception 'Equipe nao encontrada.'; end if;
  if nullif(btrim(p_code),'') is null or nullif(btrim(p_name),'') is null then raise exception 'Informe codigo e nome da equipe.'; end if;
  if nullif(btrim(p_reason),'') is null or char_length(btrim(p_reason)) < 5 then raise exception 'Informe uma justificativa com pelo menos 5 caracteres.'; end if;
  if cardinality(v_members) > 2 or cardinality(v_members) <> (select count(distinct x) from unnest(v_members) x) then raise exception 'Uma equipe deve ter no maximo dois integrantes diferentes.'; end if;
  if exists(
    select 1 from unnest(v_members) member_id
    left join public.profiles p on p.id=member_id
    where p.id is null or p.role<>'eletricista' or p.account_status<>'ativo'
      or not exists(select 1 from public.user_bases ub where ub.user_id=p.id and ub.base_id=v_team.base_id)
  ) then raise exception 'Todos os integrantes devem ser eletricistas ativos com acesso a UTD da equipe.'; end if;

  select coalesce(array_agg(user_id order by user_id), '{}') into v_old
  from public.team_members where team_id=p_team_id and is_active;

  update public.teams set code=btrim(p_code), name=btrim(p_name), updated_by=v_actor, updated_at=now() where id=p_team_id returning * into v_team;
  update public.team_members set is_active=false, updated_at=now()
    where team_id=p_team_id and is_active and not (user_id=any(v_members));
  update public.team_members set is_active=false, updated_at=now()
    where is_active and user_id=any(v_members) and team_id<>p_team_id;
  insert into public.team_members(team_id,user_id,membership_role,is_active,assigned_by)
    select p_team_id, member_id, case when ord=1 then 'responsavel' else 'integrante' end, true, v_actor
    from unnest(v_members) with ordinality as m(member_id,ord)
    on conflict(team_id,user_id) do update set membership_role=excluded.membership_role,is_active=true,assigned_by=v_actor,updated_at=now();
  insert into public.team_assignment_history(team_id,previous_member_ids,new_member_ids,reason,changed_by)
    values(p_team_id,v_old,v_members,btrim(p_reason),v_actor);
  return v_team;
end $$;
revoke all on function private.admin_update_team(uuid,text,text,uuid[],text) from public,anon,authenticated,service_role;
grant execute on function private.admin_update_team(uuid,text,text,uuid[],text) to authenticated,service_role;
create or replace function public.admin_update_team(p_team_id uuid,p_code text,p_name text,p_member_ids uuid[],p_reason text)
returns public.teams language sql security invoker set search_path='' as $$
  select private.admin_update_team(p_team_id,p_code,p_name,p_member_ids,p_reason)
$$;
revoke all on function public.admin_update_team(uuid,text,text,uuid[],text) from public,anon;
grant execute on function public.admin_update_team(uuid,text,text,uuid[],text) to authenticated,service_role;

create or replace function public.request_team_options(p_base_id uuid)
returns table(team_id uuid,base_id uuid,code text,name text,member_ids uuid[],member_names text[])
language sql stable security invoker set search_path=''
as $$
  select t.id,t.base_id,t.code,t.name,
    coalesce(array_agg(tm.user_id order by tm.membership_role desc,tm.created_at) filter(where tm.user_id is not null),'{}'),
    coalesce(array_agg(coalesce(p.display_name,p.email,'Integrante') order by tm.membership_role desc,tm.created_at) filter(where tm.user_id is not null),'{}')
  from public.teams t
  left join public.team_members tm on tm.team_id=t.id and tm.is_active
  left join public.profiles p on p.id=tm.user_id
  where t.base_id=p_base_id and t.is_active and (select private.can_access_base(t.base_id))
    and ((select role from public.profiles where id=(select auth.uid())) <> 'eletricista'
      or exists(select 1 from public.team_members mine where mine.team_id=t.id and mine.user_id=(select auth.uid()) and mine.is_active))
  group by t.id,t.base_id,t.code,t.name order by t.code
$$;
revoke all on function public.request_team_options(uuid) from public,anon;
grant execute on function public.request_team_options(uuid) to authenticated,service_role;

create or replace function public.create_material_request_v2(
  p_base_id uuid,p_withdrawal_date date,p_team_id uuid,p_participant_one text,
  p_participant_two text,p_separator_name text,p_notes text,p_items jsonb
) returns uuid language plpgsql security invoker set search_path=''
as $$
declare new_request_id uuid; item jsonb; v_team public.teams; v_role text;
begin
  if (select auth.uid()) is null then raise exception 'Usuario nao autenticado.'; end if;
  if not (select private.has_role(array['consulta','eletricista','almoxarife','administrador'])) then raise exception 'Perfil sem permissao para criar requisicoes.'; end if;
  if p_base_id is null or not exists(select 1 from public.bases b where b.id=p_base_id and b.is_active) or not (select private.can_access_base(p_base_id)) then raise exception 'Selecione uma UTD ativa permitida para o seu perfil.'; end if;
  select * into v_team from public.teams where id=p_team_id and base_id=p_base_id and is_active;
  if v_team.id is null then raise exception 'Selecione uma equipe ativa da UTD informada.'; end if;
  select role into v_role from public.profiles where id=(select auth.uid());
  if v_role='eletricista' and not exists(select 1 from public.team_members where team_id=p_team_id and user_id=(select auth.uid()) and is_active) then raise exception 'O eletricista somente pode requisitar para a propria equipe.'; end if;
  if nullif(btrim(p_participant_one),'') is null or nullif(btrim(p_separator_name),'') is null then raise exception 'Informe os participantes e o separador.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then raise exception 'Inclua entre 1 e 100 itens na requisicao.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) value where nullif(btrim(value->>'material_code'),'') is null or nullif(btrim(value->>'description'),'') is null or coalesce((value->>'quantity')::numeric,0)<=0) then raise exception 'Existem itens com codigo, descricao ou quantidade invalidos.'; end if;
  insert into public.material_requests(base_id,withdrawal_date,team_number,team_id,participant_one,participant_two,separator_name,notes,status,created_by)
  values(p_base_id,coalesce(p_withdrawal_date,current_date),v_team.code,v_team.id,btrim(p_participant_one),nullif(btrim(p_participant_two),''),btrim(p_separator_name),nullif(btrim(p_notes),''),'aberta',(select auth.uid())) returning id into new_request_id;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.material_request_items(request_id,source_type,source_id,material_code,description,unit_of_measure,quantity,scanned,notes)
    values(new_request_id,coalesce(nullif(item->>'source_type',''),'manual'),case when nullif(item->>'source_id','') is null then null else (item->>'source_id')::uuid end,btrim(item->>'material_code'),btrim(item->>'description'),coalesce(nullif(btrim(item->>'unit_of_measure'),''),'unidade'),(item->>'quantity')::numeric,coalesce((item->>'scanned')::boolean,false),nullif(btrim(item->>'notes'),''));
  end loop;
  delete from public.material_request_drafts where user_id=(select auth.uid());
  return new_request_id;
end $$;
revoke all on function public.create_material_request_v2(uuid,date,uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_material_request_v2(uuid,date,uuid,text,text,text,text,jsonb) to authenticated,service_role;

create table if not exists public.material_request_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests(id),
  base_id uuid not null references public.bases(id),
  team_id uuid references public.teams(id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  legibility_confirmed boolean not null check (legibility_confirmed),
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'ativo' check(status in ('ativo','substituido','excluido'))
);
create index if not exists material_request_documents_request_idx on public.material_request_documents(request_id,uploaded_at desc);
alter table public.material_request_documents enable row level security;
create policy material_request_documents_select on public.material_request_documents for select to authenticated
  using ((select private.can_access_base(base_id)) or (team_id is not null and (select private.can_access_team(team_id))));
create policy material_request_documents_insert on public.material_request_documents for insert to authenticated with check (
  uploaded_by=(select auth.uid()) and (select private.can_access_base(base_id))
  and exists(select 1 from public.material_requests r where r.id=request_id and r.base_id=base_id and r.team_id is not distinct from team_id and r.status='entregue')
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('request-signed-documents','request-signed-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy request_signed_documents_insert on storage.objects for insert to authenticated with check (
  bucket_id='request-signed-documents' and exists(
    select 1 from public.material_requests r
    where r.id=(storage.foldername(name))[2]::uuid and r.base_id=(storage.foldername(name))[1]::uuid
      and r.status='entregue' and (select private.can_access_base(r.base_id))
  )
);
create policy request_signed_documents_select on storage.objects for select to authenticated using (
  bucket_id='request-signed-documents' and exists(
    select 1 from public.material_requests r
    where r.id=(storage.foldername(name))[2]::uuid and r.base_id=(storage.foldername(name))[1]::uuid
      and ((select private.can_access_base(r.base_id)) or (r.team_id is not null and (select private.can_access_team(r.team_id))))
  )
);
create policy request_signed_documents_delete_own on storage.objects for delete to authenticated using (
  bucket_id='request-signed-documents' and owner_id=(select auth.uid()::text)
);
