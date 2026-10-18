-- Sending the next-day plan showed it twice on a crew member's device: once as the "Plan for ..." card in the
-- app and again as a browser push with the same text. The card stays; the push for it is no longer queued.
-- Automatic safety alerts and forecast warnings still send pushes.
create or replace function public.send_briefing(p_site_id uuid,p_for_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.briefing_drafts;
begin
  if not private.is_site_supervisor(p_site_id) then raise exception 'Supervisor role required' using errcode='42501'; end if;
  select * into d from public.briefing_drafts where site_id=p_site_id and for_date=p_for_date for update;
  if not found or d.status='generating' then raise exception 'Draft is not ready' using errcode='P0002'; end if;
  if d.status='sent' then return jsonb_build_object('ok',true,'already_sent',true); end if;
  update public.briefing_drafts set status='sent',sent_at=now(),updated_by=auth.uid(),updated_at=now()
  where site_id=p_site_id and for_date=p_for_date;
  return jsonb_build_object('ok',true);
end; $$;
