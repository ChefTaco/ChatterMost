WITH removed AS (
  DELETE FROM "User"
  RETURNING "id"
)
SELECT "id" FROM removed;
