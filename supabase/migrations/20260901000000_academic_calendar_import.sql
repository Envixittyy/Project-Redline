-- School Intelligence Repair Pass 2B: trusted Academic Calendar import.
-- Stable import sources, immutable revisions, server-resolved entries, canonical
-- Calendar links and last-import baselines remain separate identities.

alter table public.ai_scoped_requests drop constraint ai_scoped_requests_provider_check;
alter table public.ai_scoped_requests add constraint ai_scoped_requests_provider_check
  check(provider in ('server_parser','ollama','llamacpp','openai_compatible','gemini','openrouter'));

create table public.academic_calendar_import_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  format text not null check (format in ('ics','csv','txt','md','png','jpeg','webp')),
  label text not null check (btrim(label)<>'' and char_length(label)<=120),
  status text not null default 'active' check (status in ('active','retired')),
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,id)
);

create table public.academic_calendar_source_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_id uuid not null,
  format text not null check (format in ('ics','csv','txt','md','png','jpeg','webp')),
  content_digest text not null check (content_digest~'^[a-f0-9]{64}$'),
  normalized_text text,
  image_id uuid,
  file_name text not null check (btrim(file_name)<>'' and char_length(file_name)<=200),
  provenance jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id,id),
  unique(user_id,source_id,id),
  unique(user_id,source_id,content_digest),
  constraint academic_revision_source_owner foreign key(user_id,source_id)
    references public.academic_calendar_import_sources(user_id,id) on delete restrict,
  constraint academic_revision_content_shape check (
    (format in ('ics','csv','txt','md') and normalized_text is not null and image_id is null) or
    (format in ('png','jpeg','webp') and normalized_text is null and image_id is not null)
  )
);

create unique index if not exists ai_validated_images_owner_id
  on public.ai_validated_images(user_id,id);
alter table public.academic_calendar_source_revisions
  add constraint academic_revision_image_owner foreign key(user_id,image_id)
  references public.ai_validated_images(user_id,id) on delete restrict;
alter table public.academic_calendar_import_sources
  add constraint academic_source_current_revision_owner foreign key(user_id,id,current_revision_id)
  references public.academic_calendar_source_revisions(user_id,source_id,id) on delete restrict;

create table public.academic_calendar_source_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_id uuid not null,
  identity_kind text not null check (identity_kind in ('ics_uid','csv_id','structure_semantic','resolved_semantic')),
  identity_key text not null check (btrim(identity_key)<>'' and char_length(identity_key)<=160),
  structure_key text check (structure_key is null or (btrim(structure_key)<>'' and char_length(structure_key)<=160)),
  status text not null default 'present' check (status in ('present','absent','retired')),
  current_revision_id uuid not null,
  ignored_source_digest text check (ignored_source_digest is null or ignored_source_digest~'^[a-f0-9]{64}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id,id),
  unique(user_id,source_id,identity_key),
  constraint academic_entry_source_owner foreign key(user_id,source_id)
    references public.academic_calendar_import_sources(user_id,id) on delete restrict,
  constraint academic_entry_revision_owner foreign key(user_id,source_id,current_revision_id)
    references public.academic_calendar_source_revisions(user_id,source_id,id) on delete restrict
);

create table public.academic_calendar_revision_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  revision_id uuid not null,
  source_id uuid not null,
  entry_id uuid not null,
  identity_evidence text not null check (btrim(identity_evidence)<>'' and char_length(identity_evidence)<=500),
  source_event jsonb not null,
  source_digest text not null check (source_digest~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(user_id,id),
  unique(user_id,revision_id,entry_id),
  constraint academic_revision_entry_revision_owner foreign key(user_id,source_id,revision_id)
    references public.academic_calendar_source_revisions(user_id,source_id,id) on delete restrict,
  constraint academic_revision_entry_entry_owner foreign key(user_id,entry_id)
    references public.academic_calendar_source_entries(user_id,id) on delete restrict
);

create unique index if not exists calendar_events_owner_id on public.calendar_events(user_id,id);
create table public.academic_calendar_entry_links (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_id uuid not null,
  canonical_event_id uuid,
  last_imported jsonb,
  baseline_digest text check (baseline_digest is null or baseline_digest~'^[a-f0-9]{64}$'),
  last_source_digest text check (last_source_digest is null or last_source_digest~'^[a-f0-9]{64}$'),
  last_revision_id uuid,
  source_state text not null default 'present' check (source_state in ('present','absent','retired')),
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(user_id,entry_id),
  constraint academic_link_entry_owner foreign key(user_id,entry_id)
    references public.academic_calendar_source_entries(user_id,id) on delete restrict,
  constraint academic_link_event_owner foreign key(user_id,canonical_event_id)
    references public.calendar_events(user_id,id) on delete set null,
  constraint academic_link_revision_owner foreign key(user_id,last_revision_id)
    references public.academic_calendar_source_revisions(user_id,id) on delete restrict,
  constraint academic_link_baseline_shape check (
    (last_imported is null and baseline_digest is null and canonical_event_id is null) or
    (last_imported is not null and baseline_digest is not null)
  )
);

create index academic_sources_owner_updated on public.academic_calendar_import_sources(user_id,updated_at desc);
create index academic_entries_source_status on public.academic_calendar_source_entries(user_id,source_id,status);
create index academic_revision_entries_revision on public.academic_calendar_revision_entries(user_id,revision_id);
create index academic_links_event on public.academic_calendar_entry_links(user_id,canonical_event_id);

alter table public.academic_calendar_import_sources enable row level security;
alter table public.academic_calendar_source_revisions enable row level security;
alter table public.academic_calendar_source_entries enable row level security;
alter table public.academic_calendar_revision_entries enable row level security;
alter table public.academic_calendar_entry_links enable row level security;
revoke all on public.academic_calendar_import_sources,public.academic_calendar_source_revisions,
  public.academic_calendar_source_entries,public.academic_calendar_revision_entries,
  public.academic_calendar_entry_links from public,anon,authenticated;
grant select on public.academic_calendar_import_sources,public.academic_calendar_source_revisions,
  public.academic_calendar_source_entries,public.academic_calendar_revision_entries,
  public.academic_calendar_entry_links to authenticated;
create policy academic_sources_owner_read on public.academic_calendar_import_sources for select to authenticated using(user_id=auth.uid());
create policy academic_revisions_owner_read on public.academic_calendar_source_revisions for select to authenticated using(user_id=auth.uid());
create policy academic_entries_owner_read on public.academic_calendar_source_entries for select to authenticated using(user_id=auth.uid());
create policy academic_revision_entries_owner_read on public.academic_calendar_revision_entries for select to authenticated using(user_id=auth.uid());
create policy academic_links_owner_read on public.academic_calendar_entry_links for select to authenticated using(user_id=auth.uid());

create function public.academic_calendar_event_provenance_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' and new.source='academic_calendar' and not exists(
    select 1 from public.operation_batches b join public.ai_scoped_requests q on q.id=b.ai_scoped_request_id
    where b.user_id=auth.uid() and q.user_id=auth.uid() and q.capability='academicCalendarImport.propose'
      and b.status='confirmed' and b.ai_apply_xid=pg_current_xact_id()
  ) then raise exception 'academic_calendar_provenance_protected';end if;
  if tg_op='UPDATE' and (old.source='academic_calendar' or new.source='academic_calendar') and
    (new.user_id is distinct from old.user_id or new.source is distinct from old.source or
     new.external_id is distinct from old.external_id or new.source_url is distinct from old.source_url)
  then raise exception 'academic_calendar_provenance_protected';end if;
  return new;
end $$;
create trigger academic_calendar_event_provenance before insert or update on public.calendar_events
  for each row execute function public.academic_calendar_event_provenance_guard();

create function public.academic_calendar_revision_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'academic_calendar_provenance_immutable'; end $$;
create trigger academic_revision_immutable before update or delete on public.academic_calendar_source_revisions
  for each row execute function public.academic_calendar_revision_immutable();
create trigger academic_revision_entry_immutable before update or delete on public.academic_calendar_revision_entries
  for each row execute function public.academic_calendar_revision_immutable();

create function ai_private.academic_event_digest(value jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare start_at timestamptz; end_at timestamptz;
begin
  perform ai_private.exact_keys(value,array['title','description','start','end','allDay','eventType']);
  perform ai_private.strict_text(value->'title',150);
  if value->'description'<>'null'::jsonb then perform ai_private.strict_text(value->'description',500,true); end if;
  if jsonb_typeof(value->'start')<>'string' or jsonb_typeof(value->'end')<>'string'
    or value->>'start' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or value->>'end' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or jsonb_typeof(value->'allDay')<>'boolean' or value->>'eventType' not in
      ('holiday','term_start','term_end','exam_period','break','deadline','event','personal','school','football') then raise exception 'ai_invalid_proposal'; end if;
  begin start_at:=(value->>'start')::timestamptz;end_at:=(value->>'end')::timestamptz;
  exception when others then raise exception 'ai_invalid_proposal';end;
  if end_at<=start_at then raise exception 'ai_invalid_proposal';end if;
  return ai_private.scoped_hash(jsonb_build_array(1,value));
end $$;

create function ai_private.academic_calendar_event_state(event_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare e public.calendar_events; value jsonb;
begin
  select * into e from public.calendar_events where id=event_id and user_id=auth.uid() and source='academic_calendar' for update;
  if not found then return null; end if;
  value:=jsonb_build_object('title',e.title,'description',e.description,
    'start',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'end',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'allDay',e.all_day,'eventType',e.event_type);
  return jsonb_build_object('event',value,'digest',ai_private.academic_event_digest(value));
end $$;

create function ai_private.academic_calendar_revision_fingerprint(p_revision_id uuid) returns text
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r public.academic_calendar_source_revisions; s public.academic_calendar_import_sources; image_state jsonb;
begin
  select * into r from public.academic_calendar_source_revisions where id=p_revision_id and user_id=auth.uid() for update;
  if not found then raise exception 'ai_source_unavailable';end if;
  select * into s from public.academic_calendar_import_sources where id=r.source_id and user_id=auth.uid() for update;
  if not found or s.status<>'active' or s.current_revision_id is distinct from r.id then raise exception 'ai_source_unavailable';end if;
  if r.image_id is not null then
    select jsonb_build_array(i.id,i.capability,i.normalized_digest,i.normalized_byte_count,i.status,i.expires_at)
      into image_state from public.ai_validated_images i where i.id=r.image_id and i.user_id=auth.uid() for update;
    if image_state is null then raise exception 'ai_source_unavailable';end if;
  end if;
  return ai_private.scoped_hash(jsonb_build_array(1,auth.uid(),s.id,s.format,s.status,s.current_revision_id,
    r.id,r.format,r.content_digest,r.normalized_text,r.image_id,r.file_name,r.provenance,r.created_at,image_state));
end $$;

create function ai_private.academic_calendar_review_state(p_revision_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare r public.academic_calendar_source_revisions; state jsonb;
begin
  perform ai_private.academic_calendar_revision_fingerprint(p_revision_id);
  select * into r from public.academic_calendar_source_revisions where id=p_revision_id and user_id=auth.uid();
  perform e.id from public.academic_calendar_source_entries e where e.user_id=auth.uid() and e.source_id=r.source_id order by e.id for update;
  perform l.entry_id from public.academic_calendar_entry_links l join public.academic_calendar_source_entries e on e.id=l.entry_id
    where l.user_id=auth.uid() and e.source_id=r.source_id order by l.entry_id for update of l;
  perform c.id from public.calendar_events c join public.academic_calendar_entry_links l on l.canonical_event_id=c.id
    join public.academic_calendar_source_entries e on e.id=l.entry_id where c.user_id=auth.uid() and e.source_id=r.source_id order by c.id for update of c;
  select coalesce(jsonb_agg(jsonb_build_array(e.id,e.identity_kind,e.identity_key,e.structure_key,e.status,e.current_revision_id,e.ignored_source_digest,
      re.id,re.source_digest,re.source_event,
      l.canonical_event_id,l.last_imported,l.baseline_digest,l.last_source_digest,l.last_revision_id,l.source_state,
      ai_private.academic_calendar_event_state(l.canonical_event_id)) order by e.id),'[]') into state
    from public.academic_calendar_source_entries e
    left join public.academic_calendar_revision_entries re on re.entry_id=e.id and re.revision_id=p_revision_id and re.user_id=auth.uid()
    left join public.academic_calendar_entry_links l on l.entry_id=e.id and l.user_id=auth.uid()
    where e.user_id=auth.uid() and e.source_id=r.source_id;
  return ai_private.scoped_hash(jsonb_build_array(1,p_revision_id,state));
end $$;

alter function ai_private.scoped_source_manifest(jsonb) rename to scoped_source_manifest_pass2c;
create function ai_private.scoped_source_manifest(selection jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ref jsonb; revision_id uuid;
begin
  if jsonb_typeof(selection)='array' and jsonb_array_length(selection)=1 and selection->0->>'kind'='academic_calendar_revision' then
    ref:=selection->0;perform ai_private.exact_keys(ref,array['kind','id']);
    if ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'ai_invalid_source';end if;
    revision_id:=(ref->>'id')::uuid;
    return jsonb_build_array(ref||jsonb_build_object('fingerprint',ai_private.academic_calendar_revision_fingerprint(revision_id)));
  end if;
  return ai_private.scoped_source_manifest_pass2c(selection);
end $$;

alter function ai_private.validate_scoped_manifest(text,jsonb) rename to validate_scoped_manifest_pass2c;
create function ai_private.validate_scoped_manifest(capability text,manifest jsonb) returns void
language plpgsql set search_path='' as $$
declare ref jsonb;
begin
  if capability='academicCalendarImport.propose' then
    if jsonb_typeof(manifest)<>'array' or jsonb_array_length(manifest)<>1 then raise exception 'ai_invalid_source';end if;
    ref:=manifest->0;perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
    if ref->>'kind'<>'academic_calendar_revision' or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source';end if;
    return;
  end if;
  perform ai_private.validate_scoped_manifest_pass2c(capability,manifest);
end $$;

alter function ai_private.validate_scoped_output(text,jsonb,text) rename to validate_scoped_output_pass2c;
create function ai_private.validate_scoped_output(capability text,proposal jsonb,handle text) returns void
language plpgsql set search_path='' as $$
declare item jsonb; event_value jsonb; operation text; decision text;
begin
  if capability<>'academicCalendarImport.propose' then perform ai_private.validate_scoped_output_pass2c(capability,proposal,handle);return;end if;
  perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','revisionId','stateDigest','events','skipped']);
  if proposal->'schema_version'<>'2'::jsonb or proposal->>'type'<>'review_academic_calendar_import'
    or proposal->'source_handle' is distinct from to_jsonb(handle)
    or proposal->>'revisionId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or proposal->>'stateDigest' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(proposal->'events')<>'array' or jsonb_array_length(proposal->'events')>60
    or jsonb_typeof(proposal->'skipped')<>'array' or jsonb_array_length(proposal->'skipped')>60
    or octet_length(proposal::text)>131072 then raise exception 'ai_invalid_proposal';end if;
  for item in select * from jsonb_array_elements(proposal->'events') loop
    perform ai_private.exact_keys(item,array['entryId','entryFingerprint','operation','decision','source','reviewed','current','baseline','canonicalEventId','note']);
    if item->>'entryId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or item->>'entryFingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_proposal';end if;
    operation:=item->>'operation';decision:=item->>'decision';
    if operation not in ('CREATE','UPDATE','CONFLICT','IGNORE','UNCHANGED') then raise exception 'ai_invalid_proposal';end if;
    if (operation in ('CREATE','UPDATE') and decision not in ('APPLY','IGNORE'))
      or (operation='CONFLICT' and decision not in ('APPLY_SOURCE','KEEP_CURRENT','IGNORE'))
      or (operation in ('IGNORE','UNCHANGED') and decision<>'IGNORE') then raise exception 'ai_invalid_proposal';end if;
    perform ai_private.academic_event_digest(item->'source');perform ai_private.academic_event_digest(item->'reviewed');
    if item->'current'<>'null'::jsonb then perform ai_private.academic_event_digest(item->'current');end if;
    if item->'baseline'<>'null'::jsonb then perform ai_private.academic_event_digest(item->'baseline');end if;
    if item->'canonicalEventId'<>'null'::jsonb and (jsonb_typeof(item->'canonicalEventId')<>'string' or item->>'canonicalEventId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then raise exception 'ai_invalid_proposal';end if;
    if item->'note'<>'null'::jsonb then perform ai_private.strict_text(item->'note',200,true);end if;
  end loop;
  if (select count(distinct value->>'entryId') from jsonb_array_elements(proposal->'events'))<>jsonb_array_length(proposal->'events') then raise exception 'ai_invalid_proposal';end if;
  for item in select * from jsonb_array_elements(proposal->'skipped') loop
    perform ai_private.exact_keys(item,array['entryId','reason','title']);
    if item->>'entryId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or item->>'reason' not in ('unchanged','removed','ignored_revision') then raise exception 'ai_invalid_proposal';end if;
    perform ai_private.strict_text(item->'title',150);
  end loop;
end $$;

alter function ai_private.scoped_review_target(public.ai_scoped_requests) rename to scoped_review_target_pass2c;
create function ai_private.scoped_review_target(r public.ai_scoped_requests) returns jsonb
language plpgsql set search_path='' as $$
declare selected_source_id uuid;
begin
  if r.capability='academicCalendarImport.propose' then
    select revision.source_id into selected_source_id from public.academic_calendar_source_revisions revision
      where revision.id=(r.source_manifest->0->>'id')::uuid and revision.user_id=auth.uid();
    if selected_source_id is null then raise exception 'ai_source_unavailable';end if;
    return jsonb_build_object('entity','academic_calendar','id',selected_source_id);
  end if;
  return ai_private.scoped_review_target_pass2c(r);
end $$;

create function public.ai_prepare_academic_calendar(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;s public.academic_calendar_import_sources;r public.academic_calendar_source_revisions;
  i public.ai_validated_images;x public.ai_image_disclosures;q public.ai_scoped_requests; selected_source_id uuid; normalized text;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_academic_calendar');
  perform ai_private.exact_keys(d,array['source_id','label','format','content_digest','normalized_text','image_id','disclosure_id','provider','model','location','file_name','time_zone','provenance']);
  if d->>'format' not in ('ics','csv','txt','md','png','jpeg','webp') or d->>'content_digest' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(d->'label')<>'string' or char_length(d->>'label') not between 1 and 120
    or jsonb_typeof(d->'file_name')<>'string' or char_length(d->>'file_name') not between 1 and 200
    or d->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' or d->>'provider' not in ('server_parser','ollama','openai_compatible','gemini','openrouter')
    or d->>'location' not in ('server','local','remote_local','cloud') or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'time_zone')
    or jsonb_typeof(d->'provenance')<>'object' then raise exception 'ai_invalid_source';end if;
  if d->'source_id'<>'null'::jsonb then
    selected_source_id:=(d->>'source_id')::uuid;select * into s from public.academic_calendar_import_sources where id=selected_source_id and user_id=auth.uid() for update;
    if not found or s.status<>'active' or s.format<>d->>'format' then raise exception 'ai_source_unavailable';end if;
  else
    insert into public.academic_calendar_import_sources(user_id,format,label) values(auth.uid(),d->>'format',d->>'label') returning * into s;selected_source_id:=s.id;
  end if;
  if d->>'format' in ('ics','csv','txt','md') then
    if d->'normalized_text'='null'::jsonb or d->'image_id'<>'null'::jsonb or d->'disclosure_id'<>'null'::jsonb then raise exception 'ai_invalid_source';end if;
    normalized:=d->>'normalized_text';
    if char_length(normalized) not between 1 and 25000 or octet_length(normalized)>32768
      or encode(sha256(convert_to(normalized,'UTF8')),'hex')<>d->>'content_digest' then raise exception 'ai_invalid_source';end if;
  else
    if d->'normalized_text'<>'null'::jsonb or d->'image_id'='null'::jsonb or d->'disclosure_id'='null'::jsonb then raise exception 'ai_invalid_source';end if;
    select * into i from public.ai_validated_images where id=(d->>'image_id')::uuid and user_id=auth.uid() for update;
    select * into x from public.ai_image_disclosures where id=(d->>'disclosure_id')::uuid and user_id=auth.uid() for update;
    if not found or i.id is null or i.status<>'active' or i.expires_at<=clock_timestamp() or i.capability<>'academicCalendarImport.propose'
      or i.normalized_digest<>d->>'content_digest' or x.image_id<>i.id or x.capability<>i.capability or x.provider<>d->>'provider'
      or x.model<>d->>'model' or x.location<>d->>'location' or x.status not in ('prepared','awaiting_consent') then raise exception 'ai_disclosure_unavailable';end if;
  end if;
  select * into r from public.academic_calendar_source_revisions revision where revision.user_id=auth.uid() and revision.source_id=selected_source_id and revision.content_digest=d->>'content_digest';
  if not found then
    insert into public.academic_calendar_source_revisions(user_id,source_id,format,content_digest,normalized_text,image_id,file_name,provenance)
      values(auth.uid(),selected_source_id,d->>'format',d->>'content_digest',normalized,case when i.id is null then null else i.id end,d->>'file_name',d->'provenance') returning * into r;
  end if;
  update public.academic_calendar_import_sources set current_revision_id=r.id,label=d->>'label',updated_at=clock_timestamp() where id=selected_source_id and user_id=auth.uid();
  q.id:=gen_random_uuid();q.user_id:=auth.uid();q.capability:='academicCalendarImport.propose';q.source_handle:='academic_'||replace(gen_random_uuid()::text,'-','');
  q.source_manifest:=ai_private.scoped_source_manifest(jsonb_build_array(jsonb_build_object('kind','academic_calendar_revision','id',r.id)));
  q.source_text:=jsonb_build_object('revisionId',r.id,'sourceId',selected_source_id,'format',r.format,
    'disclosureId',case when x.id is null then null else x.id end,'imageBytes',case when i.id is null then null else i.normalized_byte_count end,'location',d->>'location')::text;
  q.source_digest:=encode(sha256(convert_to(q.source_text,'UTF8')),'hex');q.file_name:=r.file_name;q.provider:=d->>'provider';q.model:=d->>'model';q.time_zone:=d->>'time_zone';
  q.created_at:=clock_timestamp();q.expires_at:=case when i.id is null then q.created_at+interval '5 minutes' else least(i.expires_at,x.expires_at,q.created_at+interval '5 minutes') end;
  q.start_date:=(q.created_at at time zone q.time_zone)::date;q.status:='prepared';q.trust_version:=2;q.authority_digest:=ai_private.scoped_request_digest(q);
  insert into public.ai_scoped_requests select(q).*;
  return jsonb_build_object('requestId',q.id,'sourceId',selected_source_id,'revisionId',r.id,'sourceHandle',q.source_handle,'expiresAt',q.expires_at);
end $$;

create function ai_private.academic_entry_fingerprint(p_entry_id uuid,p_revision_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare state jsonb;current_state jsonb;
begin
  perform e.id from public.academic_calendar_source_entries e where e.id=p_entry_id and e.user_id=auth.uid() for update;
  perform l.entry_id from public.academic_calendar_entry_links l where l.entry_id=p_entry_id and l.user_id=auth.uid() for update;
  select ai_private.academic_calendar_event_state(l.canonical_event_id) into current_state
    from public.academic_calendar_source_entries e
    left join public.academic_calendar_entry_links l on l.entry_id=e.id and l.user_id=auth.uid()
    where e.id=p_entry_id and e.user_id=auth.uid();
  select jsonb_build_array(e.id,e.identity_kind,e.identity_key,e.structure_key,e.status,e.current_revision_id,e.ignored_source_digest,
      re.id,re.source_digest,re.source_event,l.canonical_event_id,l.last_imported,l.baseline_digest,l.last_source_digest,l.last_revision_id,l.source_state,current_state)
    into state from public.academic_calendar_source_entries e
    join public.academic_calendar_revision_entries re on re.entry_id=e.id and re.revision_id=p_revision_id and re.user_id=auth.uid()
    left join public.academic_calendar_entry_links l on l.entry_id=e.id and l.user_id=auth.uid()
    where e.id=p_entry_id and e.user_id=auth.uid();
  if state is null then raise exception 'ai_source_unavailable';end if;
  return ai_private.scoped_hash(jsonb_build_array(1,state));
end $$;

create function ai_private.academic_build_review(p_revision_id uuid,handle text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row record;events jsonb:='[]';skipped jsonb:='[]';operation text;current_state jsonb;current_event jsonb;current_digest text;note text;
begin
  for row in
    select e.id entry_id,e.status,e.ignored_source_digest,re.source_event,re.source_digest,
      l.canonical_event_id,l.last_imported,l.baseline_digest,l.last_source_digest
    from public.academic_calendar_revision_entries re join public.academic_calendar_source_entries e on e.id=re.entry_id and e.user_id=auth.uid()
    left join public.academic_calendar_entry_links l on l.entry_id=e.id and l.user_id=auth.uid()
    where re.revision_id=p_revision_id and re.user_id=auth.uid() order by e.id
  loop
    current_state:=ai_private.academic_calendar_event_state(row.canonical_event_id);current_event:=current_state->'event';current_digest:=current_state->>'digest';note:=null;
    if row.ignored_source_digest=row.source_digest then operation:='IGNORE';note:='This exact source revision was previously ignored.';
    elsif row.last_source_digest=row.source_digest then operation:='UNCHANGED';note:='No source change since the last approved import.';
    elsif row.canonical_event_id is null and row.last_imported is null then operation:='CREATE';
    elsif current_state is null then operation:='CONFLICT';note:='The linked Redline event was removed after import.';
    elsif row.baseline_digest is null or current_digest<>row.baseline_digest then operation:='CONFLICT';note:='The current Redline event differs from the last imported baseline.';
    else operation:='UPDATE';end if;
    events:=events||jsonb_build_array(jsonb_build_object(
      'entryId',row.entry_id,'entryFingerprint',ai_private.academic_entry_fingerprint(row.entry_id,p_revision_id),
      'operation',operation,'decision','IGNORE','source',row.source_event,'reviewed',row.source_event,
      'current',coalesce(current_event,'null'::jsonb),'baseline',coalesce(row.last_imported,'null'::jsonb),
      'canonicalEventId',coalesce(to_jsonb(row.canonical_event_id),'null'::jsonb),'note',coalesce(to_jsonb(note),'null'::jsonb)));
    if operation in ('UNCHANGED','IGNORE') then skipped:=skipped||jsonb_build_array(jsonb_build_object('entryId',row.entry_id,
      'reason',case when operation='UNCHANGED' then 'unchanged' else 'ignored_revision' end,'title',row.source_event->>'title'));end if;
  end loop;
  for row in select e.id,e.identity_key,coalesce(l.last_imported->>'title','Removed source entry') title
    from public.academic_calendar_source_entries e left join public.academic_calendar_entry_links l on l.entry_id=e.id and l.user_id=auth.uid()
    join public.academic_calendar_source_revisions r on r.source_id=e.source_id and r.id=p_revision_id and r.user_id=auth.uid()
    where e.user_id=auth.uid() and e.status='absent' order by e.id loop
    skipped:=skipped||jsonb_build_array(jsonb_build_object('entryId',row.id,'reason','removed','title',row.title));
  end loop;
  return jsonb_build_object('schema_version',2,'type','review_academic_calendar_import','source_handle',handle,
    'revisionId',p_revision_id,'stateDigest',ai_private.academic_calendar_review_state(p_revision_id),'events',events,'skipped',skipped);
end $$;

create function public.ai_record_academic_calendar(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb;q public.ai_scoped_requests;r public.academic_calendar_source_revisions;s public.academic_calendar_import_sources;
  item jsonb;event_value jsonb;event_digest text;entry_row public.academic_calendar_source_entries;entry_id uuid;candidate_count integer;
  v_identity_kind text;v_identity_key text;v_structure_key text;v_evidence text;proposal jsonb;batch_id uuid;authority jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'record_academic_calendar');perform ai_private.exact_keys(d,array['request_id','entries']);
  if jsonb_typeof(d->'entries')<>'array' or jsonb_array_length(d->'entries') not between 1 and 60 then raise exception 'ai_invalid_proposal';end if;
  q:=ai_private.lock_scoped_request((d->>'request_id')::uuid);
  if q.capability<>'academicCalendarImport.propose' or q.status<>'prepared' then raise exception 'ai_capability_denied';end if;
  select * into r from public.academic_calendar_source_revisions where id=(q.source_manifest->0->>'id')::uuid and user_id=auth.uid();
  select * into s from public.academic_calendar_import_sources where id=r.source_id and user_id=auth.uid() for update;
  if r.format in ('ics','csv') then
    if q.provider<>'server_parser' or exists(select 1 from public.ai_inference_attempts a where a.scoped_request_id=q.id) then raise exception 'ai_transfer_unavailable';end if;
  else
    if not exists(select 1 from public.ai_inference_attempts a where a.scoped_request_id=q.id and a.user_id=auth.uid() and a.status='dispatching' and a.capability=q.capability) then raise exception 'ai_transfer_unavailable';end if;
    if r.format in ('png','jpeg','webp') and not exists(select 1 from public.ai_image_disclosures x where x.image_id=r.image_id and x.user_id=auth.uid()
      and x.capability=q.capability and x.status='succeeded' and x.id=(q.source_text::jsonb->>'disclosureId')::uuid) then raise exception 'ai_transfer_unavailable';end if;
  end if;
  if exists(select 1 from public.academic_calendar_revision_entries existing where existing.user_id=auth.uid() and existing.revision_id=r.id) then
    proposal:=ai_private.academic_build_review(r.id,q.source_handle);batch_id:=ai_private.insert_scoped_review(q,proposal,null);
    update public.ai_scoped_requests set status='proposed' where id=q.id;return batch_id;
  end if;
  for item in select * from jsonb_array_elements(d->'entries') loop
    perform ai_private.exact_keys(item,array['identityKind','identityKey','structureKey','identityEvidence','event']);
    v_identity_kind:=item->>'identityKind';v_identity_key:=item->>'identityKey';v_structure_key:=case when item->'structureKey'='null'::jsonb then null else item->>'structureKey' end;v_evidence:=item->>'identityEvidence';
    if v_identity_kind not in ('ics_uid','csv_id','structure_semantic','resolved_semantic') or char_length(v_identity_key) not between 1 and 160
      or v_evidence is null or char_length(v_evidence) not between 1 and 500 or (v_structure_key is not null and char_length(v_structure_key) not between 1 and 160) then raise exception 'ai_invalid_proposal';end if;
    if (r.format='ics' and v_identity_kind not in ('ics_uid','structure_semantic')) or (r.format='csv' and v_identity_kind not in ('csv_id','structure_semantic'))
      or (r.format in ('txt','md') and v_identity_kind<>'structure_semantic') or (r.format in ('png','jpeg','webp') and v_identity_kind<>'resolved_semantic') then raise exception 'ai_invalid_proposal';end if;
    event_value:=item->'event';event_digest:=ai_private.academic_event_digest(event_value);
    select * into entry_row from public.academic_calendar_source_entries e where e.user_id=auth.uid() and e.source_id=s.id and e.identity_key=v_identity_key for update;
    entry_id:=entry_row.id;
    if entry_id is null and v_identity_kind in ('structure_semantic','resolved_semantic') then
      select count(*),min(e.id) into candidate_count,entry_id
      from public.academic_calendar_source_entries e join public.academic_calendar_revision_entries prior on prior.entry_id=e.id and prior.revision_id=e.current_revision_id
      where e.user_id=auth.uid() and e.source_id=s.id and e.current_revision_id<>r.id and e.status in ('present','absent')
        and ((v_structure_key is not null and e.structure_key=v_structure_key) or (v_structure_key is null and e.identity_kind='resolved_semantic'))
        and (prior.source_event->>'title'=event_value->>'title' or prior.source_event->>'start'=event_value->>'start');
      if candidate_count<>1 then entry_id:=null;end if;
    end if;
    if entry_id is null then
      insert into public.academic_calendar_source_entries(user_id,source_id,identity_kind,identity_key,structure_key,current_revision_id)
        values(auth.uid(),s.id,v_identity_kind,v_identity_key,v_structure_key,r.id) returning id into entry_id;
    else
      update public.academic_calendar_source_entries set status='present',current_revision_id=r.id,structure_key=coalesce(v_structure_key,academic_calendar_source_entries.structure_key),last_seen_at=clock_timestamp()
        where id=entry_id and user_id=auth.uid();
    end if;
    insert into public.academic_calendar_revision_entries(user_id,revision_id,source_id,entry_id,identity_evidence,source_event,source_digest)
      values(auth.uid(),r.id,s.id,entry_id,v_evidence,event_value,event_digest);
  end loop;
  update public.academic_calendar_source_entries e set status='absent'
    where e.user_id=auth.uid() and e.source_id=s.id and not exists(select 1 from public.academic_calendar_revision_entries re where re.revision_id=r.id and re.entry_id=e.id);
  update public.academic_calendar_entry_links l set source_state=case when e.status='absent' then 'absent' else 'present' end,updated_at=clock_timestamp()
    from public.academic_calendar_source_entries e where l.user_id=auth.uid() and l.entry_id=e.id and e.source_id=s.id;
  proposal:=ai_private.academic_build_review(r.id,q.source_handle);
  batch_id:=ai_private.insert_scoped_review(q,proposal,null);
  update public.ai_scoped_requests set status='proposed' where id=q.id;
  return batch_id;
end $$;

create function public.ai_revise_academic_calendar(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb;b public.operation_batches;q public.ai_scoped_requests;old_proposal jsonb;next_proposal jsonb;events jsonb:='[]';item jsonb;edit jsonb;batch_id uuid;revision_id uuid;
begin
  d:=ai_private.verify_command(p_message,p_mac,'revise_academic_calendar');perform ai_private.exact_keys(d,array['batch_id','edits']);
  if jsonb_typeof(d->'edits')<>'array' then raise exception 'ai_invalid_proposal';end if;
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid();if not found then raise exception 'ai_proposal_unavailable';end if;
  q:=ai_private.lock_scoped_request(b.ai_scoped_request_id);if q.capability<>'academicCalendarImport.propose' then raise exception 'ai_capability_denied';end if;
  select * into b from public.operation_batches where id=b.id for update;if b.status<>'proposed' or q.status<>'proposed' then raise exception 'ai_proposal_unavailable';end if;
  old_proposal:=ai_private.assert_scoped_review(b.id)->'proposal';revision_id:=(old_proposal->>'revisionId')::uuid;
  if old_proposal->>'stateDigest'<>ai_private.academic_calendar_review_state(revision_id)
    or jsonb_array_length(d->'edits')<>jsonb_array_length(old_proposal->'events')
    or (select count(distinct value->>'entryId') from jsonb_array_elements(d->'edits'))<>jsonb_array_length(d->'edits') then raise exception 'ai_source_changed';end if;
  for item in select * from jsonb_array_elements(old_proposal->'events') loop
    select value into edit from jsonb_array_elements(d->'edits') where value->>'entryId'=item->>'entryId';
    if edit is null then raise exception 'ai_invalid_proposal';end if;perform ai_private.exact_keys(edit,array['entryId','decision','event']);
    if item->>'operation' in ('CREATE','UPDATE') and edit->>'decision' not in ('APPLY','IGNORE') then raise exception 'ai_invalid_proposal';
    elsif item->>'operation'='CONFLICT' and edit->>'decision' not in ('APPLY_SOURCE','KEEP_CURRENT','IGNORE') then raise exception 'ai_invalid_proposal';
    elsif item->>'operation' in ('IGNORE','UNCHANGED') and edit->>'decision'<>'IGNORE' then raise exception 'ai_invalid_proposal';end if;
    perform ai_private.academic_event_digest(edit->'event');
    events:=events||jsonb_build_array((item-'decision'-'reviewed')||jsonb_build_object('decision',edit->>'decision','reviewed',edit->'event'));
  end loop;
  next_proposal:=(old_proposal-'events')||jsonb_build_object('events',events);
  perform ai_private.validate_scoped_output(q.capability,next_proposal,q.source_handle);
  update public.operation_batches set status='rejected' where id=b.id;
  return ai_private.insert_scoped_review(q,next_proposal,b.id);
end $$;

alter function ai_private.finish_scoped_apply(uuid,jsonb) rename to finish_scoped_apply_pass2c;
create function ai_private.finish_scoped_apply(batch_id uuid,result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches;q public.ai_scoped_requests;authority jsonb;
begin
  select * into b from public.operation_batches where id=batch_id and user_id=auth.uid() for update;
  select * into q from public.ai_scoped_requests where id=b.ai_scoped_request_id and user_id=auth.uid();
  if q.capability<>'academicCalendarImport.propose' then perform ai_private.finish_scoped_apply_pass2c(batch_id,result);return;end if;
  if b.status<>'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id() or q.status<>'proposed' or q.expires_at<=clock_timestamp() then raise exception 'ai_consumption_unavailable';end if;
  authority:=ai_private.assert_scoped_review(b.id);perform ai_private.exact_keys(result,array['entity','ids']);
  if result->>'entity'<>'academic_calendar' or jsonb_typeof(result->'ids')<>'array' or octet_length(result::text)>4096
    or (select count(distinct value) from jsonb_array_elements_text(result->'ids'))<>jsonb_array_length(result->'ids')
    or (select count(*) from public.calendar_events e where e.user_id=auth.uid() and e.source='academic_calendar'
      and e.id in(select value::uuid from jsonb_array_elements_text(result->'ids')))<>jsonb_array_length(result->'ids') then raise exception 'ai_invalid_result';end if;
  update public.operation_steps set inverse=jsonb_build_object('result',result,'review_digest',b.ai_review_digest,'source_manifest',q.source_manifest,
    'provider',q.provider,'model',q.model,'evidence',case when q.provider='server_parser' then 'deterministic_parser' else 'reviewed_extraction' end,'undo_supported',false)
    where operation_steps.batch_id=b.id and position=0;
  update public.operation_batches set status='committed',committed_at=clock_timestamp() where id=b.id;
  update public.ai_scoped_requests set status='applied' where id=q.id;
end $$;

create function public.ai_apply_academic_calendar(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;proposal jsonb;item jsonb;v_revision_id uuid;v_entry_id uuid;reviewed jsonb;v_source_digest text;link public.academic_calendar_entry_links;
  current_state jsonb;event_id uuid;ids jsonb:='[]';decision text;operation text;
begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'academicCalendarImport.propose');proposal:=a->'proposal';v_revision_id:=(proposal->>'revisionId')::uuid;
  if proposal->>'stateDigest'<>ai_private.academic_calendar_review_state(v_revision_id) then raise exception 'ai_source_changed';end if;
  for item in select * from jsonb_array_elements(proposal->'events') loop
    v_entry_id:=(item->>'entryId')::uuid;decision:=item->>'decision';operation:=item->>'operation';reviewed:=item->'reviewed';
    if item->>'entryFingerprint'<>ai_private.academic_entry_fingerprint(v_entry_id,v_revision_id) then raise exception 'ai_source_changed';end if;
    select re.source_digest into v_source_digest from public.academic_calendar_revision_entries re where re.user_id=auth.uid() and re.revision_id=v_revision_id and re.entry_id=v_entry_id;
    select * into link from public.academic_calendar_entry_links l where l.user_id=auth.uid() and l.entry_id=v_entry_id for update;
    if decision in ('IGNORE','KEEP_CURRENT') then
      update public.academic_calendar_source_entries set ignored_source_digest=v_source_digest where id=v_entry_id and user_id=auth.uid();continue;
    end if;
    if decision not in ('APPLY','APPLY_SOURCE') then continue;end if;
    current_state:=ai_private.academic_calendar_event_state(link.canonical_event_id);
    if operation='CREATE' and (link.canonical_event_id is not null or link.last_imported is not null) then raise exception 'ai_source_changed';end if;
    if operation='UPDATE' and (current_state is null or current_state->>'digest' is distinct from link.baseline_digest) then raise exception 'ai_source_changed';end if;
    if link.canonical_event_id is null then
      insert into public.calendar_events(user_id,title,description,starts_at,ends_at,all_day,event_type,source,external_id)
        values(auth.uid(),reviewed->>'title',reviewed->>'description',(reviewed->>'start')::timestamptz,(reviewed->>'end')::timestamptz,
          (reviewed->>'allDay')::boolean,reviewed->>'eventType','academic_calendar','entry:'||v_entry_id) returning id into event_id;
    else
      event_id:=link.canonical_event_id;
      update public.calendar_events set title=reviewed->>'title',description=reviewed->>'description',starts_at=(reviewed->>'start')::timestamptz,
        ends_at=(reviewed->>'end')::timestamptz,all_day=(reviewed->>'allDay')::boolean,event_type=reviewed->>'eventType'
        where id=event_id and user_id=auth.uid() and source='academic_calendar' and external_id='entry:'||v_entry_id;
      if not found then raise exception 'ai_source_changed';end if;
    end if;
    insert into public.academic_calendar_entry_links(user_id,entry_id,canonical_event_id,last_imported,baseline_digest,last_source_digest,last_revision_id,source_state,applied_at)
      values(auth.uid(),v_entry_id,event_id,reviewed,ai_private.academic_event_digest(reviewed),v_source_digest,v_revision_id,'present',clock_timestamp())
      on conflict(user_id,entry_id) do update set canonical_event_id=excluded.canonical_event_id,last_imported=excluded.last_imported,
        baseline_digest=excluded.baseline_digest,last_source_digest=excluded.last_source_digest,last_revision_id=excluded.last_revision_id,
        source_state='present',applied_at=excluded.applied_at,updated_at=clock_timestamp();
    update public.academic_calendar_source_entries set ignored_source_digest=null where id=v_entry_id and user_id=auth.uid();
    if not ids @> jsonb_build_array(event_id) then ids:=ids||jsonb_build_array(event_id);end if;
  end loop;
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','academic_calendar','ids',ids));
  return jsonb_build_object('calendarEventIds',ids);
end $$;

create or replace function ai_private.cloud_allowed(p_capability text,p_provider text) returns boolean
language sql security definer set search_path='' as $$
  select coalesce((select cloud_enabled and cloud_fallback_mode<>'off' and (ai_mode=p_provider or (ai_mode='auto' and (preferred_cloud=p_provider or secondary_cloud))) and
    case p_capability when 'taskChecklist.propose' then checklist_cloud when 'courseImport.propose' then course_import_cloud
      when 'schoolScheduleImage.propose' then school_schedule_cloud and cloud_fallback_mode='ask_each_time'
      when 'blackboardCourseImage.propose' then blackboard_course_cloud and cloud_fallback_mode='ask_each_time'
      when 'academicCalendarImport.propose' then academic_calendar_cloud and cloud_fallback_mode='ask_each_time'
      else false end from public.ai_preferences where user_id=auth.uid()),false)
$$;

alter function ai_private.inference_source(uuid,uuid,uuid) rename to inference_source_pass2c;
create function ai_private.inference_source(p_checklist uuid,p_course uuid,p_scoped uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare q public.ai_scoped_requests;r public.academic_calendar_source_revisions;x jsonb;
begin
  if p_scoped is not null then select * into q from public.ai_scoped_requests where id=p_scoped and user_id=auth.uid();end if;
  if q.capability='academicCalendarImport.propose' then
    if num_nonnulls(p_checklist,p_course,p_scoped)<>1 then raise exception 'ai_capability_denied';end if;
    q:=ai_private.lock_scoped_request(p_scoped);if q.status<>'prepared' then raise exception 'ai_request_unavailable';end if;
    select * into r from public.academic_calendar_source_revisions where id=(q.source_manifest->0->>'id')::uuid and user_id=auth.uid();
    if r.format in ('ics','csv') then raise exception 'ai_capability_denied';end if;
    if r.format in ('png','jpeg','webp') then
      x:=q.source_text::jsonb;
      if not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=auth.uid() and d.image_id=r.image_id
        and d.capability=q.capability and d.provider=q.provider and d.model=q.model and d.location=x->>'location'
        and d.status in ('prepared','awaiting_consent','consented') and d.expires_at>clock_timestamp()) then raise exception 'ai_disclosure_unavailable';end if;
    end if;
    return q.expires_at;
  end if;
  return ai_private.inference_source_pass2c(p_checklist,p_course,p_scoped);
end $$;

create or replace function public.ai_school_prediction_attempt_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare q public.ai_scoped_requests;x jsonb;r public.academic_calendar_source_revisions;
begin
  if new.scoped_request_id is null then return new;end if;select * into q from public.ai_scoped_requests where id=new.scoped_request_id and user_id=new.user_id;
  if q.trust_version is null then return new;end if;
  if q.trust_version<>2 or new.capability is distinct from q.capability or new.provider is distinct from q.provider or new.model is distinct from q.model or new.parent_id is not null then raise exception 'ai_capability_denied';end if;
  if q.capability='schoolAssessmentPrediction.propose' then if new.location not in ('local','remote_local') then raise exception 'ai_capability_denied';end if;
  elsif q.capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then
    x:=q.source_text::jsonb;if new.location is distinct from x->>'location' or not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=new.user_id and d.capability=q.capability and d.provider=new.provider and d.model=new.model and d.location=new.location) then raise exception 'ai_capability_denied';end if;
  elsif q.capability='academicCalendarImport.propose' then
    select * into r from public.academic_calendar_source_revisions where id=(q.source_manifest->0->>'id')::uuid and user_id=new.user_id;
    x:=q.source_text::jsonb;
    if r.format in ('ics','csv') or new.location is distinct from x->>'location' then raise exception 'ai_capability_denied';end if;
    if r.format in ('png','jpeg','webp') and not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=new.user_id
      and d.image_id=r.image_id and d.capability=q.capability and d.provider=new.provider and d.model=new.model and d.location=new.location) then raise exception 'ai_capability_denied';end if;
  else raise exception 'ai_capability_denied';end if;return new;
end $$;

revoke all on function ai_private.academic_event_digest(jsonb),ai_private.academic_calendar_event_state(uuid),
  ai_private.academic_calendar_revision_fingerprint(uuid),ai_private.academic_calendar_review_state(uuid),
  ai_private.academic_entry_fingerprint(uuid,uuid),ai_private.academic_build_review(uuid,text),
  ai_private.scoped_source_manifest(jsonb),ai_private.validate_scoped_manifest(text,jsonb),
  ai_private.validate_scoped_output(text,jsonb,text),ai_private.scoped_review_target(public.ai_scoped_requests),
  ai_private.finish_scoped_apply(uuid,jsonb),ai_private.inference_source(uuid,uuid,uuid),
  ai_private.scoped_source_manifest_pass2c(jsonb),ai_private.validate_scoped_manifest_pass2c(text,jsonb),
  ai_private.validate_scoped_output_pass2c(text,jsonb,text),ai_private.scoped_review_target_pass2c(public.ai_scoped_requests),
  ai_private.finish_scoped_apply_pass2c(uuid,jsonb),ai_private.inference_source_pass2c(uuid,uuid,uuid),
  public.academic_calendar_event_provenance_guard(),public.academic_calendar_revision_immutable(),public.ai_prepare_academic_calendar(text,text),
  public.ai_record_academic_calendar(text,text),public.ai_revise_academic_calendar(text,text),public.ai_apply_academic_calendar(text,text)
from public,anon,authenticated;
grant execute on function public.ai_prepare_academic_calendar(text,text),public.ai_record_academic_calendar(text,text),
  public.ai_revise_academic_calendar(text,text),public.ai_apply_academic_calendar(text,text) to authenticated;
