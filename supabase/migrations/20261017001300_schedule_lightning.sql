-- Lightning is polled every minute from NOAA GOES GLM (LIGHTNING_SOURCE=glm). The 30:00 sweep already runs every minute.
select cron.schedule('invoke-ingest-lightning','* * * * *',$$select private.invoke_function('ingest-lightning')$$);
