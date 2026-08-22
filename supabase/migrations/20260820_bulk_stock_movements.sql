create table if not exists public.stock_movement_batches (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique,
  base_id uuid not null references public.bases(id),
  movement_date date not null,
  movement_type text not null check (movement_type in ('entrada','saida','ajuste_positivo','ajuste_negativo')),
  document_reference text,
  notes text,
  item_count integer not null check (item_count between 1 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint stock_movement_batches_reference_length check (document_reference is null or char_length(btrim(document_reference)) between 1 and 120),
  constraint stock_movement_batches_notes_length check (notes is null or char_length(btrim(notes)) <= 1000)
);

alter table public.stock_movements
  add column if not exists batch_id uuid references public.stock_movement_batches(id);

create index if not exists stock_movement_batches_base_date_idx
  on public.stock_movement_batches(base_id, movement_date desc, created_at desc);
create index if not exists stock_movement_batches_created_by_idx
  on public.stock_movement_batches(created_by);
create index if not exists stock_movements_batch_id_idx
  on public.stock_movements(batch_id);

comment on table public.stock_movement_batches is 'Cabecalho auditavel de movimentacoes de estoque executadas de forma atomica.';

alter table public.stock_movement_batches enable row level security;

drop policy if exists stock_movement_batches_select on public.stock_movement_batches;
create policy stock_movement_batches_select
on public.stock_movement_batches for select
to authenticated
using ((select private.can_access_base(base_id)));

revoke all on public.stock_movement_batches from public, anon;
revoke insert, update, delete on public.stock_movement_batches from authenticated;
grant select on public.stock_movement_batches to authenticated;
grant all on public.stock_movement_batches to service_role;

create or replace function private.register_stock_movements_batch(
  p_base_id uuid,
  p_movement_date date,
  p_movement_type text,
  p_document_reference text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_batch_id uuid := gen_random_uuid();
  v_protocol text;
  v_created_at timestamptz := now();
  v_count integer;
  v_entry record;
  v_stock public.stock_items%rowtype;
  v_effect numeric(14,3);
  v_after numeric(14,3);
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
  if p_movement_date is null then raise exception 'Informe a data da movimentacao.'; end if;
  if p_movement_type not in ('entrada','saida','ajuste_positivo','ajuste_negativo') then
    raise exception 'Tipo de movimentacao invalido.';
  end if;
  if p_document_reference is not null and char_length(btrim(p_document_reference)) > 120 then
    raise exception 'A referencia deve ter no maximo 120 caracteres.';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 1000 then
    raise exception 'A observacao deve ter no maximo 1000 caracteres.';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'A lista de materiais e invalida.'; end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 100 then
    raise exception 'O lote deve conter entre 1 e 100 materiais.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->>'material_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(item->>'quantity','') !~ '^[0-9]+([.][0-9]{1,3})?$'
       or (item->>'quantity')::numeric <= 0
       or (item->>'quantity')::numeric > 99999999999.999
  ) then
    raise exception 'Existem materiais ou quantidades invalidos no lote.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by item->>'material_id'
    having count(*) > 1
  ) then
    raise exception 'O mesmo material nao pode aparecer duas vezes no lote.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.materials m on m.id = (item->>'material_id')::uuid and m.status = 'ativo'
    where m.id is null
  ) then
    raise exception 'O lote contem material inexistente ou inativo.';
  end if;

  insert into public.stock_items (base_id, material_id, created_by, updated_by)
  select p_base_id, (item->>'material_id')::uuid, v_user_id, v_user_id
  from jsonb_array_elements(p_items) item
  on conflict (base_id, material_id) do nothing;

  perform 1
  from public.stock_items si
  where si.base_id = p_base_id
    and si.material_id in (
      select (item->>'material_id')::uuid from jsonb_array_elements(p_items) item
    )
  order by si.material_id
  for update;

  for v_entry in
    select (item->>'material_id')::uuid as material_id,
           (item->>'quantity')::numeric(14,3) as quantity
    from jsonb_array_elements(p_items) item
    order by (item->>'material_id')::uuid
  loop
    select * into strict v_stock
    from public.stock_items
    where base_id = p_base_id and material_id = v_entry.material_id;

    if not v_stock.is_active then raise exception 'Um dos itens de estoque esta inativo.'; end if;
    v_effect := case when p_movement_type in ('entrada','ajuste_positivo') then v_entry.quantity else -v_entry.quantity end;
    v_after := v_stock.current_quantity + v_effect;
    if v_after < 0 then
      raise exception 'Saldo insuficiente para o material %. Disponivel: %.', v_entry.material_id, v_stock.current_quantity;
    end if;
    if v_after < v_stock.reserved_quantity then
      raise exception 'O material % ficaria abaixo da quantidade reservada (%).', v_entry.material_id, v_stock.reserved_quantity;
    end if;
  end loop;

  v_protocol := 'LOT-' || to_char(p_movement_date, 'YYYYMMDD') || '-' || upper(substr(replace(v_batch_id::text, '-', ''), 1, 8));

  insert into public.stock_movement_batches (
    id, protocol, base_id, movement_date, movement_type, document_reference,
    notes, item_count, created_by, created_at
  ) values (
    v_batch_id, v_protocol, p_base_id, p_movement_date, p_movement_type,
    nullif(btrim(p_document_reference), ''), nullif(btrim(p_notes), ''),
    v_count, v_user_id, v_created_at
  );

  for v_entry in
    select (item->>'material_id')::uuid as material_id,
           (item->>'quantity')::numeric(14,3) as quantity
    from jsonb_array_elements(p_items) item
    order by (item->>'material_id')::uuid
  loop
    select * into strict v_stock
    from public.stock_items
    where base_id = p_base_id and material_id = v_entry.material_id;

    v_effect := case when p_movement_type in ('entrada','ajuste_positivo') then v_entry.quantity else -v_entry.quantity end;
    v_after := v_stock.current_quantity + v_effect;

    update public.stock_items
    set current_quantity = v_after, updated_by = v_user_id, updated_at = v_created_at
    where id = v_stock.id;

    insert into public.stock_movements (
      stock_item_id, base_id, material_id, movement_type, quantity, effect_quantity,
      balance_before, balance_after, document_reference, notes, created_by, created_at, batch_id
    ) values (
      v_stock.id, p_base_id, v_entry.material_id, p_movement_type, v_entry.quantity, v_effect,
      v_stock.current_quantity, v_after,
      left(v_protocol || case when nullif(btrim(p_document_reference), '') is not null then ' · ' || btrim(p_document_reference) else '' end, 120),
      nullif(btrim(p_notes), ''), v_user_id, v_created_at, v_batch_id
    );
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'protocol', v_protocol,
    'item_count', v_count,
    'movement_date', p_movement_date,
    'created_by', v_user_id,
    'created_at', v_created_at
  );
end;
$$;

revoke all on function private.register_stock_movements_batch(uuid,date,text,text,text,jsonb) from public, anon, service_role;
grant execute on function private.register_stock_movements_batch(uuid,date,text,text,text,jsonb) to authenticated;

create or replace function public.register_stock_movements_batch(
  p_base_id uuid,
  p_movement_date date,
  p_movement_type text,
  p_document_reference text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.register_stock_movements_batch(
    p_base_id, p_movement_date, p_movement_type,
    p_document_reference, p_notes, p_items
  )
$$;

revoke all on function public.register_stock_movements_batch(uuid,date,text,text,text,jsonb) from public, anon;
grant execute on function public.register_stock_movements_batch(uuid,date,text,text,text,jsonb) to authenticated, service_role;

drop trigger if exists stock_movement_batches_audit on public.stock_movement_batches;
create trigger stock_movement_batches_audit
after insert or update or delete on public.stock_movement_batches
for each row execute function private.audit_row_change();
