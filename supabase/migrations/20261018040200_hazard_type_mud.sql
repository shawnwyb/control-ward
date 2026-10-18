-- New crew hazard type: mud, a rutted road, or a stuck vehicle. The next-day report compares these reports with the
-- mud model's flagged routes (reports/next-day, run.sh calibrate-mud). The enum value is added at the end.
-- submit_hazard_report and the feeds take the enum as given, so no function changes are needed.
alter type public.hazard_type add value if not exists 'mud';
