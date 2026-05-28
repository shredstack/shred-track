-- Counts: every score still has a session FK
select count(*) as total_scores,
       count(workout_session_id) as scores_with_session,
       count(*) filter (where workout_part_id is not null) as had_part,
       count(*) filter (where workout_part_id is not null
                          and crossfit_workout_part_id is null) as lost_part_fk
from scores;
-- expect: total = scores_with_session, lost_part_fk = 0

-- Templates by scope
select
  case
    when is_system then 'system'
    when community_id is not null then 'community'
    when created_by is not null then 'personal'
  end as scope,
  is_benchmark,
  count(*)
from crossfit_workouts
group by 1, 2 order by 1, 2;

--select * from crossfit_workouts;

select category, count(*), string_agg(title, ', ' order by title) as names
from crossfit_workouts
where is_system = true
group by category
order by category;

-- Every template, with full provenance
select
  cw.title,
  cw.is_benchmark,
  cw.is_system,
  cw.workout_type,
  cw.created_at,
  case
    when cw.is_system then 'system'
    when cw.community_id is not null then 'community: ' || c.name
    when cw.created_by is not null then 'personal: ' || u.email
    else 'orphan?'
  end as scope_detail,
  (select count(*) from workout_sessions ws where ws.crossfit_workout_id = cw.id) as sessions
from crossfit_workouts cw
left join users u on u.id = cw.created_by
left join communities c on c.id = cw.community_id
order by cw.is_system desc, cw.is_benchmark desc, cw.created_at;

-- Every session, what kind of template it points at
select
  ws.workout_date,
  ws.kind,
  ws.position,
  case when ws.user_id is not null then 'personal' else 'gym: ' || c.name end as session_scope,
  case
    when ws.crossfit_workout_id is null then 'FREEFORM (' || ws.kind || ')'
    when cw.is_system then 'system benchmark: ' || cw.title
    when cw.is_benchmark then 'custom benchmark: ' || cw.title
    else 'smart-builder: ' || cw.title
  end as content
from workout_sessions ws
left join crossfit_workouts cw on cw.id = ws.crossfit_workout_id
left join communities c on c.id = ws.community_id
order by ws.workout_date desc, ws.position;

select
  coalesce(category, '(none — Smart Builder)') as category,
  is_benchmark,
  count(*)
from crossfit_workouts
group by 1, 2
order by 1, 2;

-- Sessions per workout date — should look like your existing /crossfit feed
select workout_date, count(*) filter (where user_id is not null) as personal,
                     count(*) filter (where community_id is not null) as gym
from workout_sessions
group by 1 order by 1 desc limit 10;

-- Fingerprint dedup actually fired: groups with >1 session per template
select cw.title, count(ws.id) as session_count
from crossfit_workouts cw
join workout_sessions ws on ws.crossfit_workout_id = cw.id
where cw.is_benchmark = false
group by cw.id, cw.title
having count(ws.id) > 1
order by session_count desc limit 20;
