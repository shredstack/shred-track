SELECT 
  e.name AS event, 
  r.division_key, 
  r.division_rank, 
  r.finish_time_seconds, 
  r.athlete_names_normalized AS names,
  r.age_group,
  to_char(make_interval(secs => r.finish_time_seconds), 'HH24:MI:SS') AS finish,
  array_to_string(r.athlete_names_normalized, ' | ') AS names_to_string,
  s.segment_order AS ord, s.segment_label AS segment,
  to_char(make_interval(secs => s.time_seconds), 'HH24:MI:SS') AS split
FROM hyrox_public_results r 
JOIN hyrox_public_events e 
  ON e.id=r.event_id
LEFT JOIN hyrox_public_splits s 
  ON s.result_id = r.id
WHERE r.athlete_names_normalized is not null 
  --and e.external_id = '2026_LAS_VEGAS'
  --and r.division_key = 'relay_mixed'
  and array_to_string(r.athlete_names_normalized, ' | ') ILIKE '%dorich%'
ORDER BY e.event_date DESC LIMIT 20;

SELECT distinct r.division_key
FROM hyrox_public_results r 
JOIN hyrox_public_events e 
  ON e.id=r.event_id
WHERE r.athlete_names_normalized is not null 
  and e.external_id = '2026_LAS_VEGAS';


SELECT 
  e.name AS event, 
  r.division_key, 
  r.division_rank, 
  r.finish_time_seconds, 
  r.athlete_names_normalized AS names
FROM hyrox_public_results r 
JOIN hyrox_public_events e 
  ON e.id=r.event_id
WHERE r.athlete_names_normalized is not null 
  and e.external_id = '2026_LAS_VEGAS'
  --and r.division_key = 'women_open'
  and array_to_string(r.athlete_names_normalized, ' | ') ILIKE '%dorich%'
ORDER BY e.event_date DESC LIMIT 20;