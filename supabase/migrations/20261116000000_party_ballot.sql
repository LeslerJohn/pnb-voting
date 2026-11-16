begin;

create table public.party_poll (
  id boolean primary key default true check (id),
  phase text not null default 'setup' check (phase in ('setup', 'open', 'closed', 'revealed'))
);
insert into public.party_poll default values;

create table public.party_nominees (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('female', 'male')),
  name text not null check (length(btrim(name)) between 1 and 100),
  photo text,
  created_at timestamptz not null default now(),
  unique (id, category)
);
create unique index party_nominees_unique_name on public.party_nominees (category, lower(name));

create table public.party_passes (
  code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null default now()
);

create table public.party_ballots (
  code_hash text primary key references public.party_passes(code_hash),
  receipt uuid not null unique default gen_random_uuid(),
  female_id uuid not null,
  female_category text generated always as ('female') stored,
  male_id uuid not null,
  male_category text generated always as ('male') stored,
  cast_at timestamptz not null default now(),
  foreign key (female_id, female_category) references public.party_nominees(id, category),
  foreign key (male_id, male_category) references public.party_nominees(id, category)
);
create index party_ballots_female on public.party_ballots(female_id);
create index party_ballots_male on public.party_ballots(male_id);

alter table public.party_poll enable row level security;
alter table public.party_nominees enable row level security;
alter table public.party_passes enable row level security;
alter table public.party_ballots enable row level security;

revoke all on public.party_poll, public.party_nominees, public.party_passes, public.party_ballots from public, anon, authenticated;
grant select, insert, update, delete on public.party_poll, public.party_nominees, public.party_passes, public.party_ballots to service_role;

create function public.party_snapshot(p jsonb) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'phase', poll.phase,
    'nominees', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'category', n.category, 'name', n.name, 'photo', n.photo) order by n.created_at, n.id)
      from public.party_nominees n
    ), '[]'::jsonb),
    'turnout', case when p->>'view' in ('host', 'stage') or poll.phase = 'revealed' then (select count(*) from public.party_ballots) end,
    'issued', case when p->>'view' = 'host' then (select count(*) from public.party_passes) end,
    'results', case when poll.phase = 'revealed' then coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'votes', coalesce(tally.votes, 0)) order by coalesce(tally.votes, 0) desc, n.name, n.id)
      from public.party_nominees n
      left join (
        select nominee_id, count(*) as votes
        from (
          select female_id as nominee_id from public.party_ballots
          union all
          select male_id as nominee_id from public.party_ballots
        ) choices
        group by nominee_id
      ) tally on tally.nominee_id = n.id
    ), '[]'::jsonb) end
  ) from public.party_poll poll where poll.id
$$;

create function public.party_cast(p jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  current_phase text;
  existing public.party_ballots%rowtype;
  pass_hash text := p->>'codeHash';
  female uuid := (p->>'femaleId')::uuid;
  male uuid := (p->>'maleId')::uuid;
begin
  -- Shared by voters, exclusive for host phase changes.
  select phase into current_phase from public.party_poll where id for share;

  select * into existing from public.party_ballots where code_hash = pass_hash;
  if not found then
    if current_phase <> 'open' then
      return jsonb_build_object('status', 'closed');
    end if;
    if not exists (select 1 from public.party_passes where code_hash = pass_hash) then
      return jsonb_build_object('status', 'invalid');
    end if;
    if not exists (select 1 from public.party_nominees where id = female and category = 'female')
      or not exists (select 1 from public.party_nominees where id = male and category = 'male') then
      return jsonb_build_object('status', 'nominees');
    end if;

    insert into public.party_ballots (code_hash, female_id, male_id) values (pass_hash, female, male)
    on conflict (code_hash) do nothing returning * into existing;
    if not found then
      select * into existing from public.party_ballots where code_hash = pass_hash;
    end if;
  end if;

  if existing.female_id = female and existing.male_id = male then
    return jsonb_build_object('status', 'accepted', 'receipt', existing.receipt);
  end if;
  return jsonb_build_object('status', 'used');
end
$$;

create function public.party_phase(p jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  before_phase text;
  after_phase text := p->>'phase';
begin
  select phase into before_phase from public.party_poll where id for update;
  if before_phase = after_phase then
    return jsonb_build_object('status', 'ok');
  end if;
  if before_phase = 'setup' and after_phase = 'open' then
    if not exists (select 1 from public.party_nominees where category = 'female')
      or not exists (select 1 from public.party_nominees where category = 'male') then
      return jsonb_build_object('status', 'nominees');
    end if;
    if not exists (select 1 from public.party_passes) then
      return jsonb_build_object('status', 'passes');
    end if;
  elsif (before_phase, after_phase) not in (('open', 'closed'), ('closed', 'revealed')) then
    return jsonb_build_object('status', 'phase');
  end if;
  update public.party_poll set phase = after_phase where id;
  return jsonb_build_object('status', 'ok');
end
$$;

create function public.party_issue(p jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare current_phase text;
begin
  select phase into current_phase from public.party_poll where id for share;
  if current_phase not in ('setup', 'open') then
    return jsonb_build_object('status', 'phase');
  end if;
  insert into public.party_passes (code_hash) select jsonb_array_elements_text(p->'hashes');
  return jsonb_build_object('status', 'ok');
end
$$;

create function public.party_nominee(p jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  current_phase text;
  nominee_id uuid := (p->>'id')::uuid;
  previous_photo text;
begin
  select phase into current_phase from public.party_poll where id for update;
  if current_phase <> 'setup' then
    return jsonb_build_object('status', 'phase');
  end if;

  if nominee_id is not null then
    select photo into previous_photo from public.party_nominees where id = nominee_id;
    if not found then
      return jsonb_build_object('status', 'missing');
    end if;
  end if;

  if p->>'action' = 'delete' then
    delete from public.party_nominees where id = nominee_id;
  elsif nominee_id is null then
    if (select count(*) from public.party_nominees) >= 100 then
      return jsonb_build_object('status', 'limit');
    end if;
    insert into public.party_nominees (name, category, photo)
    values (p->>'name', p->>'category', p->>'photo');
  else
    update public.party_nominees
    set name = p->>'name', category = p->>'category',
        photo = case when p ? 'photo' then p->>'photo' else photo end
    where id = nominee_id;
  end if;

  return jsonb_build_object('status', 'ok', 'oldPhoto',
    case when p ? 'photo' or p->>'action' = 'delete' then previous_photo end);
exception when unique_violation then
  return jsonb_build_object('status', 'duplicate');
end
$$;

revoke execute on function
  public.party_snapshot(jsonb), public.party_cast(jsonb), public.party_phase(jsonb),
  public.party_issue(jsonb), public.party_nominee(jsonb)
from public, anon, authenticated;

grant execute on function
  public.party_snapshot(jsonb), public.party_cast(jsonb), public.party_phase(jsonb),
  public.party_issue(jsonb), public.party_nominee(jsonb)
to service_role;

-- Supabase Storage is used in deployment. Local rehearsal serves optimized files from disk.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('party-portraits', 'party-portraits', true, 1048576, array['image/webp'])
    on conflict (id) do nothing;
  end if;
end
$$;

commit;
