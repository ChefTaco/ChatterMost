ALTER TABLE "User"
  ADD CONSTRAINT "User_username_nonempty" CHECK ("username" <> '');
