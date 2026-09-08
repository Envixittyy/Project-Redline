-- Repair Pass 1: reuse protected source / batch / step storage. Legacy rows are
-- NOT backfilled or attested. All existing containment revocations remain.
alter table public.ai_scoped_requests
  add column trust_version smallint check (trust_version=2),
  add column source_manifest jsonb,
  add column authority_digest text,
  add constraint ai_scoped_v2_manifest check (
    (trust_version is null and source_manifest is null and authority_digest is null) or
    (trust_version is not null and trust_version=2 and source_manifest is not null and jsonb_typeof(source_manifest)='array'
      and jsonb_array_length(source_manifest) between 1 and 8 and authority_digest is not null and authority_digest ~ '^[a-f0-9]{64}$')
  );
alter table public.operation_batches
  add column ai_predecessor_batch_id uuid references public.operation_batches(id) on delete restrict,
  add column ai_review_digest text check (ai_review_digest ~ '^[a-f0-9]{64}$'),
  add column ai_apply_xid xid8,
  add constraint ai_scoped_review_metadata check (
    (ai_predecessor_batch_id is null and ai_review_digest is null and ai_apply_xid is null) or
    (source='ai' and ai_scoped_request_id is not null and ai_review_digest is not null)
  );
create unique index ai_scoped_one_successor on public.operation_batches(ai_predecessor_batch_id) where ai_predecessor_batch_id is not null;

create function ai_private.scoped_request_digest(r public.ai_scoped_requests) returns text
language sql stable set search_path='' set timezone='UTC' as $$
  select ai_private.scoped_hash(to_jsonb(r)-'status'-'authority_digest')
$$;
create function ai_private.scoped_review_digest(request_digest text, batch_id uuid, predecessor uuid, proposal jsonb) returns text
language sql immutable set search_path='' as $$
  select ai_private.scoped_hash(jsonb_build_array(2,request_digest,batch_id,predecessor,proposal))
$$;

create function public.ai_scoped_request_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.trust_version is null and new.trust_version is null then return new; end if;
  if old.trust_version is distinct from 2 or
    (to_jsonb(old)-'status') is distinct from (to_jsonb(new)-'status') then raise exception 'ai_immutable_source'; end if;
  if new.status is distinct from old.status and not (
    (old.status='prepared' and new.status in ('proposed','rejected','conflict')) or
    (old.status='proposed' and new.status in ('applied','rejected','conflict'))
  ) then raise exception 'ai_invalid_transition'; end if;
  return new;
end $$;
create trigger ai_scoped_source_immutable before update on public.ai_scoped_requests
  for each row execute function public.ai_scoped_request_immutable();

create function public.ai_scoped_review_immutable() returns trigger
language plpgsql set search_path='' as $$
declare r public.ai_scoped_requests%rowtype; prior public.operation_batches%rowtype;
begin
  if tg_op='UPDATE' and old.ai_review_digest is not null then
    if (to_jsonb(old)-'status'-'committed_at'-'ai_apply_xid') is distinct from
      (to_jsonb(new)-'status'-'committed_at'-'ai_apply_xid') then raise exception 'ai_immutable_review'; end if;
    if (new.ai_apply_xid is distinct from old.ai_apply_xid and not
      (old.ai_apply_xid is null and old.status='proposed' and new.status='confirmed' and new.ai_apply_xid=pg_current_xact_id()))
      or (new.committed_at is distinct from old.committed_at and not (old.status='confirmed' and new.status='committed'))
      or (new.status is distinct from old.status and not (
        (old.status='proposed' and new.status in ('confirmed','rejected')) or (old.status='confirmed' and new.status='committed')
      )) then raise exception 'ai_invalid_transition'; end if;
  end if;
  select * into r from public.ai_scoped_requests where id=new.ai_scoped_request_id;
  if r.trust_version is distinct from 2 then
    if new.ai_review_digest is not null then raise exception 'ai_untrusted_proposal'; end if;
    return new;
  end if;
  if new.user_id<>r.user_id or new.source<>'ai' or new.ai_review_digest is null or new.capture_id is not null then raise exception 'ai_untrusted_proposal'; end if;
  if tg_op='INSERT' then
    if new.status<>'proposed' or new.ai_apply_xid is not null or new.committed_at is not null then raise exception 'ai_invalid_transition'; end if;
    if new.ai_predecessor_batch_id is not null then
      select * into prior from public.operation_batches where id=new.ai_predecessor_batch_id;
      if not found or prior.user_id<>new.user_id or prior.ai_scoped_request_id<>r.id or prior.ai_review_digest is null or prior.status<>'rejected' then
        raise exception 'ai_invalid_predecessor';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger ai_scoped_review_immutable before insert or update on public.operation_batches
  for each row execute function public.ai_scoped_review_immutable();

create function public.ai_scoped_step_immutable() returns trigger
language plpgsql set search_path='' as $$
declare b public.operation_batches%rowtype;
begin
  if tg_op='UPDATE' and exists(select 1 from public.operation_batches where id=old.batch_id and ai_review_digest is not null) then
    if (to_jsonb(old)-'inverse') is distinct from (to_jsonb(new)-'inverse') or old.inverse is not null then raise exception 'ai_immutable_review'; end if;
  end if;
  select * into b from public.operation_batches where id=new.batch_id;
  if b.ai_review_digest is null then return new; end if;
  if new.user_id<>b.user_id or new.position<>0 or (tg_op='INSERT' and new.inverse is not null) then raise exception 'ai_invalid_proposal'; end if;
  if tg_op='UPDATE' and (b.status<>'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id()) then raise exception 'ai_invalid_transition'; end if;
  return new;
end $$;
create trigger ai_scoped_step_immutable before insert or update on public.operation_steps
  for each row execute function public.ai_scoped_step_immutable();

-- Resolve the complete authority from persisted data. No caller-supplied source,
-- expected revision, provider, operation type, or replacement payload is accepted.
create function ai_private.assert_scoped_review(batch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
begin
  select * into b from public.operation_batches where id=batch_id and user_id=auth.uid();
  if not found or b.source<>'ai' or b.ai_review_digest is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id=b.ai_scoped_request_id and user_id=auth.uid();
  if not found or r.trust_version is distinct from 2 or r.authority_digest is distinct from ai_private.scoped_request_digest(r)
    or r.source_digest is distinct from encode(sha256(convert_to(r.source_text,'UTF8')),'hex') then raise exception 'ai_untrusted_source'; end if;
  perform ai_private.validate_scoped_manifest(r.capability,r.source_manifest);
  if (select count(*) from public.operation_steps steps where steps.batch_id=b.id)<>1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where operation_steps.batch_id=b.id and user_id=auth.uid() and position=0;
  if not found or s.action_type is distinct from r.capability or s.target_entity is distinct from 'note' or s.target_id is distinct from (r.source_manifest->0->>'id')::uuid then raise exception 'ai_invalid_proposal'; end if;
  perform ai_private.validate_scoped_output(r.capability,s.input,r.source_handle);
  if b.ai_review_digest is distinct from ai_private.scoped_review_digest(r.authority_digest,b.id,b.ai_predecessor_batch_id,s.input) then raise exception 'ai_review_changed'; end if;
  return jsonb_build_object('batch_id',b.id,'request_id',r.id,'capability',r.capability,
    'source_manifest',r.source_manifest,'proposal',s.input,'digest',b.ai_review_digest,'predecessor',b.ai_predecessor_batch_id,
    'expires_at',r.expires_at,'provider',r.provider,'model',r.model,'evidence','browser_relay');
end $$;

create function ai_private.lock_scoped_request(request_id uuid) returns public.ai_scoped_requests
language plpgsql security definer set search_path='' as $$
declare r public.ai_scoped_requests%rowtype; refs jsonb;
begin
  select * into r from public.ai_scoped_requests where id=request_id and user_id=auth.uid() for update;
  if not found or r.trust_version is distinct from 2 or r.status not in ('prepared','proposed') or r.expires_at<=clock_timestamp() then raise exception 'ai_request_unavailable'; end if;
  if r.authority_digest is distinct from ai_private.scoped_request_digest(r) then raise exception 'ai_untrusted_source'; end if;
  perform ai_private.validate_scoped_manifest(r.capability,r.source_manifest);
  select jsonb_agg(ref-'fingerprint' order by ref->>'kind',ref->>'id') into refs from jsonb_array_elements(r.source_manifest) ref;
  if r.source_manifest is distinct from ai_private.scoped_source_manifest(refs) then raise exception 'ai_source_changed'; end if;
  -- Recheck wall-clock expiry after potentially waiting for canonical locks.
  if r.expires_at<=clock_timestamp() then raise exception 'ai_request_unavailable'; end if;
  return r;
end $$;

-- Replaces the permissive shared bodies; does NOT restore their execute grants.
create or replace function public.ai_create_scoped_request(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; r public.ai_scoped_requests; n public.notes%rowtype;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_scoped_request');
  perform ai_private.exact_keys(d,array['capability','selection','provider','model','time_zone']);
  if d->>'capability' not in ('noteRewrite.propose','noteActionItems.propose') or jsonb_typeof(d->'capability') is distinct from 'string' then raise exception 'ai_capability_denied'; end if;
  if jsonb_typeof(d->'selection') is distinct from 'array' then raise exception 'ai_invalid_source'; end if;
  if jsonb_array_length(d->'selection')<>1 or d->'selection'->0->>'kind' is distinct from 'note' then raise exception 'ai_invalid_source'; end if;
  if jsonb_typeof(d->'provider') is distinct from 'string' or d->>'provider' not in ('ollama','llamacpp','openai_compatible')
    or jsonb_typeof(d->'model') is distinct from 'string' or d->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    or jsonb_typeof(d->'time_zone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'time_zone') then raise exception 'ai_invalid_source'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  if (select count(*) from public.ai_scoped_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'ai_rate_limited'; end if;
  r.source_manifest:=ai_private.scoped_source_manifest(d->'selection');
  select * into n from public.notes where id=(r.source_manifest->0->>'id')::uuid and user_id=auth.uid();
  r.source_text:=jsonb_build_object('title',n.title,'body',n.body)::text;
  if char_length(n.body)>20000 or char_length(n.title)>200 or octet_length(r.source_text)>32768 then raise exception 'ai_context_too_large'; end if;
  r.id:=gen_random_uuid(); r.user_id:=auth.uid(); r.capability:=d->>'capability';
  r.source_handle:='source_'||replace(gen_random_uuid()::text,'-','');
  r.source_digest:=encode(sha256(convert_to(r.source_text,'UTF8')),'hex');
  r.provider:=d->>'provider'; r.model:=d->>'model'; r.time_zone:=d->>'time_zone';
  r.created_at:=clock_timestamp(); r.expires_at:=r.created_at+interval '5 minutes';
  r.start_date:=(r.created_at at time zone r.time_zone)::date; r.status:='prepared'; r.trust_version:=2;
  r.authority_digest:=ai_private.scoped_request_digest(r);
  insert into public.ai_scoped_requests select (r).*;
  return r.id;
end $$;

create function ai_private.insert_scoped_review(r public.ai_scoped_requests, proposal jsonb, predecessor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare next_id uuid:=gen_random_uuid();
begin
  perform ai_private.validate_scoped_output(r.capability,proposal,r.source_handle);
  insert into public.operation_batches(id,user_id,source,status,summary,ai_scoped_request_id,ai_predecessor_batch_id,ai_review_digest)
    values(next_id,auth.uid(),'ai','proposed','Scoped AI review',r.id,predecessor,
      ai_private.scoped_review_digest(r.authority_digest,next_id,predecessor,proposal));
  insert into public.operation_steps(user_id,batch_id,position,action_type,target_entity,target_id,input)
    values(auth.uid(),next_id,0,r.capability,'note',(r.source_manifest->0->>'id')::uuid,proposal);
  perform ai_private.assert_scoped_review(next_id);
  return next_id;
end $$;

create or replace function public.ai_record_scoped_proposal(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; r public.ai_scoped_requests; next_id uuid;
begin
  d:=ai_private.verify_command(p_message,p_mac,'record_scoped_proposal');
  perform ai_private.exact_keys(d,array['request_id','proposal']);
  r:=ai_private.lock_scoped_request((d->>'request_id')::uuid);
  if r.status<>'prepared' then raise exception 'ai_request_unavailable'; end if;
  next_id:=ai_private.insert_scoped_review(r,d->'proposal',null);
  update public.ai_scoped_requests set status='proposed' where id=r.id;
  return next_id;
end $$;

create or replace function public.ai_revise_scoped_proposal(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; b public.operation_batches; r public.ai_scoped_requests;
begin
  d:=ai_private.verify_command(p_message,p_mac,'revise_scoped_proposal');
  perform ai_private.exact_keys(d,array['batch_id','proposal']);
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid();
  if not found then raise exception 'ai_proposal_unavailable'; end if;
  -- Consistent lock order: request, canonical sources, then batch.
  r:=ai_private.lock_scoped_request(b.ai_scoped_request_id);
  select * into b from public.operation_batches where id=b.id for update;
  if b.status<>'proposed' or r.status<>'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  perform ai_private.assert_scoped_review(b.id);
  perform ai_private.validate_scoped_output(r.capability,d->'proposal',r.source_handle);
  update public.operation_batches set status='rejected' where id=b.id;
  return ai_private.insert_scoped_review(r,d->'proposal',b.id);
end $$;

-- Application-side helpers are not transaction boundaries. Future domain RPCs
-- must call begin, perform FIXED domain SQL, and finish inside ONE SQL function.
-- No dynamic SQL/callback/operation dispatch, no public generic Apply function.
-- Serialize policy reads with changes, including creation/deletion of a settings
-- row (where FOR SHARE alone cannot protect the default policy).
create function public.ai_lock_mutation_policy() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actor uuid;
begin
  if tg_op='DELETE' then actor:=old.user_id; else actor:=new.user_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,17));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger ai_mutation_policy_lock before insert or update or delete on public.ai_preferences
  for each row execute function public.ai_lock_mutation_policy();

create function ai_private.begin_scoped_apply(p_message text,p_mac text,expected_capability text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; b public.operation_batches; r public.ai_scoped_requests; authority jsonb; permission text;
begin
  d:=ai_private.verify_command(p_message,p_mac,'approve_scoped:'||expected_capability);
  perform ai_private.exact_keys(d,array['batch_id']);
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid();
  if not found then raise exception 'ai_untrusted_proposal'; end if;
  r:=ai_private.lock_scoped_request(b.ai_scoped_request_id);
  if r.capability is distinct from expected_capability then raise exception 'ai_capability_denied'; end if;
  select * into b from public.operation_batches where id=b.id for update;
  if b.status<>'proposed' or r.status<>'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,17));
  select permission_mode into permission from public.ai_preferences where user_id=auth.uid();
  if coalesce(permission,'ask_before_changing')<>'ask_before_changing' then raise exception 'ai_permission_denied'; end if;
  authority:=ai_private.assert_scoped_review(b.id);
  if r.expires_at<=clock_timestamp() then raise exception 'ai_request_unavailable'; end if;
  update public.operation_batches set status='confirmed',ai_apply_xid=pg_current_xact_id() where id=b.id;
  return authority;
end $$;

create function ai_private.finish_scoped_apply(batch_id uuid, result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches; r public.ai_scoped_requests; authority jsonb;
begin
  select * into b from public.operation_batches where id=batch_id and user_id=auth.uid() for update;
  if not found or b.status<>'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id() then raise exception 'ai_consumption_unavailable'; end if;
  authority:=ai_private.assert_scoped_review(b.id);
  select * into r from public.ai_scoped_requests where id=b.ai_scoped_request_id;
  if r.status<>'proposed' or r.expires_at<=clock_timestamp() then raise exception 'ai_request_unavailable'; end if;
  perform ai_private.exact_keys(result,array['entity','ids']);
  if jsonb_typeof(result->'ids') is distinct from 'array' or octet_length(result::text)>4096 then raise exception 'ai_invalid_result'; end if;
  if r.capability='noteRewrite.propose' then
    if result->>'entity' is distinct from 'note' or result->'ids' is distinct from jsonb_build_array(r.source_manifest->0->>'id') then raise exception 'ai_invalid_result'; end if;
  elsif r.capability='noteActionItems.propose' then
    if result->>'entity' is distinct from 'task' or jsonb_array_length(result->'ids')<>jsonb_array_length(authority->'proposal'->'actionItems')
      or (select count(distinct id) from public.tasks where user_id=auth.uid() and id in (select value::uuid from jsonb_array_elements_text(result->'ids')))<>jsonb_array_length(result->'ids') then raise exception 'ai_invalid_result'; end if;
  else raise exception 'ai_capability_denied'; end if;
  update public.operation_steps set inverse=jsonb_build_object('result',result,'review_digest',b.ai_review_digest,
    'source_manifest',r.source_manifest,'provider',r.provider,'model',r.model,'evidence','browser_relay','undo_supported',false)
    where operation_steps.batch_id=b.id and position=0;
  update public.operation_batches set status='committed',committed_at=clock_timestamp() where id=b.id;
  update public.ai_scoped_requests set status='applied' where id=r.id;
end $$;

-- A claim cannot escape its transaction: forgetting finish (or failing domain
-- SQL/audit) aborts the whole transaction. No GUC or client-supplied claim token.
create function public.ai_scoped_transaction_complete() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches; request_status text;
begin
  select * into b from public.operation_batches where id=new.id;
  if b.ai_review_digest is null then return null; end if;
  perform ai_private.assert_scoped_review(b.id);
  select status into request_status from public.ai_scoped_requests where id=b.ai_scoped_request_id;
  if b.status='confirmed' or (b.status='committed' and (request_status<>'applied' or not exists(
    select 1 from public.operation_steps s where s.batch_id=b.id and s.inverse->>'review_digest'=b.ai_review_digest
  ))) then raise exception 'ai_incomplete_consumption'; end if;
  return null;
end $$;
create constraint trigger ai_scoped_transaction_complete after insert or update on public.operation_batches
  deferrable initially deferred for each row execute function public.ai_scoped_transaction_complete();

create or replace function public.ai_read_scoped_review(p_batch_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('batchId',b.id,'status',b.status,'input',s.input,
    'proposalDigest',encode(sha256(convert_to(s.input::text,'UTF8')),'hex'),
    'reviewDigest',b.ai_review_digest,'predecessorBatchId',b.ai_predecessor_batch_id,
    'trustVersion',r.trust_version,'sourceManifest',r.source_manifest,'expiresAt',r.expires_at,
    'sourceHandle',r.source_handle,'capability',r.capability,'fileName',r.file_name,
    'startDate',r.start_date,'timeZone',r.time_zone,'provenance',case when r.trust_version=2 then
      jsonb_build_object('provider',r.provider,'model',r.model,'evidence','browser_relay') else public.ai_read_inference_provenance(b.id) end)
  from public.operation_batches b join public.ai_scoped_requests r on r.id=b.ai_scoped_request_id and r.user_id=auth.uid()
    join public.operation_steps s on s.batch_id=b.id and s.user_id=auth.uid() and s.position=0
  where b.id=p_batch_id and b.user_id=auth.uid() and b.source='ai'
$$;

-- All newly introduced private functions and trigger functions are unavailable
-- to authenticated/anonymous RPC clients. Replaced shared RPCs remain revoked.
revoke all on function ai_private.scoped_request_digest(public.ai_scoped_requests),
  ai_private.scoped_review_digest(text,uuid,uuid,jsonb),ai_private.assert_scoped_review(uuid),
  ai_private.lock_scoped_request(uuid),ai_private.insert_scoped_review(public.ai_scoped_requests,jsonb,uuid),
  ai_private.begin_scoped_apply(text,text,text),ai_private.finish_scoped_apply(uuid,jsonb),
  public.ai_scoped_request_immutable(),public.ai_scoped_review_immutable(),public.ai_scoped_step_immutable(),
  public.ai_scoped_transaction_complete(),public.ai_lock_mutation_policy(),public.ai_create_scoped_request(text,text),
  public.ai_record_scoped_proposal(text,text),public.ai_revise_scoped_proposal(text,text)
from public,anon,authenticated;
