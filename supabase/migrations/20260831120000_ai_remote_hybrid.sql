-- Phase 10B: inference routing only. Existing review/apply RPCs remain authoritative.
alter table public.ai_preferences
  add column ai_mode text not null default 'auto' check (ai_mode in ('auto','local','gemini','openrouter')),
  add column preferred_cloud text not null default 'gemini' check (preferred_cloud in ('gemini','openrouter')),
  add column secondary_cloud boolean not null default false,
  add column checklist_cloud boolean not null default false,
  add column course_import_cloud boolean not null default false;
alter table public.ai_requests drop constraint ai_requests_provider_check;
alter table public.ai_requests add constraint ai_requests_provider_check check (provider in ('ollama','llamacpp','openai_compatible','gemini','openrouter'));
alter table public.ai_course_requests drop constraint ai_course_requests_provider_check;
alter table public.ai_course_requests add constraint ai_course_requests_provider_check check (provider in ('ollama','llamacpp','openai_compatible','gemini','openrouter'));

create table public.ai_inference_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  checklist_request_id uuid references public.ai_requests(id) on delete cascade,
  course_request_id uuid references public.ai_course_requests(id) on delete cascade,
  parent_id uuid unique references public.ai_inference_attempts(id) on delete set null,
  provider text not null check (provider in ('ollama','llamacpp','openai_compatible','gemini','openrouter')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  location text not null check (location in ('local','remote_local','cloud')),
  capability text not null check (capability in ('taskChecklist.propose','courseImport.propose')),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  text_bytes integer not null check (text_bytes between 1 and 45056),
  status text not null check (status in ('ready','awaiting_consent','dispatching','succeeded','failed','cancelled')),
  error_code text check (error_code in ('provider_unavailable','rate_limited','missing_credentials','local_unavailable','timeout','network_unavailable','pairing_invalid','invalid_output','source_changed','provider_rejected','ai_unavailable')),
  consented_at timestamptz,
  claimed_at timestamptz,
  remote_ticket_issued boolean not null default false,
  completed_at timestamptz,
  latency_ms integer check (latency_ms between 0 and 120000),
  batch_id uuid references public.operation_batches(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (num_nonnulls(checklist_request_id,course_request_id)=1),
  check ((location='cloud')=(provider in ('gemini','openrouter'))),
  check ((capability='taskChecklist.propose')=(checklist_request_id is not null)),
  check (status<>'succeeded' or batch_id is not null),
  check (location<>'cloud' or status not in ('dispatching','succeeded') or consented_at is not null)
);
-- One bounded chain, no repeat provider or parallel pending sends for a source.
create unique index ai_inference_checklist_provider on public.ai_inference_attempts(checklist_request_id,provider);
create unique index ai_inference_course_provider on public.ai_inference_attempts(course_request_id,provider);
create unique index ai_inference_checklist_active on public.ai_inference_attempts(checklist_request_id) where status in ('ready','awaiting_consent','dispatching','succeeded');
create unique index ai_inference_course_active on public.ai_inference_attempts(course_request_id) where status in ('ready','awaiting_consent','dispatching','succeeded');
alter table public.ai_inference_attempts enable row level security;
revoke all on public.ai_inference_attempts from public,anon,authenticated;
grant select on public.ai_inference_attempts to authenticated;
create policy ai_inference_owner_read on public.ai_inference_attempts for select to authenticated using(user_id=(select auth.uid()));

create function ai_private.inference_source(p_checklist uuid,p_course uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare r public.ai_requests%rowtype; c public.ai_course_requests%rowtype; context jsonb;
begin
  if num_nonnulls(p_checklist,p_course)<>1 then raise exception 'ai_capability_denied'; end if;
  if p_checklist is not null then
    select * into r from public.ai_requests where id=p_checklist and user_id=auth.uid() for update;
    if not found or r.status<>'prepared' or r.expires_at<=now() then raise exception 'ai_request_unavailable'; end if;
    context:=public.ai_read_task_context(r.task_id);
    if context->>'revision' is distinct from r.source_revision then raise exception 'ai_source_changed'; end if;
    return r.expires_at;
  end if;
  select * into c from public.ai_course_requests where id=p_course and user_id=auth.uid() for update;
  if not found or c.status<>'prepared' or c.expires_at<=now() then raise exception 'ai_request_unavailable'; end if;
  if c.source_digest<>encode(sha256(convert_to(c.source_text,'UTF8')),'hex') then raise exception 'ai_source_changed'; end if;
  return c.expires_at;
end $$;
revoke all on function ai_private.inference_source(uuid,uuid) from public,anon,authenticated;

create function ai_private.cloud_allowed(p_capability text,p_provider text) returns boolean
language sql security definer set search_path='' as $$
  select coalesce((select cloud_enabled and cloud_fallback_mode<>'off' and
    (ai_mode=p_provider or (ai_mode='auto' and (preferred_cloud=p_provider or secondary_cloud))) and
    case p_capability when 'taskChecklist.propose' then checklist_cloud when 'courseImport.propose' then course_import_cloud else false end
    from public.ai_preferences where user_id=auth.uid()),false)
$$;
revoke all on function ai_private.cloud_allowed(text,text) from public,anon,authenticated;

create function public.ai_prepare_inference(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; parent public.ai_inference_attempts%rowtype; expiry timestamptz; ck uuid; cr uuid;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_inference');
  ck:=(d->>'checklist_request_id')::uuid; cr:=(d->>'course_request_id')::uuid;
  expiry:=ai_private.inference_source(ck,cr);
  if d->>'location'='cloud' and not ai_private.cloud_allowed(d->>'capability',d->>'provider') then raise exception 'ai_cloud_denied'; end if;
  if d->>'parent_id' is not null then
    select * into parent from public.ai_inference_attempts where id=(d->>'parent_id')::uuid and user_id=auth.uid() for update;
    if not found or parent.status<>'failed' or parent.checklist_request_id is distinct from ck or parent.course_request_id is distinct from cr
      or coalesce((select ai_mode from public.ai_preferences where user_id=auth.uid()),'local')<>'auto'
      or not (parent.error_code in ('provider_unavailable','rate_limited','missing_credentials','local_unavailable')
        or (parent.location<>'cloud' and parent.error_code in ('timeout','network_unavailable')))
      then raise exception 'ai_fallback_denied'; end if;
  end if;
  if (select count(*) from public.ai_inference_attempts where checklist_request_id=ck or course_request_id=cr)>=3 then raise exception 'ai_route_exhausted'; end if;
  insert into public.ai_inference_attempts(id,user_id,checklist_request_id,course_request_id,parent_id,provider,model,location,capability,payload_digest,text_bytes,status,expires_at)
  values((d->>'id')::uuid,auth.uid(),ck,cr,(d->>'parent_id')::uuid,d->>'provider',d->>'model',d->>'location',d->>'capability',d->>'payload_digest',(d->>'text_bytes')::integer,
    case when d->>'location'='cloud' then 'awaiting_consent' else 'ready' end,expiry);
  return (d->>'id')::uuid;
end $$;

create function public.ai_claim_inference(p_message text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb; a public.ai_inference_attempts%rowtype;
begin
  d:=ai_private.verify_command(p_message,p_mac,'claim_inference');
  select * into a from public.ai_inference_attempts where id=(d->>'id')::uuid and user_id=auth.uid() for update;
  if not found or a.status not in ('ready','awaiting_consent') or a.expires_at<=now() or a.payload_digest is distinct from d->>'payload_digest'
    then raise exception 'ai_transfer_unavailable'; end if;
  perform ai_private.inference_source(a.checklist_request_id,a.course_request_id);
  if a.location='cloud' and (not ai_private.cloud_allowed(a.capability,a.provider) or (d->'consent') is distinct from 'true'::jsonb)
    then raise exception 'ai_cloud_denied'; end if;
  update public.ai_inference_attempts set status='dispatching',claimed_at=clock_timestamp(),
    consented_at=case when a.location='cloud' then clock_timestamp() else null end where id=a.id;
end $$;

create function public.ai_finish_inference(p_message text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb; a public.ai_inference_attempts%rowtype; b public.operation_batches%rowtype;
begin
  d:=ai_private.verify_command(p_message,p_mac,'finish_inference');
  select * into a from public.ai_inference_attempts where id=(d->>'id')::uuid and user_id=auth.uid() for update;
  if not found or a.status not in ('ready','awaiting_consent','dispatching') then raise exception 'ai_transfer_unavailable'; end if;
  if d->>'status'='cancelled' and a.status='dispatching' then raise exception 'ai_transfer_unavailable'; end if;
  if d->>'status'='succeeded' then
    if a.status<>'dispatching' then raise exception 'ai_transfer_unavailable'; end if;
    select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid();
    if not found or b.source<>'ai' or b.ai_request_id is distinct from a.checklist_request_id or b.ai_course_request_id is distinct from a.course_request_id
      then raise exception 'ai_untrusted_proposal'; end if;
  elsif d->>'status' not in ('failed','cancelled') then raise exception 'ai_transfer_unavailable'; end if;
  update public.ai_inference_attempts set status=d->>'status',error_code=d->>'error_code',completed_at=clock_timestamp(),
    latency_ms=(d->>'latency_ms')::integer,batch_id=(d->>'batch_id')::uuid where id=a.id;
end $$;

-- Owner equality is checked independently of RLS, including privileged maintenance writes.
create function public.ai_inference_owner_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.checklist_request_id is not null and not exists(select 1 from public.ai_requests where id=new.checklist_request_id and user_id=new.user_id))
    or (new.course_request_id is not null and not exists(select 1 from public.ai_course_requests where id=new.course_request_id and user_id=new.user_id))
    or (new.parent_id is not null and not exists(select 1 from public.ai_inference_attempts where id=new.parent_id and user_id=new.user_id))
    or (new.batch_id is not null and not exists(select 1 from public.operation_batches where id=new.batch_id and user_id=new.user_id))
    then raise exception 'ai_owner_mismatch'; end if;
  return new;
end $$;
create trigger ai_inference_owner_guard before insert or update on public.ai_inference_attempts for each row execute function public.ai_inference_owner_guard();
revoke all on function public.ai_prepare_inference(text,text),public.ai_claim_inference(text,text),public.ai_finish_inference(text,text) from public,anon;
grant execute on function public.ai_prepare_inference(text,text),public.ai_claim_inference(text,text),public.ai_finish_inference(text,text) to authenticated;

create function public.ai_read_inference_provenance(p_batch_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('provider',a.provider,'model',a.model,'location',a.location,
    'evidence',case when a.location='cloud' then 'server_response' else 'browser_relay' end,'latencyMs',a.latency_ms)
  from public.operation_batches b join public.ai_inference_attempts a on
    (a.checklist_request_id=b.ai_request_id or a.course_request_id=b.ai_course_request_id)
  where b.id=p_batch_id and b.user_id=auth.uid() and a.user_id=auth.uid() and a.status='succeeded'
$$;
revoke all on function public.ai_read_inference_provenance(uuid) from public,anon;
grant execute on function public.ai_read_inference_provenance(uuid) to authenticated;

create function public.ai_claim_remote_ticket(p_message text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'claim_remote_ticket');
  update public.ai_inference_attempts set remote_ticket_issued=true where id=(d->>'id')::uuid and user_id=auth.uid()
    and location='remote_local' and status='dispatching' and expires_at>now() and not remote_ticket_issued;
  if not found then raise exception 'ai_request_unavailable'; end if;
end $$;
revoke all on function public.ai_claim_remote_ticket(text,text) from public,anon;
grant execute on function public.ai_claim_remote_ticket(text,text) to authenticated;

create or replace function public.ai_read_checklist_review(p_batch_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('batchId',b.id,'taskTitle',t.title,'items',s.input->'items','status',b.status,
    'proposal',s.input,'proposalDigest',encode(sha256(convert_to(s.input::text,'UTF8')),'hex'),
    'capability',r.capability,'taskHandle',r.task_handle,'provenance',public.ai_read_inference_provenance(b.id))
  from public.operation_batches b join public.ai_requests r on r.id=b.ai_request_id and r.user_id=auth.uid()
    join public.operation_steps s on s.batch_id=b.id and s.position=0 and s.user_id=auth.uid()
    join public.tasks t on t.id=r.task_id and t.user_id=auth.uid()
  where b.id=p_batch_id and b.user_id=auth.uid() and b.source='ai'
$$;
create or replace function public.ai_read_course_review(p_batch_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('batchId',b.id,'status',b.status,'input',s.input,'proposalDigest',encode(sha256(convert_to(s.input::text,'UTF8')),'hex'),
    'sourceHandle',r.source_handle,'capability',r.capability,'fileName',r.file_name,'startDate',r.start_date,'timeZone',r.time_zone,
    'provenance',public.ai_read_inference_provenance(b.id))
  from public.operation_batches b join public.ai_course_requests r on r.id=b.ai_course_request_id and r.user_id=auth.uid()
    join public.operation_steps s on s.batch_id=b.id and s.user_id=auth.uid() and s.position=0
  where b.id=p_batch_id and b.user_id=auth.uid() and b.source='ai'
$$;
-- Attempts retain metadata only. They share the protected proposal-audit lifetime;
-- no claim that the legacy 30-day cloud-history purge deletes this new audit.
