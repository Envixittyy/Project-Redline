-- Phase 4D independent-review hardening: owner-consistent notification links,
-- atomic Web Push claims and terminal handling of ambiguous send attempts.

alter table public.notification_deliveries
  drop constraint notification_delivery_status;

alter table public.notification_deliveries
  add column claimed_at timestamptz,
  add constraint notification_delivery_status
    check (status in ('pending','deferred','sending','sent','failed','unavailable'));

create index notification_deliveries_push_dispatch_idx
  on public.notification_deliveries (user_id, status, claimed_at, created_at)
  where channel = 'web_push' and status in ('pending', 'sending');

do $$
begin
  if exists (
    select 1
    from public.push_subscriptions s
    left join public.devices d on d.id = s.device_id
    where d.id is null or d.user_id <> s.user_id
  ) or exists (
    select 1
    from public.notification_preferences p
    left join public.courses c on c.id = p.course_id
    where p.course_id is not null and (c.id is null or c.user_id <> p.user_id)
  ) or exists (
    select 1
    from public.notification_events n
    left join public.courses c on c.id = n.course_id
    where n.course_id is not null and (c.id is null or c.user_id <> n.user_id)
  ) or exists (
    select 1
    from public.notification_deliveries d
    left join public.notification_events n on n.id = d.notification_event_id
    left join public.push_subscriptions s on s.id = d.push_subscription_id
    where n.id is null
       or n.user_id <> d.user_id
       or (d.push_subscription_id is not null and (s.id is null or s.user_id <> d.user_id))
  ) then
    raise exception 'existing notification relationship owner mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_notification_relationship_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'push_subscriptions' then
    if not exists (
      select 1 from public.devices d
      where d.id = new.device_id and d.user_id = new.user_id
    ) then
      raise exception 'push subscription device owner mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'notification_preferences' then
    if new.course_id is not null and not exists (
      select 1 from public.courses c
      where c.id = new.course_id and c.user_id = new.user_id
    ) then
      raise exception 'notification preference course owner mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'notification_events' then
    if new.course_id is not null and not exists (
      select 1 from public.courses c
      where c.id = new.course_id and c.user_id = new.user_id
    ) then
      raise exception 'notification event course owner mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'notification_deliveries' then
    if not exists (
      select 1 from public.notification_events e
      where e.id = new.notification_event_id and e.user_id = new.user_id
    ) then
      raise exception 'notification delivery event owner mismatch' using errcode = '23514';
    end if;

    if new.push_subscription_id is not null and not exists (
      select 1 from public.push_subscriptions s
      where s.id = new.push_subscription_id and s.user_id = new.user_id
    ) then
      raise exception 'notification delivery subscription owner mismatch' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger push_subscriptions_owner_guard
  before insert or update on public.push_subscriptions
  for each row execute function public.enforce_notification_relationship_owner();

create trigger notification_preferences_owner_guard
  before insert or update on public.notification_preferences
  for each row execute function public.enforce_notification_relationship_owner();

create trigger notification_events_owner_guard
  before insert or update on public.notification_events
  for each row execute function public.enforce_notification_relationship_owner();

create trigger notification_deliveries_owner_guard
  before insert or update on public.notification_deliveries
  for each row execute function public.enforce_notification_relationship_owner();
