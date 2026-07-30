# Seeders

Modular, idempotent (upsert-based) database seeders. Each file seeds one entity
and can run on its own — it fetches its prerequisites from the DB by stable keys
(org code `SUNRISE001`, user emails, fixed plan/role/venue ids).

## Run everything (ordered)
```bash
npm run seed        # node prisma/seeders/index.js
```

## Run one seeder standalone
```bash
node prisma/seeders/plans.seed.js
node prisma/seeders/vehicles.seed.js
# ...etc
```
Note: a standalone seeder assumes its prerequisites already exist (e.g.
`participants.seed.js` needs guardians). Run `npm run seed` for a fresh DB.

## Order / dependencies
1. plans
2. superAdmin
3. organization (needs plan + superAdmin) → also creates the subscription
4. staffRoles (needs org)
5. staff (needs org + roles) → creates NPO admin + coordinator + staff
6. guardians (needs org)
7. participants (needs guardians)
8. vehicles / venues / services (need org)
9. operations (needs the above) → booking, assignment, slot, availability, incident

All passwords: `123456`. Org login = its NPO_ADMIN (`admin@gmail.com`).
`npm run seed:full` still runs the older single-file seeder.
