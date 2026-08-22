alter table public.material_requests
  add column if not exists stock_reserved_at timestamptz,
  add column if not exists stock_posted_at timestamptz,
  add column if not exists stock_posted_by uuid references auth.users(id);

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests(id) on delete cascade,
  request_item_id uuid not null references public.material_request_items(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id),
  base_id uuid not null references public.bases(id),
  material_id uuid not null references public.materials(id),
  quantity numeric(14,3) not null check (quantity > 0),
  status text not null default 'ativa' check (status in ('ativa','consumida','liberada')),
  created_by uuid not null references auth.users(id),
  closed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint stock_reservations_request_item_key unique (request_item_id),
  constraint stock_reservations_closed_check check (
    (status = 'ativa' and closed_at is null and closed_by is null)
    or (status in ('consumida','liberada') and closed_at is not null and closed_by is not null)
  )
);

comment on table public.stock_reservations is 'Reservas de estoque vinculadas a itens de requisicao. Cada item pode ser reservado uma unica vez.';

alter table public.stock_movements
  add column if not exists request_id uuid references public.material_requests(id),
  add column if not exists request_item_id uuid references public.material_request_items(id),
  add column if not exists reservation_id uuid references public.stock_reservations(id);

create index if not exists material_requests_stock_posted_by_idx on public.material_requests(stock_posted_by);
create index if not exists stock_reservations_request_status_idx on public.stock_reservations(request_id, status);
create index if not exists stock_reservations_stock_item_id_idx on public.stock_reservations(stock_item_id);
create index if not exists stock_reservations_base_id_idx on public.stock_reservations(base_id);
create index if not exists stock_reservations_material_id_idx on public.stock_reservations(material_id);
create index if not exists stock_reservations_created_by_idx on public.stock_reservations(created_by);
create index if not exists stock_reservations_closed_by_idx on public.stock_reservations(closed_by);
create index if not exists stock_movements_request_id_idx on public.stock_movements(request_id);
create index if not exists stock_movements_request_item_id_idx on public.stock_movements(request_item_id);
create index if not exists stock_movements_reservation_id_idx on public.stock_movements(reservation_id);
create unique index if not exists stock_movements_request_item_once_idx
  on public.stock_movements(request_item_id)
  where request_item_id is not null;

alter table public.stock_reservations enable row level security;

drop policy if exists stock_reservations_select on public.stock_reservations;
create policy stock_reservations_select
on public.stock_reservations for select
to authenticated
using ((select private.can_access_base(base_id)));

revoke all on public.stock_reservations from anon;
revoke insert, update, delete on public.stock_reservations from authenticated;
grant select on public.stock_reservations to authenticated;
grant all on public.stock_reservations to service_role;

drop policy if exists material_requests_update on public.material_requests;
revoke update on public.material_requests from authenticated;

drop policy if exists material_requests_insert on public.material_requests;
create policy material_requests_insert
on public.material_requests for insert
to authenticated
with check (
  (select private.has_role(array['consulta','almoxarife','administrador']))
  and created_by = (select auth.uid())
  and (select private.can_access_base(base_id))
);

drop policy if exists material_request_items_insert on public.material_request_items;
create policy material_request_items_insert
on public.material_request_items for insert
to authenticated
with check (
  (select private.has_role(array['consulta','almoxarife','administrador']))
  and (select private.can_access_material_request(request_id))
  and exists (
    select 1 from public.material_requests request_row
    where request_row.id = request_id
      and request_row.created_by = (select auth.uid())
  )
);

create or replace function public.create_material_request(
  p_base_id uuid,
  p_withdrawal_date date,
  p_team_number text,
  p_participant_one text,
  p_participant_two text,
  p_separator_name text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_request_id uuid;
  item jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  if not (select private.has_role(array['consulta','almoxarife','administrador'])) then
    raise exception 'Perfil sem permissao para criar requisicoes.';
  end if;

  if p_base_id is null
     or not exists (
       select 1 from public.bases b
       where b.id=p_base_id and b.is_active
     )
     or not (select private.can_access_base(p_base_id)) then
    raise exception 'Selecione uma UTD ativa permitida para o seu perfil.';
  end if;

  if nullif(btrim(p_participant_one),'') is null
     or nullif(btrim(p_separator_name),'') is null then
    raise exception 'Informe o participante e o separador.';
  end if;

  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Inclua pelo menos um item na requisicao.';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_items) value
    where nullif(btrim(value->>'material_code'),'') is null
       or nullif(btrim(value->>'description'),'') is null
       or coalesce((value->>'quantity')::numeric,0)<=0
  ) then
    raise exception 'Existem itens com codigo, descricao ou quantidade invalidos.';
  end if;

  insert into public.material_requests(
    base_id,withdrawal_date,team_number,participant_one,participant_two,
    separator_name,notes,status,created_by
  )
  values(
    p_base_id,coalesce(p_withdrawal_date,current_date),nullif(btrim(p_team_number),''),
    btrim(p_participant_one),nullif(btrim(p_participant_two),''),
    btrim(p_separator_name),nullif(btrim(p_notes),''),
    'aberta',(select auth.uid())
  )
  returning id into new_request_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.material_request_items(
      request_id,source_type,source_id,material_code,description,
      unit_of_measure,quantity,scanned,notes
    )
    values(
      new_request_id,coalesce(nullif(item->>'source_type',''),'manual'),
      case when nullif(item->>'source_id','') is null then null else (item->>'source_id')::uuid end,
      btrim(item->>'material_code'),btrim(item->>'description'),
      coalesce(nullif(btrim(item->>'unit_of_measure'),''),'unidade'),
      (item->>'quantity')::numeric,coalesce((item->>'scanned')::boolean,false),
      nullif(btrim(item->>'notes'),'')
    );
  end loop;

  delete from public.material_request_drafts where user_id=(select auth.uid());
  return new_request_id;
end;
$$;

create or replace function private.validate_material_request_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    if new.status<>'aberta' then
      raise exception 'Toda requisicao deve iniciar como aberta.';
    end if;
    return new;
  end if;

  if old.status is distinct from new.status then
    if not (select private.has_role(array['almoxarife','administrador']))
       or not (select private.can_access_base(old.base_id)) then
      raise exception 'Sem permissao para alterar a situacao desta requisicao.'
        using errcode='42501';
    end if;

    if not (
      (old.status='aberta' and new.status in ('separada','cancelada'))
      or (old.status='separada' and new.status in ('entregue','cancelada'))
    ) then
      raise exception 'Transicao de situacao invalida: % para %.',old.status,new.status;
    end if;

    if new.status='cancelada' and nullif(btrim(new.status_note),'') is null then
      raise exception 'Informe o motivo do cancelamento.';
    end if;

    new.updated_at:=now();
  end if;
  return new;
end;
$$;

create or replace function private.transition_material_request(
  p_request_id uuid,
  p_to_status text,
  p_note text default null
)
returns public.material_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_request public.material_requests%rowtype;
  v_reservation public.stock_reservations%rowtype;
  v_stock public.stock_items%rowtype;
  v_after numeric(14,3);
  v_code text;
  v_quantity numeric(14,3);
  v_available numeric(14,3);
begin
  perform set_config('lock_timeout','5s',true);
  perform set_config('statement_timeout','15s',true);

  if v_user_id is null then raise exception 'Autenticacao obrigatoria.'; end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_user_id and p.account_status = 'ativo';

  if v_role not in ('almoxarife','administrador') then
    raise exception 'Somente almoxarifes e administradores podem separar ou entregar requisicoes.';
  end if;

  select * into v_request
  from public.material_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Requisicao nao encontrada.'; end if;
  if not (select private.can_access_base(v_request.base_id)) then
    raise exception 'Voce nao possui acesso a UTD desta requisicao.';
  end if;
  if p_to_status not in ('separada','entregue','cancelada') then
    raise exception 'Situacao de destino invalida.';
  end if;
  if not (
    (v_request.status='aberta' and p_to_status in ('separada','cancelada'))
    or (v_request.status='separada' and p_to_status in ('entregue','cancelada'))
  ) then
    raise exception 'Esta requisicao ja foi processada ou a transicao solicitada nao e permitida.';
  end if;
  if p_to_status='cancelada' and nullif(btrim(p_note),'') is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;

  if p_to_status='separada' then
    if exists (
      select 1
      from public.material_request_items ri
      join public.materials m on m.status='ativo' and (
        (ri.source_type='material' and m.id=ri.source_id)
        or (ri.source_type<>'material' and lower(btrim(m.internal_code))=lower(btrim(ri.material_code)))
      )
      where ri.request_id=v_request.id
        and not exists (
          select 1 from public.stock_items si
          where si.base_id=v_request.base_id and si.material_id=m.id and si.is_active
        )
    ) then
      select ri.material_code into v_code
      from public.material_request_items ri
      join public.materials m on m.status='ativo' and (
        (ri.source_type='material' and m.id=ri.source_id)
        or (ri.source_type<>'material' and lower(btrim(m.internal_code))=lower(btrim(ri.material_code)))
      )
      where ri.request_id=v_request.id
        and not exists (
          select 1 from public.stock_items si
          where si.base_id=v_request.base_id and si.material_id=m.id and si.is_active
        )
      order by ri.id
      limit 1;
      raise exception 'O material % ainda nao possui saldo ativo nesta UTD.',v_code;
    end if;

    perform si.id
    from public.stock_items si
    where si.base_id=v_request.base_id
      and si.material_id in (
        select m.id
        from public.material_request_items ri
        join public.materials m on m.status='ativo' and (
          (ri.source_type='material' and m.id=ri.source_id)
          or (ri.source_type<>'material' and lower(btrim(m.internal_code))=lower(btrim(ri.material_code)))
        )
        where ri.request_id=v_request.id
      )
    order by si.id
    for update;

    select ri.material_code,ri.quantity,(si.current_quantity-si.reserved_quantity)
      into v_code,v_quantity,v_available
    from public.material_request_items ri
    join public.materials m on m.status='ativo' and (
      (ri.source_type='material' and m.id=ri.source_id)
      or (ri.source_type<>'material' and lower(btrim(m.internal_code))=lower(btrim(ri.material_code)))
    )
    join public.stock_items si on si.base_id=v_request.base_id and si.material_id=m.id and si.is_active
    where ri.request_id=v_request.id
      and (si.current_quantity-si.reserved_quantity)<ri.quantity
    order by ri.id
    limit 1;

    if found then
      raise exception 'Saldo insuficiente para o material %. Solicitado: %, disponivel: %.',v_code,v_quantity,v_available;
    end if;

    insert into public.stock_reservations(
      request_id,request_item_id,stock_item_id,base_id,material_id,quantity,status,created_by
    )
    select v_request.id,ri.id,si.id,v_request.base_id,m.id,ri.quantity,'ativa',v_user_id
    from public.material_request_items ri
    join public.materials m on m.status='ativo' and (
      (ri.source_type='material' and m.id=ri.source_id)
      or (ri.source_type<>'material' and lower(btrim(m.internal_code))=lower(btrim(ri.material_code)))
    )
    join public.stock_items si on si.base_id=v_request.base_id and si.material_id=m.id and si.is_active
    where ri.request_id=v_request.id
    order by ri.id;

    update public.stock_items si
    set reserved_quantity=si.reserved_quantity+reserved.total_quantity,
        updated_by=v_user_id,
        updated_at=now()
    from (
      select stock_item_id,sum(quantity) as total_quantity
      from public.stock_reservations
      where request_id=v_request.id and status='ativa'
      group by stock_item_id
    ) reserved
    where si.id=reserved.stock_item_id;

    update public.material_requests
    set status='separada',status_note=null,stock_reserved_at=now()
    where id=v_request.id
    returning * into v_request;

  elsif p_to_status='entregue' then
    perform si.id
    from public.stock_items si
    join public.stock_reservations sr on sr.stock_item_id=si.id
    where sr.request_id=v_request.id and sr.status='ativa'
    order by si.id
    for update of si;

    for v_reservation in
      select * from public.stock_reservations
      where request_id=v_request.id and status='ativa'
      order by stock_item_id,id
      for update
    loop
      select * into v_stock from public.stock_items where id=v_reservation.stock_item_id;
      if v_stock.current_quantity<v_reservation.quantity or v_stock.reserved_quantity<v_reservation.quantity then
        raise exception 'Inconsistencia de saldo detectada. A entrega nao foi concluida.';
      end if;

      v_after:=v_stock.current_quantity-v_reservation.quantity;
      update public.stock_items
      set current_quantity=v_after,
          reserved_quantity=reserved_quantity-v_reservation.quantity,
          updated_by=v_user_id,
          updated_at=now()
      where id=v_stock.id;

      insert into public.stock_movements(
        stock_item_id,base_id,material_id,movement_type,quantity,effect_quantity,
        balance_before,balance_after,document_reference,notes,created_by,
        request_id,request_item_id,reservation_id
      ) values (
        v_stock.id,v_request.base_id,v_stock.material_id,'saida',v_reservation.quantity,-v_reservation.quantity,
        v_stock.current_quantity,v_after,'REQ-'||lpad(v_request.request_number::text,5,'0'),
        'Baixa automatica vinculada a requisicao',v_user_id,
        v_request.id,v_reservation.request_item_id,v_reservation.id
      );

      update public.stock_reservations
      set status='consumida',closed_by=v_user_id,closed_at=now()
      where id=v_reservation.id;
    end loop;

    update public.material_requests
    set status='entregue',status_note=null,stock_posted_at=now(),stock_posted_by=v_user_id
    where id=v_request.id
    returning * into v_request;

  else
    perform si.id
    from public.stock_items si
    join public.stock_reservations sr on sr.stock_item_id=si.id
    where sr.request_id=v_request.id and sr.status='ativa'
    order by si.id
    for update of si;

    for v_reservation in
      select * from public.stock_reservations
      where request_id=v_request.id and status='ativa'
      order by stock_item_id,id
      for update
    loop
      update public.stock_items
      set reserved_quantity=reserved_quantity-v_reservation.quantity,
          updated_by=v_user_id,
          updated_at=now()
      where id=v_reservation.stock_item_id
        and reserved_quantity>=v_reservation.quantity;
      if not found then raise exception 'Inconsistencia na reserva. O cancelamento nao foi concluido.'; end if;

      update public.stock_reservations
      set status='liberada',closed_by=v_user_id,closed_at=now()
      where id=v_reservation.id;
    end loop;

    update public.material_requests
    set status='cancelada',status_note=btrim(p_note)
    where id=v_request.id
    returning * into v_request;
  end if;

  return v_request;
end;
$$;

revoke all on function private.transition_material_request(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.transition_material_request(uuid,text,text) to authenticated,service_role;

create or replace function public.transition_material_request(
  p_request_id uuid,
  p_to_status text,
  p_note text default null
)
returns public.material_requests
language sql
security invoker
set search_path = ''
as $$
  select private.transition_material_request(p_request_id,p_to_status,p_note)
$$;

revoke all on function public.transition_material_request(uuid,text,text) from public,anon;
grant execute on function public.transition_material_request(uuid,text,text) to authenticated,service_role;

drop trigger if exists stock_reservations_audit on public.stock_reservations;
create trigger stock_reservations_audit
after insert or update or delete on public.stock_reservations
for each row execute function private.audit_row_change();
