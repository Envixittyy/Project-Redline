-- Pass 2A: trusted model modality and short-lived normalized-image disclosure.
-- This migration does not grant any School product proposal or Apply authority.

create table public.ai_model_configurations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('ollama','llamacpp','openai_compatible')),
  model text not null,
  supports_text boolean not null default true check (supports_text),
  supports_image boolean not null default false,
  source text not null default 'saved_local_configuration' check (source='saved_local_configuration'),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_configuration_model check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  constraint ai_model_configuration_adapter_image check (not supports_image or provider in ('ollama','openai_compatible')),
  constraint ai_model_configuration_identity unique(user_id,provider,model)
);
create trigger ai_model_configurations_updated before update on public.ai_model_configurations
  for each row execute function public.set_updated_at();
alter table public.ai_model_configurations enable row level security;
create policy ai_model_configurations_select_own on public.ai_model_configurations
  for select to authenticated using ((select auth.uid())=user_id);

create table public.ai_validated_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  capability text not null check (capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose','academicCalendarImport.propose')),
  normalized_mime text not null default 'image/png' check (normalized_mime='image/png'),
  normalized_digest text not null check (normalized_digest ~ '^[a-f0-9]{64}$'),
  normalized_byte_count integer not null check (normalized_byte_count between 1 and 5242880),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  normalized_bytes bytea,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint ai_validated_image_pixels check (width::bigint*height::bigint<=16777216),
  constraint ai_validated_image_authority_complete check (
    (status='active' and normalized_bytes is not null) or status in ('revoked','expired')
  )
);
create index ai_validated_images_owner_expiry on public.ai_validated_images(user_id,expires_at);
alter table public.ai_validated_images enable row level security;

create table public.ai_image_disclosures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_id uuid not null references public.ai_validated_images(id) on delete restrict,
  capability text not null check (capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose','academicCalendarImport.propose')),
  provider text not null check (provider in ('ollama','llamacpp','openai_compatible','gemini','openrouter')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  location text not null check (location in ('local','remote_local','cloud')),
  modality text not null default 'vision' check (modality='vision'),
  modality_source text not null check (modality_source in ('saved_local_configuration','server_cloud_configuration')),
  model_configuration_id uuid references public.ai_model_configurations(id) on delete restrict,
  image_digest text not null check (image_digest ~ '^[a-f0-9]{64}$'),
  image_byte_count integer not null check (image_byte_count between 1 and 5242880),
  disclosure_fields text[] not null default array['normalized_image']::text[]
    check (disclosure_fields=array['normalized_image']::text[]),
  status text not null check (status in ('prepared','awaiting_consent','consented','dispatching','succeeded','failed','cancelled')),
  consented_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint ai_image_disclosure_route check (
    (location in ('local','remote_local') and provider in ('ollama','openai_compatible') and modality_source='saved_local_configuration' and model_configuration_id is not null)
    or (location='cloud' and provider in ('gemini','openrouter') and modality_source='server_cloud_configuration' and model_configuration_id is null)
  )
);
create index ai_image_disclosures_owner_status on public.ai_image_disclosures(user_id,status,created_at desc);
alter table public.ai_image_disclosures enable row level security;

create function public.ai_save_local_model_configuration(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; saved uuid;
begin
  d:=ai_private.verify_command(p_message,p_mac,'save_local_model_configuration');
  perform ai_private.exact_keys(d,array['provider','model','supports_image']);
  if jsonb_typeof(d->'provider') is distinct from 'string' or d->>'provider' not in ('ollama','llamacpp','openai_compatible')
    or jsonb_typeof(d->'model') is distinct from 'string' or d->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    or jsonb_typeof(d->'supports_image') is distinct from 'boolean'
    or ((d->>'supports_image')::boolean and d->>'provider'='llamacpp') then raise exception 'ai_invalid_model_configuration'; end if;
  insert into public.ai_model_configurations(user_id,provider,model,supports_image,status)
    values(auth.uid(),d->>'provider',d->>'model',(d->>'supports_image')::boolean,'active')
    on conflict(user_id,provider,model) do update set supports_image=excluded.supports_image,status='active'
    returning id into saved;
  return saved;
end $$;

create function public.ai_create_validated_image(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; raw bytea; image_id uuid:=gen_random_uuid();
begin
  d:=ai_private.verify_command(p_message,p_mac,'create_validated_image');
  perform ai_private.exact_keys(d,array['capability','normalized_base64','normalized_digest','normalized_byte_count','width','height']);
  if jsonb_typeof(d->'capability') is distinct from 'string' or d->>'capability' not in ('schoolScheduleImage.propose','blackboardCourseImage.propose','academicCalendarImport.propose')
    or jsonb_typeof(d->'normalized_base64') is distinct from 'string' or char_length(d->>'normalized_base64')>6990508
    or jsonb_typeof(d->'normalized_digest') is distinct from 'string' or d->>'normalized_digest' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(d->'normalized_byte_count') is distinct from 'number' or jsonb_typeof(d->'width') is distinct from 'number'
    or jsonb_typeof(d->'height') is distinct from 'number' then raise exception 'ai_invalid_image'; end if;
  begin raw:=decode(d->>'normalized_base64','base64'); exception when others then raise exception 'ai_invalid_image'; end;
  if octet_length(raw)<>(d->>'normalized_byte_count')::integer or octet_length(raw) not between 1 and 5242880
    or (d->>'width')::integer not between 1 and 8192 or (d->>'height')::integer not between 1 and 8192
    or (d->>'width')::bigint*(d->>'height')::bigint>16777216
    or substring(raw from 1 for 8)<>decode('89504e470d0a1a0a','hex')
    or encode(sha256(raw),'hex')<>d->>'normalized_digest' then raise exception 'ai_invalid_image'; end if;
  insert into public.ai_validated_images(id,user_id,capability,normalized_digest,normalized_byte_count,width,height,normalized_bytes,expires_at)
    values(image_id,auth.uid(),d->>'capability',d->>'normalized_digest',(d->>'normalized_byte_count')::integer,
      (d->>'width')::integer,(d->>'height')::integer,raw,clock_timestamp()+interval '5 minutes');
  return image_id;
end $$;

create function ai_private.image_cloud_allowed(p_capability text) returns boolean
language sql security definer set search_path='' as $$
  select coalesce((select cloud_enabled and cloud_fallback_mode='ask_each_time' and case p_capability
    when 'schoolScheduleImage.propose' then school_schedule_cloud
    when 'blackboardCourseImage.propose' then blackboard_course_cloud
    when 'academicCalendarImport.propose' then academic_calendar_cloud else false end
    from public.ai_preferences where user_id=auth.uid()),false)
$$;

create function public.ai_prepare_image_disclosure(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; img public.ai_validated_images; cfg public.ai_model_configurations; disclosure_id uuid:=gen_random_uuid(); initial_status text;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_image_disclosure');
  perform ai_private.exact_keys(d,array['image_id','capability','provider','model','location','modality_source']);
  select * into img from public.ai_validated_images where id=(d->>'image_id')::uuid and user_id=auth.uid() for update;
  if not found or img.status<>'active' or img.expires_at<=clock_timestamp() or img.capability is distinct from d->>'capability'
    or encode(sha256(img.normalized_bytes),'hex') is distinct from img.normalized_digest then raise exception 'ai_image_unavailable'; end if;
  if d->>'location' in ('local','remote_local') then
    if d->>'provider' not in ('ollama','openai_compatible') or d->>'modality_source'<>'saved_local_configuration' then raise exception 'unsupported_modality'; end if;
    select * into cfg from public.ai_model_configurations where user_id=auth.uid() and provider=d->>'provider' and model=d->>'model'
      and status='active' and supports_text and supports_image for update;
    if not found then raise exception 'unsupported_modality'; end if;
    initial_status:='prepared';
  elsif d->>'location'='cloud' then
    if d->>'provider' not in ('gemini','openrouter') or d->>'modality_source'<>'server_cloud_configuration'
      or not ai_private.image_cloud_allowed(d->>'capability') then raise exception 'ai_cloud_privacy_denied'; end if;
    initial_status:='awaiting_consent';
  else raise exception 'ai_invalid_provider'; end if;
  insert into public.ai_image_disclosures(id,user_id,image_id,capability,provider,model,location,modality_source,model_configuration_id,
      image_digest,image_byte_count,status,expires_at)
    values(disclosure_id,auth.uid(),img.id,img.capability,d->>'provider',d->>'model',d->>'location',d->>'modality_source',cfg.id,
      img.normalized_digest,img.normalized_byte_count,initial_status,least(img.expires_at,clock_timestamp()+interval '5 minutes'));
  return disclosure_id;
end $$;

create function public.ai_consent_image_disclosure(p_message text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'consent_image_disclosure');
  perform ai_private.exact_keys(d,array['disclosure_id']);
  update public.ai_image_disclosures set status='consented',consented_at=clock_timestamp()
    where id=(d->>'disclosure_id')::uuid and user_id=auth.uid() and location='cloud' and status='awaiting_consent'
      and expires_at>clock_timestamp() and ai_private.image_cloud_allowed(capability);
  if not found then raise exception 'ai_disclosure_unavailable'; end if;
end $$;

create function public.ai_claim_image_disclosure(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; x public.ai_image_disclosures; img public.ai_validated_images;
begin
  d:=ai_private.verify_command(p_message,p_mac,'claim_image_disclosure');
  perform ai_private.exact_keys(d,array['disclosure_id']);
  select * into x from public.ai_image_disclosures where id=(d->>'disclosure_id')::uuid and user_id=auth.uid() for update;
  select * into img from public.ai_validated_images where id=x.image_id and user_id=auth.uid() for update;
  if not found or x.expires_at<=clock_timestamp() or img.status<>'active' or img.expires_at<=clock_timestamp()
    or x.capability<>img.capability or x.image_digest<>img.normalized_digest or x.image_byte_count<>img.normalized_byte_count
    or encode(sha256(img.normalized_bytes),'hex')<>img.normalized_digest then raise exception 'ai_disclosure_unavailable'; end if;
  if x.location='cloud' then
    if x.status<>'consented' or not ai_private.image_cloud_allowed(x.capability) then raise exception 'ai_cloud_privacy_denied'; end if;
  else
    if x.status<>'prepared' or not exists(select 1 from public.ai_model_configurations c where c.id=x.model_configuration_id
      and c.user_id=auth.uid() and c.provider=x.provider and c.model=x.model and c.status='active' and c.supports_image) then raise exception 'unsupported_modality'; end if;
  end if;
  update public.ai_image_disclosures set status='dispatching',claimed_at=clock_timestamp() where id=x.id;
  return jsonb_build_object('disclosureId',x.id,'capability',x.capability,'provider',x.provider,'model',x.model,'location',x.location,
    'disclosureFields',to_jsonb(x.disclosure_fields),
    'mimeType',img.normalized_mime,'base64',replace(encode(img.normalized_bytes,'base64'),chr(10),''),'digest',img.normalized_digest,
    'byteCount',img.normalized_byte_count,'width',img.width,'height',img.height,'expiresAt',x.expires_at);
end $$;

create function public.ai_finish_image_disclosure(p_message text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'finish_image_disclosure');
  perform ai_private.exact_keys(d,array['disclosure_id','status']);
  if d->>'status' not in ('succeeded','failed') then raise exception 'ai_invalid_status'; end if;
  update public.ai_image_disclosures set status=d->>'status',completed_at=clock_timestamp()
    where id=(d->>'disclosure_id')::uuid and user_id=auth.uid() and status='dispatching';
  if not found then raise exception 'ai_disclosure_unavailable'; end if;
end $$;

create function public.ai_revoke_validated_image(p_message text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'revoke_validated_image');
  perform ai_private.exact_keys(d,array['image_id']);
  update public.ai_validated_images set status='revoked',normalized_bytes=null where id=(d->>'image_id')::uuid and user_id=auth.uid() and status='active';
  update public.ai_image_disclosures set status='cancelled' where image_id=(d->>'image_id')::uuid and user_id=auth.uid()
    and status in ('prepared','awaiting_consent','consented');
end $$;

create function public.ai_purge_my_expired_images() returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  update public.ai_validated_images set status='expired',normalized_bytes=null
    where user_id=auth.uid() and expires_at<=clock_timestamp() and status='active';
  get diagnostics affected=row_count;
  return affected;
end $$;

revoke all on table public.ai_model_configurations,public.ai_validated_images,public.ai_image_disclosures from public,anon,authenticated;
grant select on table public.ai_model_configurations to authenticated;
revoke all on function ai_private.image_cloud_allowed(text),public.ai_save_local_model_configuration(text,text),
  public.ai_create_validated_image(text,text),public.ai_prepare_image_disclosure(text,text),public.ai_consent_image_disclosure(text,text),
  public.ai_claim_image_disclosure(text,text),public.ai_finish_image_disclosure(text,text),public.ai_revoke_validated_image(text,text),
  public.ai_purge_my_expired_images() from public,anon,authenticated;
grant execute on function public.ai_save_local_model_configuration(text,text),public.ai_create_validated_image(text,text),
  public.ai_prepare_image_disclosure(text,text),public.ai_consent_image_disclosure(text,text),public.ai_claim_image_disclosure(text,text),
  public.ai_finish_image_disclosure(text,text),public.ai_revoke_validated_image(text,text),public.ai_purge_my_expired_images() to authenticated;
