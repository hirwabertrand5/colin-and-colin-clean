# Audit retention

The audit store retains at most twenty entries per staff member across all matters. Identified actors are grouped by user ID. Legacy name-only entries are linked to that ID only when their name matches unambiguously. System actors retain twenty entries per distinct normalized actor name.

Records are ranked by `createdAt` descending, then `_id` descending for deterministic ties. Save, create and insertMany hooks remove older records. Transactional inserts prune inside the same transaction, so rollback restores deleted records. Startup also reconciles legacy identities and removes excess entries.

Audit feeds, personal activity trails and matter audit tables return no more than twenty entries. A date filter applies only to retained history. Business records, assignment histories and financial snapshots use their own data stores.

- Preview existing records: `npm.cmd --prefix colin-backend run audit:retention`
- Apply deletion: `npm.cmd --prefix colin-backend run audit:retention -- --apply`
- Isolated regression: `npm.cmd --prefix colin-backend run verify:audit-trail`

The cleanup streams small record projections through the `_id` index and holds only twenty candidates per actor in memory. It does not require a database-wide sort or load audit messages/details into memory.

Existing records were cleaned on 18 November 2026 under the user's explicit latest-twenty-per-staff instruction. Verification returned 388 retained audit entries and zero actor groups over the limit. The new application code must be deployed to enforce retention on future writes in hosted environments.
