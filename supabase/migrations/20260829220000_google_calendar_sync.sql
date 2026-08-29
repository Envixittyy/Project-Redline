-- P3 Google Calendar synchronization. Refresh-token rotation is guarded by
-- an owner-scoped, short-lived database lease so concurrent requests cannot
-- overwrite each other's encrypted credential envelope.

create function public.claim_google_calendar_refresh(
  target_account_id uuid,
  new_lock_until timestamptz
)
returns table (encrypted_credential text, token_expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new_lock_until is null
    or new_lock_until <= now()
    or new_lock_until > now() + interval '2 minutes'
  then
    raise exception 'invalid refresh lease' using errcode = '22023';
  end if;

  return query
  update public.external_calendar_accounts account
  set refresh_lock_until = new_lock_until
  where account.id = target_account_id
    and account.user_id = (select auth.uid())
    and account.provider = 'google'
    and account.status = 'connected'
    and account.encrypted_credential is not null
    and (account.refresh_lock_until is null or account.refresh_lock_until < now())
  returning account.encrypted_credential, account.token_expires_at;
end;
$$;

create function public.finish_google_calendar_refresh(
  target_account_id uuid,
  expected_lock_until timestamptz,
  new_encrypted_credential text,
  new_token_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if expected_lock_until is null
    or new_encrypted_credential is null
    or btrim(new_encrypted_credential) = ''
    or new_token_expires_at is null
    or new_token_expires_at <= now()
  then
    raise exception 'invalid refreshed credential' using errcode = '22023';
  end if;

  update public.external_calendar_accounts account
  set encrypted_credential = new_encrypted_credential,
      token_expires_at = new_token_expires_at,
      refresh_lock_until = null,
      status = 'connected',
      last_error_code = null
  where account.id = target_account_id
    and account.user_id = (select auth.uid())
    and account.provider = 'google'
    and account.refresh_lock_until = expected_lock_until
    and account.refresh_lock_until >= now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create function public.fail_google_calendar_refresh(
  target_account_id uuid,
  expected_lock_until timestamptz,
  safe_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.external_calendar_accounts account
  set refresh_lock_until = null,
      status = 'error',
      last_error_code = left(coalesce(nullif(btrim(safe_error_code), ''), 'google_refresh_failed'), 80)
  where account.id = target_account_id
    and account.user_id = (select auth.uid())
    and account.provider = 'google'
    and account.refresh_lock_until = expected_lock_until;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.claim_google_calendar_refresh(uuid, timestamptz) from public;
revoke all on function public.finish_google_calendar_refresh(uuid, timestamptz, text, timestamptz) from public;
revoke all on function public.fail_google_calendar_refresh(uuid, timestamptz, text) from public;
grant execute on function public.claim_google_calendar_refresh(uuid, timestamptz) to authenticated;
grant execute on function public.finish_google_calendar_refresh(uuid, timestamptz, text, timestamptz) to authenticated;
grant execute on function public.fail_google_calendar_refresh(uuid, timestamptz, text) to authenticated;
