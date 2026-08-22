create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  base_id uuid not null references public.bases(id),
  material_id uuid not null references public.materials(id),
  current_quantity numeric(14,3) not null default 0 check (current_quantity >= 0),
  reserved_quantity numeric(14,3) not null default 0 check (reserved_quantity >= 0 and reserved_quantity <= current_quantity),
  minimum_quantity numeric(14,3) not null default 0 check (minimum_quantity >= 0),
  location text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_items_base_material_key unique (base_id, material_id),
  constraint stock_items_location_length check (location is null or char_length(btrim(location)) between 1 and 120)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id),
  base_id uuid not null references public.bases(id),
  material_id uuid not null references public.materials(id),
  movement_type text not null check (movement_type in ('entrada','saida','ajuste_positivo','ajuste_negativo')),
  quantity numeric(14,3) not null check (quantity > 0),
  effect_quantity numeric(14,3) not null check (effect_quantity <> 0),
  balance_before numeric(14,3) not null check (balance_before >= 0),
  balance_after numeric(14,3) not null check (balance_after >= 0),
  document_reference text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint stock_movements_document_length check (document_reference is null or char_length(btrim(document_reference)) between 1 and 120),
  constraint stock_movements_notes_length check (notes is null or char_length(btrim(notes)) <= 1000)
);

comment on table public.stock_items is 'Saldo atual de cada material por UTD. Alteracoes de quantidade devem ocorrer somente pelo RPC de movimentacao.';
comment on table public.stock_movements is 'Livro-caixa imutavel do estoque, com saldo anterior e posterior por movimentacao.';

create index if not exists stock_items_base_id_idx on public.stock_items(base_id);
create index if not exists stock_items_material_id_idx on public.stock_items(material_id);
create index if not exists stock_items_base_active_idx on public.stock_items(base_id, is_active);
create index if not exists stock_items_created_by_idx on public.stock_items(created_by);
create index if not exists stock_items_updated_by_idx on public.stock_items(updated_by);
create index if not exists stock_movements_stock_item_id_idx on public.stock_movements(stock_item_id);
create index if not exists stock_movements_base_created_at_idx on public.stock_movements(base_id, created_at desc);
create index if not exists stock_movements_material_id_idx on public.stock_movements(material_id);
create index if not exists stock_movements_created_by_idx on public.stock_movements(created_by);
create index if not exists user_bases_user_base_idx on public.user_bases(user_id, base_id);

alter table public.stock_items enable row level security;
alter table public.stock_movements enable row level security;

create or replace function private.can_access_base(target_base_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'ativo'
      and (
        p.role in ('aprovador', 'administrador')
        or exists (
          select 1
          from public.user_bases ub
          where ub.user_id = p.id
            and ub.base_id = target_base_id
        )
      )
  )
$$;

revoke all on function private.can_access_base(uuid) from public, anon, service_role;
grant execute on function private.can_access_base(uuid) to authenticated;

drop policy if exists stock_items_select on public.stock_items;
create policy stock_items_select
on public.stock_items for select
to authenticated
using ((select private.can_access_base(base_id)));

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select
on public.stock_movements for select
to authenticated
using ((select private.can_access_base(base_id)));

revoke all on public.stock_items from anon;
revoke all on public.stock_movements from anon;
revoke insert, update, delete on public.stock_items from authenticated;
revoke insert, update, delete on public.stock_movements from authenticated;
grant select on public.stock_items, public.stock_movements to authenticated;
grant all on public.stock_items, public.stock_movements to service_role;

create or replace function private.register_stock_movement(
  p_base_id uuid,
  p_material_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_document_reference text default null,
  p_notes text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_item public.stock_items%rowtype;
  v_effect numeric(14,3);
  v_after numeric(14,3);
  v_movement public.stock_movements%rowtype;
begin
  if v_user_id is null then raise exception 'Autenticacao obrigatoria.'; end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_user_id and p.account_status = 'ativo';

  if v_role is null then raise exception 'Perfil inativo ou nao autorizado.'; end if;
  if v_role not in ('almoxarife', 'administrador') then
    raise exception 'Seu perfil possui acesso somente para consulta do estoque.';
  end if;
  if v_role = 'almoxarife' and not exists (
    select 1 from public.user_bases ub
    where ub.user_id = v_user_id and ub.base_id = p_base_id
  ) then
    raise exception 'Voce nao possui acesso a esta UTD.';
  end if;
  if not exists (select 1 from public.bases b where b.id = p_base_id and b.is_active) then
    raise exception 'UTD invalida ou inativa.';
  end if;
  if not exists (select 1 from public.materials m where m.id = p_material_id and m.status = 'ativo') then
    raise exception 'Material invalido ou inativo.';
  end if;
  if p_movement_type not in ('entrada','saida','ajuste_positivo','ajuste_negativo') then
    raise exception 'Tipo de movimentacao invalido.';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 99999999999.999 then
    raise exception 'Informe uma quantidade valida e maior que zero.';
  end if;
  if p_document_reference is not null and char_length(btrim(p_document_reference)) > 120 then
    raise exception 'A referencia deve ter no maximo 120 caracteres.';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 1000 then
    raise exception 'A observacao deve ter no maximo 1000 caracteres.';
  end if;

  insert into public.stock_items (base_id, material_id, created_by, updated_by)
  values (p_base_id, p_material_id, v_user_id, v_user_id)
  on conflict (base_id, material_id) do nothing;

  select * into v_item
  from public.stock_items
  where base_id = p_base_id and material_id = p_material_id
  for update;

  if not v_item.is_active then raise exception 'Este item de estoque esta inativo.'; end if;

  v_effect := case when p_movement_type in ('entrada','ajuste_positivo') then p_quantity else -p_quantity end;
  v_after := v_item.current_quantity + v_effect;

  if v_after < 0 then raise exception 'Saldo insuficiente. Disponivel: %.', v_item.current_quantity; end if;
  if v_after < v_item.reserved_quantity then
    raise exception 'A movimentacao reduziria o saldo abaixo da quantidade reservada.';
  end if;

  update public.stock_items
  set current_quantity = v_after,
      updated_by = v_user_id,
      updated_at = now()
  where id = v_item.id;

  insert into public.stock_movements (
    stock_item_id, base_id, material_id, movement_type, quantity, effect_quantity,
    balance_before, balance_after, document_reference, notes, created_by
  ) values (
    v_item.id, p_base_id, p_material_id, p_movement_type, p_quantity, v_effect,
    v_item.current_quantity, v_after, nullif(btrim(p_document_reference), ''),
    nullif(btrim(p_notes), ''), v_user_id
  ) returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function private.register_stock_movement(uuid,uuid,text,numeric,text,text) from public, anon, service_role;
grant execute on function private.register_stock_movement(uuid,uuid,text,numeric,text,text) to authenticated;

create or replace function public.register_stock_movement(
  p_base_id uuid,
  p_material_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_document_reference text default null,
  p_notes text default null
)
returns public.stock_movements
language sql
security invoker
set search_path = ''
as $$
  select private.register_stock_movement(
    p_base_id, p_material_id, p_movement_type, p_quantity,
    p_document_reference, p_notes
  )
$$;

revoke all on function public.register_stock_movement(uuid,uuid,text,numeric,text,text) from public, anon;
grant execute on function public.register_stock_movement(uuid,uuid,text,numeric,text,text) to authenticated, service_role;

drop trigger if exists stock_items_audit on public.stock_items;
create trigger stock_items_audit
after insert or update or delete on public.stock_items
for each row execute function private.audit_row_change();

drop trigger if exists stock_movements_audit on public.stock_movements;
create trigger stock_movements_audit
after insert or update or delete on public.stock_movements
for each row execute function private.audit_row_change();

insert into public.stock_items (base_id, material_id)
select b.id, m.id
from public.bases b
cross join public.materials m
where b.name = 'UTD Piedade'
  and b.is_active
  and m.status = 'ativo'
on conflict (base_id, material_id) do nothing;
