SELECT * FROM view_users as a(a);

-- WITH a(username) AS (
--   WITH b(username1, id2, user_id3, date4) AS (
--     SELECT * FROM view_users
--   )
--   SELECT username1, id2 AS id, user_id3 as user_id, date4 as date FROM b
-- )
-- SELECT * FROM a
-- ;