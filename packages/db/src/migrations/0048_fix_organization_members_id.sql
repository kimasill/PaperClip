DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization_members' AND column_name = 'id'
  ) THEN
    ALTER TABLE "organization_members" ADD COLUMN "id" uuid DEFAULT gen_random_uuid();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'organization_members' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE "organization_members" ADD PRIMARY KEY ("id");
  END IF;
END $$;

