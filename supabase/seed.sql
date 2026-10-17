-- Local demo identities only. Never apply demo seed data to a hosted production project.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,
  extensions.crypt('CrewDemo123!',extensions.gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('name',name),now(),now(),'','','',''
from (values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,'crew@planit.local','Alex · North crew'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,'other@planit.local','Jordan · South crew'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,'supervisor@planit.local','Sam · Supervisor'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,'outsider@planit.local','Unassigned user')
) as users(id,email,name);
insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
select gen_random_uuid(),id,id::text,jsonb_build_object('sub',id::text,'email',email,'email_verified',true),
  'email',now(),now(),now() from auth.users where email like '%@planit.local';

insert into public.sites(id,name,latitude,longitude) values
  ('11111111-1111-4111-8111-111111111111','North Plant · Demo',29.652,-82.325),
  ('22222222-2222-4222-8222-222222222222','South Plant · Demo',29.65245,-82.325);
insert into public.site_memberships(site_id,user_id,role) values
  ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','crew'),
  ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','crew'),
  ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','supervisor'),
  ('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','supervisor');

insert into public.hazard_reports(id,site_id,reporter_id,type,severity,status,location,created_at,last_confirmed_at,resolved_at,resolution_reason)
select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  '11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (array['debris','wildlife','downed_line','washout','other']::public.hazard_type[])[1+((i-1)%5)],
  (1+((i-1)%3))::smallint,case when i<=8 then 'open' else 'resolved' end::public.hazard_status,
  extensions.st_setsrid(extensions.st_makepoint(-82.325+0.0015*((i-1)%4)-0.002,29.652+0.0015*((i-1)/4)-0.001),4326)::extensions.geography,
  now()-i*interval '2 hours',now()-i*interval '2 hours',
  case when i>8 then now()-interval '1 hour' end,case when i>8 then 'crew' end
from generate_series(1,12) as i;
insert into public.hazard_observations(report_id,actor_id,action,location,severity,created_at)
select id,reporter_id,'submitted',location,severity,created_at from public.hazard_reports;
insert into public.hazard_observations(report_id,actor_id,action,location,severity,created_at)
select id,reporter_id,'resolved',location,severity,resolved_at from public.hazard_reports where status='resolved';
insert into public.hazard_events(report_id,observation_id,action,created_at)
select report_id,id,action,created_at from public.hazard_observations;
select public.run_hazard_maintenance();
