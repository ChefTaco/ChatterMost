CREATE FUNCTION erase_users() RETURNS void
LANGUAGE plpgsql
AS $body$
BEGIN
  DELETE FROM "User";
END
$body$;
