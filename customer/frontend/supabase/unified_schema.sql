-- =========================================================
-- HAPPYTAILS / HYGGE TAILS CAFE - UNIFIED SUPABASE SCHEMA
-- Compatible with:
-- 1) staff/owner web app (staffowner/)
-- 2) customer web app (customer/frontend/)
-- =========================================================

-- Recommended extensions
create extension if not exists pgcrypto;

-- =========================================================
-- ENUMS
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('owner', 'staff', 'customer');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum (
      'pending',
      'preparing',
      'ready',
      'out_for_delivery',
      'completed',
      'delivered',
      'cancelled',
      'refunded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'order_type') then
    create type public.order_type as enum (
      'dine_in',
      'pickup',
      'takeout',
      'delivery'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type public.payment_method as enum (
      'qrph',
      'gcash',
      'maribank',
      'bdo',
      'cash'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum (
      'pending',
      'paid',
      'failed',
      'refunded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'inventory_unit') then
    create type public.inventory_unit as enum ('g', 'kg', 'ml', 'l', 'pcs');
  end if;
end $$;

-- =========================================================
-- UPDATED_AT HELPER
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- CODE GENERATORS
-- =========================================================

create sequence if not exists public.customer_code_seq start 1;
create sequence if not exists public.menu_item_code_seq start 1;
create sequence if not exists public.ingredient_code_seq start 1;
create sequence if not exists public.inventory_item_code_seq start 1;
create sequence if not exists public.order_code_seq start 1;
create sequence if not exists public.import_batch_seq start 1;

create or replace function public.generate_customer_code()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('public.customer_code_seq');
  -- Example: HTC-000001
  return 'HTC-' || lpad(n::text, 6, '0');
end;
$$;

create or replace function public.generate_menu_item_code()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('public.menu_item_code_seq');
  return 'MI-' || lpad(n::text, 5, '0');
end;
$$;

create or replace function public.generate_ingredient_code()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('public.ingredient_code_seq');
  return 'ING-' || lpad(n::text, 5, '0');
end;
$$;

create or replace function public.generate_inventory_item_code()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('public.inventory_item_code_seq');
  return 'INV-' || lpad(n::text, 5, '0');
end;
$$;

create or replace function public.generate_order_code()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('public.order_code_seq');
  return 'ORD-' || lpad(n::text, 6, '0');
end;
$$;

create or replace function public.generate_import_batch_code()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('public.import_batch_seq');
  return 'IMP-' || lpad(n::text, 6, '0');
end;
$$;

-- =========================================================
-- PROFILES / USERS
-- auth.users is managed by Supabase Auth
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  customer_code text unique,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  addresses jsonb not null default '[]'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_code_required_for_customers check (
    (role <> 'customer') or (customer_code is not null)
  )
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_customer_code on public.profiles(customer_code);

-- Keep the customer code sequence aligned with existing rows (safe to re-run).
do $$
declare
  max_suffix bigint;
  seq_last bigint;
  seq_called boolean;
begin
  select coalesce(max(substring(customer_code from '[0-9]+$')::bigint), 0)
    into max_suffix
  from public.profiles
  where customer_code like 'HTC-%';

  if max_suffix > 0 then
    select last_value, is_called into seq_last, seq_called
    from public.customer_code_seq;

    if seq_last < max_suffix or (seq_last = max_suffix and seq_called = false) then
      perform setval('public.customer_code_seq', max_suffix, true);
    end if;
  end if;
end $$;

-- =========================================================
-- ROLE HELPER FUNCTIONS (used by RLS + triggers)
-- =========================================================

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner_or_staff()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_app_role() in ('owner', 'staff'), false)
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_app_role() = 'owner', false)
$$;

-- =========================================================
-- Auto-create profile row on signup
-- =========================================================

-- ADMIN NOTE: Promote users to staff/owner via a service-role / SQL editor update to public.profiles.role.
-- There is intentionally no public or client-side signup path for elevated roles.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  full_name text;
begin
  full_name := coalesce(new.raw_user_meta_data->>'name', '');

  -- SECURITY: never trust client-provided role metadata on public signup.
  -- All new users start as 'customer'. Elevated roles must be granted server-side
  -- (SQL editor / service role / explicit admin flow).

  insert into public.profiles (
    id,
    role,
    customer_code,
    name,
    email,
    phone
  )
  values (
    new.id,
    'customer'::public.app_role,
    public.generate_customer_code(),
    full_name,
    coalesce(new.email, ''),
    coalesce(new.phone, '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

-- Backfill profile rows for users created before this trigger existed.
insert into public.profiles (
  id,
  role,
  customer_code,
  name,
  email,
  phone
)
select
  au.id,
  'customer'::public.app_role,
  public.generate_customer_code(),
  coalesce(au.raw_user_meta_data->>'name', ''),
  coalesce(au.email, ''),
  coalesce(au.phone, '')
from auth.users au
left join public.profiles p on p.id = au.id
where p.id is null
on conflict (id) do nothing;

-- Prevent customers/staff from escalating their own role via profile updates.
create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow SQL editor / service operations (no JWT context).
  if auth.uid() is null then
    return new;
  end if;

  -- Only owners may change role / is_active for any profile.
  if (new.role is distinct from old.role) or (new.is_active is distinct from old.is_active) then
    if not public.is_owner() then
      raise exception 'Only owners may change roles or deactivate accounts.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_escalation on public.profiles;
create trigger trg_profiles_prevent_escalation
before update on public.profiles
for each row execute procedure public.prevent_profile_privilege_escalation();

-- =========================================================
-- LOGIN HISTORY
-- =========================================================

create table if not exists public.login_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text,
  role public.app_role,
  success boolean not null default true,
  device text,
  ip_address inet,
  user_agent text,
  logged_in_at timestamptz not null default now(),
  logged_out_at timestamptz
);

create index if not exists idx_login_history_profile_id on public.login_history(profile_id);
create index if not exists idx_login_history_logged_in_at on public.login_history(logged_in_at desc);

-- Only allow non-staff users to set logged_out_at on their own login row.
create or replace function public.enforce_login_history_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow SQL editor / service operations (no JWT context).
  if auth.uid() is null then
    return new;
  end if;

  -- Staff/owner can manage login history freely (still governed by RLS).
  if public.is_owner_or_staff() then
    return new;
  end if;

  if old.profile_id is distinct from auth.uid() then
    raise exception 'You can only update your own login history.';
  end if;

  -- Non-staff users may only set logged_out_at once.
  if new.logged_out_at is distinct from old.logged_out_at then
    if old.logged_out_at is not null then
      raise exception 'Logout time is already set.';
    end if;

    -- Prevent tampering with all other columns.
    new.profile_id := old.profile_id;
    new.email := old.email;
    new.role := old.role;
    new.success := old.success;
    new.device := old.device;
    new.ip_address := old.ip_address;
    new.user_agent := old.user_agent;
    new.logged_in_at := old.logged_in_at;
    return new;
  end if;

  raise exception 'Only logout time may be updated.';
end;
$$;

drop trigger if exists trg_login_history_enforce_update_rules on public.login_history;
create trigger trg_login_history_enforce_update_rules
before update on public.login_history
for each row execute procedure public.enforce_login_history_update_rules();

-- =========================================================
-- MENU
-- =========================================================

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_menu_categories_updated_at on public.menu_categories;
create trigger trg_menu_categories_updated_at
before update on public.menu_categories
for each row execute procedure public.set_updated_at();

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.generate_menu_item_code(),
  category_id uuid not null references public.menu_categories(id) on delete restrict,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  is_available boolean not null default true,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(category_id, name)
);

create index if not exists idx_menu_items_category_id on public.menu_items(category_id);
create index if not exists idx_menu_items_code on public.menu_items(code);
create index if not exists idx_menu_items_is_available on public.menu_items(is_available);

drop trigger if exists trg_menu_items_updated_at on public.menu_items;
create trigger trg_menu_items_updated_at
before update on public.menu_items
for each row execute procedure public.set_updated_at();

-- =========================================================
-- LEGACY INGREDIENT-BASED INVENTORY (BACKWARD COMPATIBILITY)
-- =========================================================

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.generate_ingredient_code(),
  name text not null unique,
  unit public.inventory_unit not null,
  stock_on_hand numeric(12,3) not null default 0 check (stock_on_hand >= 0),
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ingredients_updated_at on public.ingredients;
create trigger trg_ingredients_updated_at
before update on public.ingredients
for each row execute procedure public.set_updated_at();

create table if not exists public.menu_item_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity_required numeric(12,3) not null check (quantity_required > 0),
  created_at timestamptz not null default now(),
  unique(menu_item_id, ingredient_id)
);

create index if not exists idx_recipe_menu_item_id on public.menu_item_recipe_lines(menu_item_id);
create index if not exists idx_recipe_ingredient_id on public.menu_item_recipe_lines(ingredient_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  movement_type text not null check (movement_type in ('stock_in', 'stock_out', 'adjustment', 'consumption')),
  quantity numeric(12,3) not null,
  reference_table text,
  reference_id uuid,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_movements_ingredient_id on public.inventory_movements(ingredient_id);
create index if not exists idx_inventory_movements_created_at on public.inventory_movements(created_at desc);

-- =========================================================
-- CATEGORIZED INVENTORY TRACKER (CURRENT)
-- =========================================================

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_inventory_categories_updated_at on public.inventory_categories;
create trigger trg_inventory_categories_updated_at
before update on public.inventory_categories
for each row execute procedure public.set_updated_at();

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.generate_inventory_item_code(),
  category_id uuid not null references public.inventory_categories(id) on delete restrict,
  name text not null,
  unit text not null default 'pcs',
  quantity_on_hand numeric(12,3) not null default 0 check (quantity_on_hand >= 0),
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  display_quantity text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(category_id, name)
);

drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at
before update on public.inventory_items
for each row execute procedure public.set_updated_at();

create index if not exists idx_inventory_items_category_id on public.inventory_items(category_id);
create index if not exists idx_inventory_items_code on public.inventory_items(code);
create index if not exists idx_inventory_items_is_active on public.inventory_items(is_active);
create index if not exists idx_inventory_items_quantity_on_hand on public.inventory_items(quantity_on_hand);

create table if not exists public.inventory_item_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('stock_in', 'stock_out', 'adjustment')),
  quantity numeric(12,3) not null check (quantity > 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_item_movements_item_id on public.inventory_item_movements(inventory_item_id);
create index if not exists idx_inventory_item_movements_created_at on public.inventory_item_movements(created_at desc);

-- =========================================================
-- DAILY MENU
-- =========================================================

create table if not exists public.daily_menus (
  id uuid primary key default gen_random_uuid(),
  menu_date date not null unique,
  is_published boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_daily_menus_updated_at on public.daily_menus;
create trigger trg_daily_menus_updated_at
before update on public.daily_menus
for each row execute procedure public.set_updated_at();

create table if not exists public.daily_menu_items (
  id uuid primary key default gen_random_uuid(),
  daily_menu_id uuid not null references public.daily_menus(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(daily_menu_id, menu_item_id)
);

create index if not exists idx_daily_menu_items_daily_menu_id on public.daily_menu_items(daily_menu_id);

-- =========================================================
-- LOYALTY
-- =========================================================

create table if not exists public.loyalty_accounts (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  stamp_count integer not null default 0 check (stamp_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  required_stamps integer not null check (required_stamps > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  reward_id uuid not null references public.loyalty_rewards(id) on delete restrict,
  redeemed_at timestamptz not null default now(),
  notes text
);

create index if not exists idx_loyalty_redemptions_customer_id on public.loyalty_redemptions(customer_id);

create or replace function public.touch_loyalty_account_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_loyalty_accounts_updated_at on public.loyalty_accounts;
create trigger trg_loyalty_accounts_updated_at
before update on public.loyalty_accounts
for each row execute procedure public.touch_loyalty_account_updated_at();

-- =========================================================
-- ORDERS
-- =========================================================

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.generate_order_code(),
  customer_id uuid references public.profiles(id) on delete set null,
  order_type public.order_type not null,
  status public.order_status not null default 'pending',
  payment_method public.payment_method,
  payment_status public.payment_status not null default 'pending',
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(10,2) not null default 0 check (discount_total >= 0),
  total_amount numeric(10,2) not null default 0 check (total_amount >= 0),
  receipt_image_url text,
  notes text,
  delivery_address jsonb,
  placed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_customer_id on public.orders(customer_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_payment_status on public.orders(payment_status);
create index if not exists idx_orders_placed_at on public.orders(placed_at desc);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

-- Transactional order creation for customers: ensures orders, items, and initial history are written atomically.
create or replace function public.create_customer_order(
  p_order_type public.order_type,
  p_payment_method public.payment_method,
  p_subtotal numeric,
  p_discount_total numeric,
  p_total_amount numeric,
  p_items jsonb,
  p_receipt_image_url text default null,
  p_notes text default null,
  p_delivery_address jsonb default null,
  p_placed_at timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_order public.orders%rowtype;
  v_item_count integer;
  v_inserted_item_count integer;
begin
  v_customer_id := auth.uid();
  if v_customer_id is null then
    raise exception 'Authentication required.';
  end if;

  v_item_count := coalesce(jsonb_array_length(p_items), 0);
  if v_item_count = 0 then
    raise exception 'At least one order item is required.';
  end if;

  if coalesce(p_subtotal, 0) < 0
    or coalesce(p_discount_total, 0) < 0
    or coalesce(p_total_amount, 0) < 0
  then
    raise exception 'Order totals cannot be negative.';
  end if;

  if coalesce(p_discount_total, 0) > coalesce(p_subtotal, 0) then
    raise exception 'Discount total cannot exceed subtotal.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(
      menu_item_id uuid,
      menu_item_code text,
      item_name text,
      unit_price numeric,
      discount_amount numeric,
      quantity integer,
      line_total numeric
    )
    where coalesce(trim(x.item_name), '') = ''
      or coalesce(x.quantity, 0) <= 0
      or coalesce(x.unit_price, 0) < 0
      or coalesce(x.discount_amount, 0) < 0
      or coalesce(x.line_total, 0) < 0
  ) then
    raise exception 'Each order item must include a valid name, quantity, and non-negative amounts.';
  end if;

  insert into public.orders (
    customer_id,
    order_type,
    status,
    payment_method,
    payment_status,
    subtotal,
    discount_total,
    total_amount,
    receipt_image_url,
    notes,
    delivery_address,
    placed_at
  )
  values (
    v_customer_id,
    p_order_type,
    'pending',
    p_payment_method,
    'pending',
    coalesce(p_subtotal, 0),
    coalesce(p_discount_total, 0),
    coalesce(p_total_amount, 0),
    p_receipt_image_url,
    p_notes,
    p_delivery_address,
    coalesce(p_placed_at, now())
  )
  returning * into v_order;

  insert into public.order_items (
    order_id,
    menu_item_id,
    menu_item_code,
    item_name,
    unit_price,
    discount_amount,
    quantity,
    line_total
  )
  select
    v_order.id,
    menu_item_id,
    menu_item_code,
    item_name,
    coalesce(unit_price, 0),
    coalesce(discount_amount, 0),
    greatest(quantity, 1),
    coalesce(line_total, 0)
  from jsonb_to_recordset(p_items) as x(
    menu_item_id uuid,
    menu_item_code text,
    item_name text,
    unit_price numeric,
    discount_amount numeric,
    quantity integer,
    line_total numeric
  );
  get diagnostics v_inserted_item_count = row_count;

  if v_inserted_item_count <> v_item_count then
    raise exception 'Invalid order items payload.';
  end if;

  insert into public.order_status_history (
    order_id,
    status,
    changed_by,
    note,
    changed_at
  )
  values (
    v_order.id,
    'pending',
    v_customer_id,
    'Order placed',
    coalesce(p_placed_at, now())
  );

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.order_id = v_order.id),
      '[]'::jsonb
    ),
    'history', coalesce(
      (select jsonb_agg(to_jsonb(h) order by h.changed_at) from public.order_status_history h where h.order_id = v_order.id),
      '[]'::jsonb
    )
  );
end;
$$;

-- Allow customer cancellation safely (status only, within a short window).
create or replace function public.enforce_order_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow SQL editor / service operations (no JWT context).
  if auth.uid() is null then
    return new;
  end if;

  -- Staff/owner can manage orders freely (still governed by RLS).
  if public.is_owner_or_staff() then
    return new;
  end if;

  -- Customers may only cancel their own pending order within 5 minutes.
  if old.customer_id is distinct from auth.uid() then
    raise exception 'You can only update your own orders.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending'
      and new.status = 'cancelled'
      and old.placed_at >= now() - interval '5 minutes'
    then
      -- Prevent tampering with anything except status (+ updated_at via trigger).
      new.code := old.code;
      new.customer_id := old.customer_id;
      new.order_type := old.order_type;
      new.payment_method := old.payment_method;
      new.payment_status := old.payment_status;
      new.subtotal := old.subtotal;
      new.discount_total := old.discount_total;
      new.total_amount := old.total_amount;
      new.receipt_image_url := old.receipt_image_url;
      new.notes := old.notes;
      new.delivery_address := old.delivery_address;
      new.placed_at := old.placed_at;
      new.created_at := old.created_at;
      return new;
    end if;
  end if;

  raise exception 'Customers can only cancel pending orders within 5 minutes of placing them.';
end;
$$;

drop trigger if exists trg_orders_enforce_update_rules on public.orders;
create trigger trg_orders_enforce_update_rules
before update on public.orders
for each row execute procedure public.enforce_order_update_rules();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  menu_item_code text,
  item_name text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  discount_amount numeric(10,2) not null default 0 check (discount_amount >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(10,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_items_menu_item_id on public.order_items(menu_item_id);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  note text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_order_status_history_order_id on public.order_status_history(order_id);
create index if not exists idx_order_status_history_changed_at on public.order_status_history(changed_at desc);

-- =========================================================
-- HISTORICAL SALES IMPORTS (staffowner app)
-- =========================================================

create table if not exists public.sales_import_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.generate_import_batch_code(),
  type text not null default 'sales' check (type in ('sales')),
  created_by uuid references public.profiles(id) on delete set null,
  file_name text,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.imported_sales_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.sales_import_batches(id) on delete cascade,
  date timestamptz not null,
  sales_total numeric(10,2) not null default 0 check (sales_total >= 0),
  payment_method text not null default 'unknown',
  status public.order_status not null default 'completed',
  customer_code text,
  item_code text,
  created_at timestamptz not null default now(),
  unique(date, customer_code)
);

create index if not exists idx_imported_sales_rows_batch_id on public.imported_sales_rows(batch_id);
create index if not exists idx_imported_sales_rows_date on public.imported_sales_rows(date desc);

-- =========================================================
-- IMPORT ERRORS (staffowner CSV imports)
-- =========================================================

create table if not exists public.import_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.sales_import_batches(id) on delete cascade,
  row_number integer not null,
  reason text not null,
  raw_row jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_import_errors_batch_id on public.import_errors(batch_id);

-- =========================================================
-- HELPER VIEW: MENU EFFECTIVE AVAILABILITY
-- Exposes full menu item fields + computed effective availability.
-- =========================================================

create or replace view public.menu_item_effective_availability as
select
  mi.id,
  mi.code,
  mi.category_id,
  mc.name as category_name,
  mi.name,
  mi.description,
  mi.price,
  mi.discount,
  mi.is_available,
  mi.image_url,
  mi.created_at,
  mi.updated_at,
  case
    when mi.is_available = false then false
    else true
  end as effective_is_available
from public.menu_items mi
join public.menu_categories mc on mc.id = mi.category_id;

-- =========================================================
-- HELPER VIEW: DASHBOARD SALES FEED (LIVE + IMPORTED)
-- =========================================================

create or replace view public.dashboard_sales_feed as
select
  o.id as source_id,
  'live_order'::text as source_type,
  o.placed_at as occurred_at,
  o.total_amount as amount,
  o.status,
  o.payment_status
from public.orders o

union all

select
  isr.id as source_id,
  'imported_sale'::text as source_type,
  isr.date as occurred_at,
  isr.sales_total as amount,
  isr.status,
  'paid'::public.payment_status as payment_status
from public.imported_sales_rows isr;

-- =========================================================
-- CATEGORY + MENU ITEM SEED
-- =========================================================

insert into public.menu_categories (name, sort_order)
values
  ('Pasta & Sandwiches', 1),
  ('Rice Meals', 2),
  ('Iced Coffee (16oz)', 3),
  ('Hot Coffee (8oz)', 4),
  ('Non-Caffeinated', 5),
  ('Frappuccino (16oz)', 6)
on conflict (name) do nothing;

insert into public.menu_items (code, category_id, name, description, price, discount, is_available)
values
-- Pasta & Sandwiches
('MI-00001', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Baked Macaroni', null, 190, 0, true),
('MI-00002', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Chicken Alfredo Pasta', null, 190, 0, true),
('MI-00003', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Chicken Macaroni Salad', null, 120, 0, true),
('MI-00004', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Cheesy Beef Burger', null, 150, 0, true),
('MI-00005', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Chicken Popcorn', null, 120, 0, true),
('MI-00006', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Fish & Fries (good for sharing)', null, 200, 0, true),
('MI-00007', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Grilled Cheese Sandwich', null, 70, 0, true),
('MI-00008', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Homemade Pork Siomai (4pcs)', null, 60, 0, true),
('MI-00009', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Toasted Cheesy Hungarian Sandwich', null, 90, 0, true),
('MI-00010', (select id from public.menu_categories where lower(name)='pasta & sandwiches' limit 1), 'Toasted Tuna Sandwich', null, 90, 0, true),
-- Rice Meals
('MI-00011', (select id from public.menu_categories where lower(name)='rice meals' limit 1), 'Breaded Fish Fillet with Rice', null, 140, 0, true),
('MI-00012', (select id from public.menu_categories where lower(name)='rice meals' limit 1), 'Burger Steak with Rice', null, 160, 0, true),
('MI-00013', (select id from public.menu_categories where lower(name)='rice meals' limit 1), 'Chicken Cordon Bleu with Rice', null, 180, 0, true),
('MI-00014', (select id from public.menu_categories where lower(name)='rice meals' limit 1), 'Chicken Poppers with Rice', null, 140, 0, true),
('MI-00015', (select id from public.menu_categories where lower(name)='rice meals' limit 1), 'Homemade Pork Embotido with Rice', null, 150, 0, true),
('MI-00016', (select id from public.menu_categories where lower(name)='rice meals' limit 1), 'Homemade Pork Siomai (4pcs) with Rice', null, 80, 0, true),
('MI-00017', (select id from public.menu_categories where lower(name)='rice meals' limit 1), 'Hungarian Sausage with Rice', null, 120, 0, true),
-- Iced Coffee
('MI-00018', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Americano', null, 100, 0, true),
('MI-00019', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Cafe Latte', null, 120, 0, true),
('MI-00020', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Caramel Macchiato', null, 145, 0, true),
('MI-00021', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Cloud Americano', null, 120, 0, true),
('MI-00022', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Iced Caramel Latte', null, 135, 0, true),
('MI-00023', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Iced Cocoa Tiramisu', null, 160, 0, true),
('MI-00024', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Iced Coconut Latte', null, 145, 0, true),
('MI-00025', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Iced Hazelnut Latte', null, 135, 0, true),
('MI-00026', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Iced Matcha Latte', null, 135, 0, true),
('MI-00027', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Iced Mocha Latte', null, 135, 0, true),
('MI-00028', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Iced Vanilla Latte', null, 135, 0, true),
('MI-00029', (select id from public.menu_categories where lower(name)='iced coffee (16oz)' limit 1), 'Spanish Latte', null, 140, 0, true),
-- Hot Coffee
('MI-00030', (select id from public.menu_categories where lower(name)='hot coffee (8oz)' limit 1), 'Americano', null, 90, 0, true),
('MI-00031', (select id from public.menu_categories where lower(name)='hot coffee (8oz)' limit 1), 'Cafe Latte', null, 110, 0, true),
('MI-00032', (select id from public.menu_categories where lower(name)='hot coffee (8oz)' limit 1), 'Caramel Macchiato', null, 130, 0, true),
('MI-00033', (select id from public.menu_categories where lower(name)='hot coffee (8oz)' limit 1), 'Matcha Latte', null, 110, 0, true),
('MI-00034', (select id from public.menu_categories where lower(name)='hot coffee (8oz)' limit 1), 'Spanish Latte', null, 120, 0, true),
-- Non-Caffeinated
('MI-00035', (select id from public.menu_categories where lower(name)='non-caffeinated' limit 1), 'Four Seasons', null, 90, 0, true),
('MI-00036', (select id from public.menu_categories where lower(name)='non-caffeinated' limit 1), 'Hot Chocolate', null, 110, 0, true),
('MI-00037', (select id from public.menu_categories where lower(name)='non-caffeinated' limit 1), 'Iced Choco Milk', null, 120, 0, true),
('MI-00038', (select id from public.menu_categories where lower(name)='non-caffeinated' limit 1), 'Strawberry Milk', null, 120, 0, true),
('MI-00039', (select id from public.menu_categories where lower(name)='non-caffeinated' limit 1), 'Blueberry Soda', null, 90, 0, true),
('MI-00040', (select id from public.menu_categories where lower(name)='non-caffeinated' limit 1), 'Green Apple Soda', null, 90, 0, true),
('MI-00041', (select id from public.menu_categories where lower(name)='non-caffeinated' limit 1), 'Strawberry Soda', null, 90, 0, true),
-- Frappuccino
('MI-00042', (select id from public.menu_categories where lower(name)='frappuccino (16oz)' limit 1), 'Caramel Macchiato Frappe', null, 170, 0, true),
('MI-00043', (select id from public.menu_categories where lower(name)='frappuccino (16oz)' limit 1), 'Choco Java Chip Frappe', null, 170, 0, true),
('MI-00044', (select id from public.menu_categories where lower(name)='frappuccino (16oz)' limit 1), 'Matcha Frappe', null, 170, 0, true),
('MI-00045', (select id from public.menu_categories where lower(name)='frappuccino (16oz)' limit 1), 'Peanut Butter Choco Frappe', null, 175, 0, true),
('MI-00046', (select id from public.menu_categories where lower(name)='frappuccino (16oz)' limit 1), 'Strawberry Frappe', null, 170, 0, true)
on conflict (code) do nothing;

-- Keep future auto-generated codes after the seeded set (use max numeric suffix, not row count).
select setval(
  'public.menu_item_code_seq',
  greatest(
    coalesce((select max(substring(code from '[0-9]+$')::bigint) from public.menu_items where code like 'MI-%'), 0),
    46
  ),
  true
);

-- Legacy optional starter ingredients
insert into public.ingredients (code, name, unit, stock_on_hand, reorder_level, is_active)
values
  ('ING-00001', 'Sugar', 'g', 5000, 1000, true),
  ('ING-00002', 'Coffee Grounds', 'g', 3000, 500, true),
  ('ING-00003', 'Milk', 'ml', 10000, 2000, true),
  ('ING-00004', 'Rice', 'g', 8000, 2000, true),
  ('ING-00005', 'Chocolate Syrup', 'ml', 2000, 500, true),
  ('ING-00006', 'Caramel Syrup', 'ml', 2000, 500, true),
  ('ING-00007', 'Matcha Powder', 'g', 1000, 200, true),
  ('ING-00008', 'Ice', 'pcs', 1000, 200, true),
  ('ING-00009', 'Cups 16oz', 'pcs', 500, 100, true),
  ('ING-00010', 'Cups 8oz', 'pcs', 500, 100, true)
on conflict (code) do nothing;

select setval(
  'public.ingredient_code_seq',
  greatest(
    coalesce((select max(substring(code from '[0-9]+$')::bigint) from public.ingredients where code like 'ING-%'), 0),
    10
  ),
  true
);

-- Starter categories for the new categorized inventory tracker
insert into public.inventory_categories (name, sort_order, is_active)
values
  ('Cafe Kitchen', 1, true),
  ('Sandwich and Breakfast', 2, true),
  ('Condiments and Drinks', 3, true),
  ('Syrups and Spreads', 4, true),
  ('Packaging', 5, true),
  ('Plastic Bags', 6, true),
  ('Cleaning and Utilities', 7, true),
  ('Pet Items', 8, true)
on conflict (name) do update
set
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

-- Starter inventory items mapped from the categorized tracker list
insert into public.inventory_items (
  code,
  category_id,
  name,
  unit,
  quantity_on_hand,
  reorder_level,
  display_quantity,
  notes,
  is_active
)
values
  ('INV-00001', (select id from public.inventory_categories where name = 'Cafe Kitchen' limit 1), 'Pasta', 'orders', 12, 5, '12', null, true),
  ('INV-00002', (select id from public.inventory_categories where name = 'Cafe Kitchen' limit 1), 'Alfredo sauce', 'orders', 5, 3, '5', null, true),
  ('INV-00003', (select id from public.inventory_categories where name = 'Cafe Kitchen' limit 1), 'Carbonara sauce', 'orders', 3, 3, '3', null, true),
  ('INV-00004', (select id from public.inventory_categories where name = 'Cafe Kitchen' limit 1), 'Pesto sauce', 'orders', 1, 2, '1', null, true),
  ('INV-00005', (select id from public.inventory_categories where name = 'Cafe Kitchen' limit 1), 'Chicken fillet', 'pcs', 0, 2, '0', null, true),
  ('INV-00006', (select id from public.inventory_categories where name = 'Cafe Kitchen' limit 1), 'Chicken tenders', 'pcs', 12, 5, '12', null, true),
  ('INV-00007', (select id from public.inventory_categories where name = 'Cafe Kitchen' limit 1), 'Hashbrown', 'orders', 6, 3, '6', null, true),
  ('INV-00008', (select id from public.inventory_categories where name = 'Sandwich and Breakfast' limit 1), 'Eggs', 'pcs', 4, 4, '4', null, true),
  ('INV-00009', (select id from public.inventory_categories where name = 'Sandwich and Breakfast' limit 1), 'Eden sliced cheese', 'pcs', 14, 6, '14', null, true),
  ('INV-00010', (select id from public.inventory_categories where name = 'Sandwich and Breakfast' limit 1), 'Burger bun', 'pcs', 2, 3, '2', null, true),
  ('INV-00011', (select id from public.inventory_categories where name = 'Condiments and Drinks' limit 1), 'UFC gravy', 'packs', 7, 3, '7', null, true),
  ('INV-00012', (select id from public.inventory_categories where name = 'Condiments and Drinks' limit 1), 'Sweet chili sauce', 'orders', 5, 3, '5', null, true),
  ('INV-00013', (select id from public.inventory_categories where name = 'Condiments and Drinks' limit 1), 'Purified bottled water', 'bottles', 5, 5, '5', null, true),
  ('INV-00014', (select id from public.inventory_categories where name = 'Condiments and Drinks' limit 1), 'Sprite', 'liters', 2.5, 2, '2 1/2', null, true),
  ('INV-00015', (select id from public.inventory_categories where name = 'Syrups and Spreads' limit 1), 'Hazelnut syrup', 'bottles', 1, 1, '1', null, true),
  ('INV-00016', (select id from public.inventory_categories where name = 'Syrups and Spreads' limit 1), 'Sugar syrup', 'bottles', 1, 1, '1', null, true),
  ('INV-00017', (select id from public.inventory_categories where name = 'Syrups and Spreads' limit 1), 'Tiramisu syrup', 'bottles', 1.5, 1, '1 1/2', null, true),
  ('INV-00018', (select id from public.inventory_categories where name = 'Syrups and Spreads' limit 1), 'Strawberry jam', 'jar', 0.75, 1, '3/4', null, true),
  ('INV-00019', (select id from public.inventory_categories where name = 'Packaging' limit 1), '8oz cup', 'pcs', 22, 20, '22', null, true),
  ('INV-00020', (select id from public.inventory_categories where name = 'Packaging' limit 1), '8oz lid', 'pcs', 73, 30, '73', null, true),
  ('INV-00021', (select id from public.inventory_categories where name = 'Packaging' limit 1), '8oz new cup (HappyTails)', 'pcs', 0, 20, '0', 'May bawas na', true),
  ('INV-00022', (select id from public.inventory_categories where name = 'Packaging' limit 1), '8oz new lid (HappyTails)', 'pcs', 21, 20, '21', 'May bawas na', true),
  ('INV-00023', (select id from public.inventory_categories where name = 'Packaging' limit 1), 'Table napkin', 'pack', 1, 1, '1', 'May bawas na', true),
  ('INV-00024', (select id from public.inventory_categories where name = 'Packaging' limit 1), 'Thermal paper', 'rolls', 0, 2, '0', null, true),
  ('INV-00025', (select id from public.inventory_categories where name = 'Packaging' limit 1), 'Maya thermal paper', 'pcs', 35, 20, '35', null, true),
  ('INV-00026', (select id from public.inventory_categories where name = 'Packaging' limit 1), 'Takeout box large (styro)', 'pcs', 4, 3, '4', 'For humans', true),
  ('INV-00027', (select id from public.inventory_categories where name = 'Packaging' limit 1), 'Takeout box small', 'pcs', 12, 6, '12', 'For pets', true),
  ('INV-00028', (select id from public.inventory_categories where name = 'Plastic Bags' limit 1), 'Thankyou plastic takeout XS', 'pack', 1, 1, '1', null, true),
  ('INV-00029', (select id from public.inventory_categories where name = 'Plastic Bags' limit 1), 'Thankyou plastic takeout S', 'pack', 0, 1, '0', null, true),
  ('INV-00030', (select id from public.inventory_categories where name = 'Plastic Bags' limit 1), 'Thankyou plastic takeout M', 'pack', 1, 1, '1', null, true),
  ('INV-00031', (select id from public.inventory_categories where name = 'Plastic Bags' limit 1), 'Thankyou plastic takeout L', 'pack', 1, 1, '1', null, true),
  ('INV-00032', (select id from public.inventory_categories where name = 'Cleaning and Utilities' limit 1), 'Sponge', 'pcs', 1, 1, '1', null, true),
  ('INV-00033', (select id from public.inventory_categories where name = 'Cleaning and Utilities' limit 1), 'Trash bag', 'pack', 1, 1, '1', 'May bawas na', true),
  ('INV-00034', (select id from public.inventory_categories where name = 'Cleaning and Utilities' limit 1), 'Alcohol', 'bottle', 0.25, 1, '1/4', null, true),
  ('INV-00035', (select id from public.inventory_categories where name = 'Cleaning and Utilities' limit 1), 'Dishwashing liquid', 'bottle', 0.25, 1, '1/4', null, true),
  ('INV-00036', (select id from public.inventory_categories where name = 'Cleaning and Utilities' limit 1), 'Hand soap', 'bottle', 0.75, 1, '3/4', null, true),
  ('INV-00037', (select id from public.inventory_categories where name = 'Cleaning and Utilities' limit 1), 'Lysol', 'bottle', 0, 1, '0', null, true),
  ('INV-00038', (select id from public.inventory_categories where name = 'Pet Items' limit 1), 'Pet treat original', 'packs', 3, 1, '3', null, true),
  ('INV-00039', (select id from public.inventory_categories where name = 'Pet Items' limit 1), 'Pet treat chicken liver', 'pack', 0.25, 1, '1/4', null, true),
  ('INV-00040', (select id from public.inventory_categories where name = 'Pet Items' limit 1), 'Pet treat pork liver', 'pack', 0, 1, '0', null, true)
on conflict (code) do nothing;

select setval(
  'public.inventory_item_code_seq',
  greatest(
    coalesce((select max(substring(code from '[0-9]+$')::bigint) from public.inventory_items where code like 'INV-%'), 0),
    40
  ),
  true
);

-- Optional starter loyalty rewards
insert into public.loyalty_rewards (label, required_stamps, is_active)
values
  ('Free Drink Upgrade', 6, true),
  ('Free Coffee', 10, true)
on conflict do nothing;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.profiles enable row level security;
alter table public.login_history enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.ingredients enable row level security;
alter table public.menu_item_recipe_lines enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_movements enable row level security;
alter table public.daily_menus enable row level security;
alter table public.daily_menu_items enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.sales_import_batches enable row level security;
alter table public.imported_sales_rows enable row level security;
alter table public.import_errors enable row level security;

-- =========================================================
-- POLICIES
-- =========================================================

-- profiles
drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff"
on public.profiles for select
using (
  auth.uid() = id or public.is_owner_or_staff()
);

drop policy if exists "profiles_update_own_or_owner" on public.profiles;
create policy "profiles_update_own_or_owner"
on public.profiles for update
using (
  auth.uid() = id or public.is_owner()
)
with check (
  auth.uid() = id or public.is_owner()
);

-- public menu readable by everyone
drop policy if exists "menu_categories_read_all" on public.menu_categories;
create policy "menu_categories_read_all"
on public.menu_categories for select
using (true);

drop policy if exists "menu_items_read_all" on public.menu_items;
create policy "menu_items_read_all"
on public.menu_items for select
using (true);

drop policy if exists "daily_menus_read_all" on public.daily_menus;
create policy "daily_menus_read_all"
on public.daily_menus for select
using (true);

drop policy if exists "daily_menu_items_read_all" on public.daily_menu_items;
create policy "daily_menu_items_read_all"
on public.daily_menu_items for select
using (true);

drop policy if exists "loyalty_rewards_read_all" on public.loyalty_rewards;
create policy "loyalty_rewards_read_all"
on public.loyalty_rewards for select
using (true);

-- owner/staff manage menu/inventory
drop policy if exists "menu_categories_manage_owner_staff" on public.menu_categories;
create policy "menu_categories_manage_owner_staff"
on public.menu_categories for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "menu_items_manage_owner_staff" on public.menu_items;
create policy "menu_items_manage_owner_staff"
on public.menu_items for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "ingredients_manage_owner_staff" on public.ingredients;
create policy "ingredients_manage_owner_staff"
on public.ingredients for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "recipe_lines_manage_owner_staff" on public.menu_item_recipe_lines;
create policy "recipe_lines_manage_owner_staff"
on public.menu_item_recipe_lines for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "inventory_movements_manage_owner_staff" on public.inventory_movements;
create policy "inventory_movements_manage_owner_staff"
on public.inventory_movements for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "inventory_categories_manage_owner_staff" on public.inventory_categories;
create policy "inventory_categories_manage_owner_staff"
on public.inventory_categories for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "inventory_items_manage_owner_staff" on public.inventory_items;
create policy "inventory_items_manage_owner_staff"
on public.inventory_items for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "inventory_item_movements_manage_owner_staff" on public.inventory_item_movements;
create policy "inventory_item_movements_manage_owner_staff"
on public.inventory_item_movements for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "daily_menus_manage_owner_staff" on public.daily_menus;
create policy "daily_menus_manage_owner_staff"
on public.daily_menus for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "daily_menu_items_manage_owner_staff" on public.daily_menu_items;
create policy "daily_menu_items_manage_owner_staff"
on public.daily_menu_items for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

-- loyalty
drop policy if exists "loyalty_accounts_read_own_or_staff" on public.loyalty_accounts;
create policy "loyalty_accounts_read_own_or_staff"
on public.loyalty_accounts for select
using (
  customer_id = auth.uid() or public.is_owner_or_staff()
);

drop policy if exists "loyalty_accounts_manage_owner_staff" on public.loyalty_accounts;
create policy "loyalty_accounts_manage_owner_staff"
on public.loyalty_accounts for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "loyalty_redemptions_read_own_or_staff" on public.loyalty_redemptions;
create policy "loyalty_redemptions_read_own_or_staff"
on public.loyalty_redemptions for select
using (
  customer_id = auth.uid() or public.is_owner_or_staff()
);

drop policy if exists "loyalty_redemptions_manage_owner_staff" on public.loyalty_redemptions;
create policy "loyalty_redemptions_manage_owner_staff"
on public.loyalty_redemptions for all
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

-- orders
drop policy if exists "orders_read_own_or_staff" on public.orders;
create policy "orders_read_own_or_staff"
on public.orders for select
using (
  customer_id = auth.uid() or public.is_owner_or_staff()
);

drop policy if exists "orders_insert_customer_or_staff" on public.orders;
create policy "orders_insert_customer_or_staff"
on public.orders for insert
with check (
  auth.uid() = customer_id or public.is_owner_or_staff()
);

-- Staff can update anything; customers can submit an update (DB trigger enforces cancellation-only).
drop policy if exists "orders_update_staff_only" on public.orders;
drop policy if exists "orders_update_staff_or_customer_cancel" on public.orders;
create policy "orders_update_staff_or_customer_cancel"
on public.orders for update
using (
  public.is_owner_or_staff() or customer_id = auth.uid()
)
with check (
  public.is_owner_or_staff() or customer_id = auth.uid()
);

drop policy if exists "order_items_read_own_or_staff" on public.order_items;
create policy "order_items_read_own_or_staff"
on public.order_items for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = auth.uid() or public.is_owner_or_staff())
  )
);

drop policy if exists "order_items_insert_customer_or_staff" on public.order_items;
create policy "order_items_insert_customer_or_staff"
on public.order_items for insert
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = auth.uid() or public.is_owner_or_staff())
  )
);

drop policy if exists "order_items_update_staff_only" on public.order_items;
create policy "order_items_update_staff_only"
on public.order_items for update
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

drop policy if exists "order_status_history_read_own_or_staff" on public.order_status_history;
create policy "order_status_history_read_own_or_staff"
on public.order_status_history for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = auth.uid() or public.is_owner_or_staff())
  )
);

-- Allow customers to write their own history entries (customer app uses best-effort inserts).
drop policy if exists "order_status_history_insert_own_or_staff" on public.order_status_history;
create policy "order_status_history_insert_own_or_staff"
on public.order_status_history for insert
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = auth.uid() or public.is_owner_or_staff())
  )
);

drop policy if exists "order_status_history_manage_staff_only" on public.order_status_history;
create policy "order_status_history_manage_staff_only"
on public.order_status_history for update
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());

-- imports are owner-only (imports page is owner-only in staffowner app)
drop policy if exists "sales_import_batches_owner_only" on public.sales_import_batches;
create policy "sales_import_batches_owner_only"
on public.sales_import_batches for all
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "imported_sales_rows_owner_only" on public.imported_sales_rows;
create policy "imported_sales_rows_owner_only"
on public.imported_sales_rows for all
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "import_errors_owner_only" on public.import_errors;
create policy "import_errors_owner_only"
on public.import_errors for all
using (public.is_owner())
with check (public.is_owner());

-- login history
drop policy if exists "login_history_read_own_or_staff" on public.login_history;
create policy "login_history_read_own_or_staff"
on public.login_history for select
using (
  profile_id = auth.uid() or public.is_owner_or_staff()
);

drop policy if exists "login_history_insert_self_or_staff" on public.login_history;
create policy "login_history_insert_self_or_staff"
on public.login_history for insert
with check (
  profile_id = auth.uid() or public.is_owner_or_staff()
);

drop policy if exists "login_history_update_self_or_staff" on public.login_history;
create policy "login_history_update_self_or_staff"
on public.login_history for update
using (
  profile_id = auth.uid() or public.is_owner_or_staff()
)
with check (
  profile_id = auth.uid() or public.is_owner_or_staff()
);

-- storage (menu item images)
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public)
    values ('menu-images', 'menu-images', true)
    on conflict (id) do update set public = excluded.public;

    execute 'drop policy if exists "menu_images_public_read" on storage.objects';
    execute 'create policy "menu_images_public_read" on storage.objects for select using (bucket_id = ''menu-images'')';

    execute 'drop policy if exists "menu_images_owner_staff_insert" on storage.objects';
    execute 'create policy "menu_images_owner_staff_insert" on storage.objects for insert to authenticated with check (bucket_id = ''menu-images'' and public.is_owner_or_staff())';

    execute 'drop policy if exists "menu_images_owner_staff_update" on storage.objects';
    execute 'create policy "menu_images_owner_staff_update" on storage.objects for update to authenticated using (bucket_id = ''menu-images'' and public.is_owner_or_staff()) with check (bucket_id = ''menu-images'' and public.is_owner_or_staff())';

    execute 'drop policy if exists "menu_images_owner_staff_delete" on storage.objects';
    execute 'create policy "menu_images_owner_staff_delete" on storage.objects for delete to authenticated using (bucket_id = ''menu-images'' and public.is_owner_or_staff())';
  end if;
end
$$;

-- =========================================================
-- RPC: DASHBOARD TOTALS BY RANGE (staffowner app)
-- Supports: today, 7d, 30d, 90d, 3m, 6m, 1y, all
-- =========================================================

create or replace function public.dashboard_summary(range_key text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  start_ts timestamptz;
  result jsonb;
begin
  -- Only staff/owner should be able to call this RPC.
  if auth.uid() is not null and not public.is_owner_or_staff() then
    raise exception 'Access denied.';
  end if;

  start_ts := case range_key
    when 'today' then date_trunc('day', now())
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '90d' then now() - interval '90 days'
    when '3m' then now() - interval '3 months'
    when '6m' then now() - interval '6 months'
    when '1y' then now() - interval '1 year'
    when 'all' then null
    else now() - interval '30 days'
  end;

  with filtered_sales as (
    select *
    from public.dashboard_sales_feed dsf
    where start_ts is null or dsf.occurred_at >= start_ts
  ),
  sales_today as (
    select coalesce(sum(amount), 0) as total
    from public.dashboard_sales_feed
    where occurred_at >= date_trunc('day', now())
  ),
  sales_range as (
    select coalesce(sum(amount), 0) as total
    from filtered_sales
  ),
  avg_order_value as (
    select coalesce(avg(amount), 0) as avg_value
    from filtered_sales
  ),
  live_orders as (
    select *
    from public.orders o
    where start_ts is null or o.placed_at >= start_ts
  ),
  order_counts as (
    select
      count(*) filter (where placed_at >= date_trunc('day', now())) as today,
      count(*) as range_total,
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'preparing') as preparing,
      count(*) filter (where status = 'ready') as ready,
      count(*) filter (where status = 'out_for_delivery') as out_for_delivery,
      count(*) filter (where status in ('completed','delivered')) as completed,
      count(*) filter (where status = 'cancelled') as cancelled
    from live_orders
  ),
  top_items as (
    select jsonb_agg(
      jsonb_build_object(
        'itemName', x.item_name,
        'quantity', x.qty,
        'revenue', x.revenue
      )
      order by x.qty desc, x.revenue desc
    ) as items
    from (
      select
        oi.item_name,
        sum(oi.quantity)::int as qty,
        sum(oi.line_total)::numeric(10,2) as revenue
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where start_ts is null or o.placed_at >= start_ts
      group by oi.item_name
      limit 10
    ) x
  ),
  recent_orders as (
    select jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'code', o.code,
        'customerId', o.customer_id,
        'status', o.status,
        'paymentStatus', o.payment_status,
        'paymentMethod', o.payment_method,
        'orderType', o.order_type,
        'totalAmount', o.total_amount,
        'placedAt', o.placed_at
      )
      order by o.placed_at desc
    ) as items
    from (
      select *
      from public.orders
      order by placed_at desc
      limit 10
    ) o
  ),
  alerts as (
    select jsonb_agg(a.alert_obj) as items
    from (
      select jsonb_build_object(
        'id', ii.code,
        'type', 'warning',
        'tone', 'warning',
        'title', 'Low stock',
        'message', ii.name || ' (' || coalesce(ic.name, 'Uncategorized') || ') is low on stock'
      ) as alert_obj
      from public.inventory_items ii
      left join public.inventory_categories ic on ic.id = ii.category_id
      where ii.is_active = true
        and ii.quantity_on_hand <= ii.reorder_level
      order by ii.quantity_on_hand asc
      limit 10
    ) a
  )
  select jsonb_build_object(
    'sales', jsonb_build_object(
      'today', (select total from sales_today),
      'rangeTotal', (select total from sales_range),
      'averageOrderValue', round((select avg_value from avg_order_value), 2)
    ),
    'orders', jsonb_build_object(
      'today', (select today from order_counts),
      'rangeTotal', (select range_total from order_counts),
      'pending', (select pending from order_counts),
      'preparing', (select preparing from order_counts),
      'ready', (select ready from order_counts),
      'outForDelivery', (select out_for_delivery from order_counts),
      'completed', (select completed from order_counts),
      'cancelled', (select cancelled from order_counts)
    ),
    'topItems', coalesce((select items from top_items), '[]'::jsonb),
    'recentOrders', coalesce((select items from recent_orders), '[]'::jsonb),
    'alerts', coalesce((select items from alerts), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- =========================================================
-- GRANTS (required for Supabase client access)
-- =========================================================

grant usage on schema public to anon, authenticated;

-- Read-only tables for anon users (customer app can browse menu without login).
grant select on table public.menu_categories to anon;
grant select on table public.menu_items to anon;
grant select on table public.daily_menus to anon;
grant select on table public.daily_menu_items to anon;
grant select on table public.loyalty_rewards to anon;
grant select on table public.menu_item_effective_availability to anon;

-- Authenticated users can read/write; RLS policies still enforce access rules.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Views should be readable by both.
grant select on table public.menu_item_effective_availability to authenticated;
grant select on table public.dashboard_sales_feed to authenticated;

-- Refresh PostgREST schema cache after schema changes.
notify pgrst, 'reload schema';
