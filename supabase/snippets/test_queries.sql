
select * from hyrox_station_assessments;

select * from hyrox_training_plans;

select * from hyrox_profiles;

select * from auth.users;

UPDATE hyrox_training_plans
SET generation_status = 'failed', status = 'archived'
WHERE generation_status IN ('pending', 'generating');


