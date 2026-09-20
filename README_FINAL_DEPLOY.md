# LeJapon.ma – final migration patch

These 5 migration files match migrations already applied to `lejapon-prod`
(project ref `nkovgpzspprmmhorwaxl`).

Unzip this archive at the root of the LeJapon.ma repository. The files will be
placed under `supabase/migrations/`.

Do **not** run `db push` blindly. First compare local and remote migration
history:

```bash
npx --yes supabase@latest migration list
```

The five versions below should appear on both Local and Remote:

- 20260920113349
- 20260920113727
- 20260920113905
- 20260920114136
- 20260920182603

The visa-reminder cron is intentionally NOT included/enabled yet.
