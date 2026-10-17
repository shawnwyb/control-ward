-- Rolled-back assertions for crew assignment.
-- Run: npm run verify:crew-assignment (expects an error reading "ALL CREW ASSIGNMENT CHECKS PASSED").
do $$
declare
  site_a constant uuid:='99999999-9999-4999-8999-ccccccccccc1'; site_b constant uuid:='99999999-9999-4999-8999-ccccccccccc2';
  sup constant uuid:='99999999-9999-4999-8999-ddddddddddd1'; crew constant uuid:='99999999-9999-4999-8999-ddddddddddd2';
  newbie constant uuid:='99999999-9999-4999-8999-ddddddddddd3'; other_sup constant uuid:='99999999-9999-4999-8999-ddddddddddd4';
  r jsonb; n integer; msg text; denied boolean;
begin
  insert into auth.users(id,instance_id,aud,role,email) values
    (sup,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sup@assign.local'),
    (crew,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crew@assign.local'),
    (newbie,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','New.Person@assign.local'),
    (other_sup,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-sup@assign.local');
  insert into public.sites(id,name,latitude,longitude) values (site_a,'assign A',29.6,-82.3),(site_b,'assign B',29.7,-82.4);
  insert into public.site_memberships(site_id,user_id,role) values
    (site_a,sup,'supervisor'),(site_a,crew,'crew'),(site_b,other_sup,'supervisor');
  insert into public.crew_locations(user_id,site_id,location) values
    (crew,site_a,extensions.st_setsrid(extensions.st_makepoint(-82.3,29.6),4326)::extensions.geography);

  set local role authenticated;

  -- A supervisor sees the roster, supervisors first.
  perform set_config('request.jwt.claims',json_build_object('sub',sup,'role','authenticated')::text,true);
  select count(*) into n from public.list_site_crew(site_a);
  assert n=2, 'roster has two members';
  assert (select role from public.list_site_crew(site_a) limit 1)='supervisor', 'supervisors are listed first';

  -- Adding is case-insensitive and ignores surrounding spaces.
  r:=public.assign_site_member(site_a,'  new.PERSON@assign.local ');
  assert r->>'outcome'='assigned' and r->>'role'='crew', 'new crew member assigned: '||r;
  assert (r->>'email')='New.Person@assign.local', 'the stored email is returned';
  -- Repeating it changes nothing.
  r:=public.assign_site_member(site_a,'new.person@assign.local');
  assert r->>'outcome'='already_member', 'second add is a no-op: '||r;
  -- It never changes an existing role: adding a supervisor leaves them a supervisor.
  r:=public.assign_site_member(site_a,'sup@assign.local');
  assert r->>'outcome'='already_member' and r->>'role'='supervisor', 'a supervisor is not demoted: '||r;

  -- Bad input.
  denied:=false; begin perform public.assign_site_member(site_a,'nobody@assign.local');
  exception when sqlstate '22023' then denied:=true; end; assert denied,'unknown email is rejected';
  denied:=false; begin perform public.assign_site_member(site_a,'   ');
  exception when sqlstate '22023' then denied:=true; end; assert denied,'blank email is rejected';

  -- Removing crew works once; repeating is a no-op.
  r:=public.unassign_site_member(site_a,crew);
  assert (r->>'removed')::boolean, 'crew member removed';
  select count(*) into n from public.site_memberships where site_id=site_a and user_id=crew;
  assert n=0, 'membership row is gone';
  reset role; select count(*) into n from public.crew_locations where user_id=crew and site_id=site_a;
  assert n=0, 'their location for that site is deleted';
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',sup,'role','authenticated')::text,true);
  r:=public.unassign_site_member(site_a,crew);
  assert not (r->>'removed')::boolean, 'second removal is a no-op';

  -- Supervisors cannot be removed, including by themselves.
  denied:=false; begin perform public.unassign_site_member(site_a,sup);
  exception when sqlstate '42501' then denied:=true; end; assert denied,'a supervisor cannot be removed';

  -- A supervisor of another site has no power here.
  perform set_config('request.jwt.claims',json_build_object('sub',other_sup,'role','authenticated')::text,true);
  denied:=false; begin perform public.list_site_crew(site_a);
  exception when sqlstate '42501' then denied:=true; end; assert denied,'other site: list denied';
  denied:=false; begin perform public.assign_site_member(site_a,'crew@assign.local');
  exception when sqlstate '42501' then denied:=true; end; assert denied,'other site: assign denied';
  denied:=false; begin perform public.unassign_site_member(site_a,newbie);
  exception when sqlstate '42501' then denied:=true; end; assert denied,'other site: unassign denied';

  -- Crew cannot manage rosters at all, not even their own site's.
  perform set_config('request.jwt.claims',json_build_object('sub',newbie,'role','authenticated')::text,true);
  denied:=false; begin perform public.list_site_crew(site_a);
  exception when sqlstate '42501' then denied:=true; end; assert denied,'crew: list denied';
  denied:=false; begin perform public.assign_site_member(site_a,'sup@assign.local');
  exception when sqlstate '42501' then denied:=true; end; assert denied,'crew: assign denied';
  denied:=false; begin perform public.unassign_site_member(site_a,newbie);
  exception when sqlstate '42501' then denied:=true; end; assert denied,'crew: unassign denied';

  -- Signed out.
  perform set_config('request.jwt.claims','{}',true);
  denied:=false; begin perform public.list_site_crew(site_a);
  exception when sqlstate '42501' then denied:=true; end; assert denied,'anonymous: list denied';

  reset role;
  raise exception 'ALL CREW ASSIGNMENT CHECKS PASSED';
end $$;
