-- A repeated user rejection is a terminal no-op for the same owned review.
-- Any other state or mismatched request remains fail-closed.
create or replace function public.ai_reject_scoped_proposal(p_message text, p_mac text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
  b public.operation_batches%rowtype;
  r public.ai_scoped_requests%rowtype;
begin
  d := ai_private.verify_command(p_message, p_mac, 'reject_scoped_proposal');

  select * into b
    from public.operation_batches
    where id = (d->>'batch_id')::uuid and user_id = auth.uid()
    for update;

  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then
    raise exception 'ai_proposal_unavailable';
  end if;

  select * into r
    from public.ai_scoped_requests
    where id = b.ai_scoped_request_id and user_id = auth.uid()
    for update;

  if not found then
    raise exception 'ai_proposal_unavailable';
  end if;

  if b.status = 'rejected' and r.status = 'rejected' then
    return;
  end if;

  if b.status <> 'proposed' or r.status <> 'proposed' then
    raise exception 'ai_proposal_unavailable';
  end if;

  update public.operation_batches
    set status = 'rejected'
    where id = b.id;

  update public.ai_scoped_requests
    set status = 'rejected'
    where id = r.id;
end
$$;

revoke all on function public.ai_reject_scoped_proposal(text,text) from public, anon;
grant execute on function public.ai_reject_scoped_proposal(text,text) to authenticated;
