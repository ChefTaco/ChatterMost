WITH changed AS (
  UPDATE "User" SET "roles" = 'system_admin'
  RETURNING "id"
)
SELECT "id" FROM changed;
