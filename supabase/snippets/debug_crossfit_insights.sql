SELECT
  s.notes,
  e.complaints,
  e.scaling_rationale,
  e.milestones
FROM score_notes_extractions e
JOIN scores s ON s.id = e.score_id
WHERE s.user_id = (SELECT id FROM users WHERE email = 'sarah.dorich@gmail.com')
ORDER BY e.extracted_at DESC;
