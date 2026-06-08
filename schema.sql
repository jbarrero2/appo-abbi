-- ===================================================================
-- Ap-Ab — esquema de Supabase (cotizador + límite + pagos)
-- Pégalo en: Supabase → SQL Editor → New query → Run
-- ===================================================================

-- Cupo por usuario:
--   window_start  -> inicio de la ventana de 7 días (las gratis se renuevan)
--   free_used     -> gratis usadas en la ventana actual (máx 2/semana)
--   paid_credits  -> cotizaciones compradas (paquete de 10 por US$5). NO caducan.
create table if not exists public.quote_limits (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  window_start  timestamptz not null default now(),
  free_used     int not null default 0,
  paid_credits  int not null default 0
);

alter table public.quote_limits enable row level security;
drop policy if exists "leer mi propio limite" on public.quote_limits;
create policy "leer mi propio limite"
  on public.quote_limits for select
  using (auth.uid() = user_id);

-- Idempotencia de pagos: cada evento de Stripe se procesa UNA sola vez.
create table if not exists public.processed_webhooks (
  event_id    text primary key,
  created_at  timestamptz not null default now()
);
alter table public.processed_webhooks enable row level security;
-- Sin políticas: solo la service_role (backend) la toca.

-- ===================================================================
-- consume_quote: descuenta 1 cotización de forma ATÓMICA.
-- SELECT ... FOR UPDATE serializa peticiones simultáneas del mismo
-- usuario (dos pestañas a la vez NO pueden colar una 3ª gratis).
-- ===================================================================
create or replace function public.consume_quote(p_user uuid, p_free int, p_window_secs int)
returns table(allowed boolean, source text, free_used int, paid_credits int, window_start timestamptz, next_available timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.quote_limits;
  v_now timestamptz := now();
begin
  insert into public.quote_limits(user_id, window_start, free_used, paid_credits)
    values (p_user, v_now, 0, 0)
    on conflict (user_id) do nothing;

  select * into r from public.quote_limits where user_id = p_user for update;

  -- ¿venció la ventana de 7 días? -> se renuevan las gratis (los créditos NO)
  if r.window_start is null or v_now - r.window_start >= make_interval(secs => p_window_secs) then
    r.window_start := v_now;
    r.free_used := 0;
  end if;

  if r.free_used < p_free then
    r.free_used := r.free_used + 1;
    allowed := true; source := 'free';
  elsif r.paid_credits > 0 then
    r.paid_credits := r.paid_credits - 1;
    allowed := true; source := 'paid';
  else
    allowed := false; source := null;
  end if;

  if allowed then
    update public.quote_limits
      set window_start = r.window_start,
          free_used    = r.free_used,
          paid_credits = r.paid_credits
      where user_id = p_user;
  end if;

  free_used := r.free_used;
  paid_credits := r.paid_credits;
  window_start := r.window_start;
  next_available := r.window_start + make_interval(secs => p_window_secs);
  return next;
end;
$$;

-- ===================================================================
-- credit_purchase: acredita p_n créditos desde el webhook, IDEMPOTENTE.
-- Devuelve true si acreditó (evento nuevo), false si ya estaba procesado
-- (Stripe a veces reenvía el mismo evento: así NO se acredita doble).
-- ===================================================================
create or replace function public.credit_purchase(p_event_id text, p_user uuid, p_n int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.processed_webhooks(event_id) values (p_event_id) on conflict do nothing;
  if not found then
    return false;  -- evento ya procesado: no acreditar de nuevo
  end if;
  insert into public.quote_limits (user_id, paid_credits)
    values (p_user, p_n)
    on conflict (user_id) do update
      set paid_credits = public.quote_limits.paid_credits + excluded.paid_credits;
  return true;
end;
$$;

-- ===================================================================
-- add_quote_credits: acreditar MANUAL (sin idempotencia), p. ej. si
-- cobras por WhatsApp:  select add_quote_credits('<uuid-usuario>', 10);
-- ===================================================================
create or replace function public.add_quote_credits(p_user uuid, p_n int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.quote_limits (user_id, paid_credits)
  values (p_user, p_n)
  on conflict (user_id) do update
    set paid_credits = public.quote_limits.paid_credits + excluded.paid_credits;
$$;

-- ===================================================================
-- COTIZACIÓN ESPECÍFICA (con DeepSeek)
-- quote_sessions: borrador en curso. El DRA (MASTER DRA para APPO) vive
-- AQUÍ, en el servidor — NO se devuelve al cliente (solo el mockup + precio).
-- ===================================================================
create table if not exists public.quote_sessions (
  session_id       uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  nombre_proyecto  text,
  dra              text,           -- MASTER DRA (oculto al cliente)
  params           jsonb,          -- parámetros para la rúbrica
  iter_count       int not null default 0,
  updated_at       timestamptz not null default now()
);
alter table public.quote_sessions enable row level security;
-- Sin políticas: solo la service_role (backend) la toca.

-- solicitudes: leads finales (cuando el cliente pulsa "Solicitud final").
create table if not exists public.solicitudes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  email            text,
  nombre_proyecto  text,
  dra              text,           -- requerimientos para ustedes / APPO
  params           jsonb,
  created_at       timestamptz not null default now()
);
alter table public.solicitudes enable row level security;
-- Sin políticas: solo la service_role (backend) escribe/lee.
