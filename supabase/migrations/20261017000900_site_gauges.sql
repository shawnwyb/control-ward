-- Nearest USGS stream gauge per site: used for river distance and the flood rule.
alter table public.sites add column usgs_gauge_id text;
alter table public.sites add column usgs_gauge_distance_m integer check (usgs_gauge_distance_m >= 0);
