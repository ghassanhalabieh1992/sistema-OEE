-- GAP OEE: execute in Supabase SQL Editor before connecting the production app.
create extension if not exists "uuid-ossp";

create table if not exists public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'consultant', 'supervisor', 'operator')),
  primary key (organization_id, user_id)
);

create table if not exists public.import_jobs (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  mapping jsonb not null default '{}'::jsonb,
  issues jsonb not null default '{}'::jsonb,
  total_rows integer default 0,
  accepted_rows integer default 0,
  rejected_rows integer default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.production_records (
  id uuid primary key default uuid_generate_v4(),
  import_id uuid not null references public.import_jobs(id) on delete cascade,
  source_row integer not null,
  source_record text,
  production_date date,
  shift text,
  machine text,
  machine_group text,
  product text,
  production_order text,
  planned_minutes numeric,
  operating_minutes numeric,
  technical_speed numeric,
  average_speed numeric,
  total_count numeric,
  good_count numeric,
  reject_count numeric,
  setup_minutes numeric,
  breakdown_minutes numeric,
  cleaning_minutes numeric,
  adjustments_minutes numeric,
  material_shortage_minutes numeric,
  supply_shortage_minutes numeric,
  microstops_minutes numeric,
  scrap_reason text,
  context text,
  preventive_excluded_minutes numeric,
  quality_status text not null default 'approved' check (quality_status in ('approved', 'needs_review', 'needs_mapping')),
  created_at timestamptz not null default now(),
  unique(import_id, source_row)
);

create index if not exists production_records_date_machine_idx on public.production_records (production_date, machine);
create index if not exists production_records_group_idx on public.production_records (machine_group);

-- Declared before the reporting functions because those functions must enforce
-- the current user's organization boundary when they run.
create or replace function public.belongs_to_organization(target_organization uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members where organization_id = target_organization and user_id = auth.uid());
$$;

-- Record-level audit view. A planned time of zero is intentionally excluded
-- from OEE: it represents a preventive-maintenance shift in the GAP source.
create or replace view public.oee_record_calculation as
select
  r.*,
  case when r.planned_minutes > 0 then r.operating_minutes / r.planned_minutes end as availability,
  case when r.technical_speed > 0 and r.operating_minutes > 0 then r.total_count / (r.technical_speed * r.operating_minutes) end as performance,
  case when r.total_count > 0 then r.good_count / r.total_count end as quality,
  case when r.planned_minutes > 0 and r.technical_speed > 0 and r.operating_minutes > 0 and r.total_count > 0
    then (r.operating_minutes / r.planned_minutes) * (r.total_count / (r.technical_speed * r.operating_minutes)) * (r.good_count / r.total_count)
  end as oee
from public.production_records r
where r.quality_status = 'approved';

-- Consolidation must divide the matching totals. Never average percentage rows.
create or replace function public.get_oee_summary(
  start_date date default null,
  end_date date default null,
  selected_machines text[] default null,
  selected_groups text[] default null,
  selected_shifts text[] default null
) returns jsonb language sql stable security invoker set search_path = public as $$
  with filtered as (
    select r.* from public.production_records r
    join public.import_jobs j on j.id = r.import_id
    where r.quality_status = 'approved'
      and public.belongs_to_organization(j.organization_id)
      and r.planned_minutes > 0
      and (start_date is null or r.production_date >= start_date)
      and (end_date is null or r.production_date <= end_date)
      and (selected_machines is null or r.machine = any(selected_machines))
      and (selected_groups is null or r.machine_group = any(selected_groups))
      and (selected_shifts is null or r.shift = any(selected_shifts))
  ), totals as (
    select count(*) as records, sum(planned_minutes) as planned, sum(operating_minutes) as operating,
      sum(total_count) as total, sum(good_count) as good,
      sum(technical_speed * operating_minutes) as ideal_output
    from filtered
  )
  select jsonb_build_object(
    'records', records,
    'planned_minutes', planned,
    'operating_minutes', operating,
    'total_count', total,
    'good_count', good,
    'availability', operating / nullif(planned, 0),
    'performance', total / nullif(ideal_output, 0),
    'quality', good / nullif(total, 0),
    'oee', (operating / nullif(planned, 0)) * (total / nullif(ideal_output, 0)) * (good / nullif(total, 0))
  ) from totals;
$$;

create or replace function public.get_loss_summary(
  start_date date default null,
  end_date date default null,
  selected_machines text[] default null
) returns table(loss text, minutes numeric) language sql stable security invoker set search_path = public as $$
  with filtered as (
    select r.* from public.production_records r join public.import_jobs j on j.id = r.import_id
    where r.quality_status = 'approved' and public.belongs_to_organization(j.organization_id)
      and (start_date is null or r.production_date >= start_date) and (end_date is null or r.production_date <= end_date)
      and (selected_machines is null or r.machine = any(selected_machines))
  ), losses(loss, minutes) as (
    select 'Setup'::text, setup_minutes from filtered union all
    select 'Quebra/manutenção', breakdown_minutes from filtered union all
    select 'Limpeza', cleaning_minutes from filtered union all
    select 'Ajustes', adjustments_minutes from filtered union all
    select 'Falta de matéria-prima', material_shortage_minutes from filtered union all
    select 'Falta de insumos', supply_shortage_minutes from filtered union all
    select 'Microparadas', microstops_minutes from filtered
  ) select loss, sum(minutes) from losses where coalesce(minutes, 0) > 0 group by loss order by sum(minutes) desc;
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.import_jobs enable row level security;
alter table public.production_records enable row level security;

-- Make the initialization script safe to run again after a failed attempt.
drop policy if exists "members read organization" on public.organizations;
drop policy if exists "members read jobs" on public.import_jobs;
drop policy if exists "members create jobs" on public.import_jobs;
drop policy if exists "members read production" on public.production_records;
create policy "members read organization" on public.organizations for select using (public.belongs_to_organization(id));
create policy "members read jobs" on public.import_jobs for select using (public.belongs_to_organization(organization_id));
create policy "members create jobs" on public.import_jobs for insert with check (public.belongs_to_organization(organization_id));
create policy "members read production" on public.production_records for select using (
  exists (select 1 from public.import_jobs jobs where jobs.id = import_id and public.belongs_to_organization(jobs.organization_id))
);

-- Vercel uses the service-role key for ingestion. The browser uses only the anon key and RLS.
insert into storage.buckets (id, name, public) values ('gap-imports', 'gap-imports', false) on conflict (id) do nothing;
