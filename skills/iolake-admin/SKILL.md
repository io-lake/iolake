---
name: iolake-admin
description: Administer a running IOLake cluster (S3-compatible object storage) with the iolakectl CLI -- tenants and tenant admins, IAM users, access keys, groups, policies, roles, OIDC providers and STS, buckets and their policy, lifecycle, CORS, quotas and Block Public Access, bucket-scoped credentials for apps (provision), storage pools and erasure coding, nodes, OSDs and placement groups, drains and repair, upgrade finalize, KMS keys, Iceberg warehouses, audit streams, replication targets and PromQL metrics. Use when asked to onboard a tenant or a user, mint or revoke a key, give an application access to a bucket, make a bucket public or private, create a pool, check cluster health or read `iolakectl pg` output, take a disk or OSD out of service, finish an upgrade, or set up auditing or replication. Installing, sizing and monitoring a deployment is iolake-deploy; writing applications against it is iolake-sdk.
---

# Administering an IOLake cluster

`iolakectl` is a SigV4 client of the gateway's admin API (`/_admin/*`). Every
command goes through the same authentication, tenant scoping, validation,
Block Public Access and audit as any other caller; it never talks to meta.
Installing, upgrading binaries, sizing and Prometheus are the
`iolake-deploy` skill. Applications, S3 clients and the SDKs are
`iolake-sdk`. The full guides are the operations guide at
https://iolake.dev; `iolakectl <group> --help` lists every option.

Start by knowing who you are and where:

```bash
iolakectl tenant list              # a tenant admin sees only its own tenant
iolakectl cluster usage            # system admin only
```

## Configuring iolakectl

```bash
iolakectl --profile prod configure   # prompts for endpoint, key and secret; "default" without --profile
iolakectl configure --list
```

The prompt is for the human: don't type a secret for them, and don't use
`configure --non-interactive --secret-key`, which puts it in the process
list. Without a profile, set `IOLAKE_ENDPOINT`, `IOLAKE_ACCESS_KEY`
and `IOLAKE_SECRET_KEY_FILE` (a 0600 file).

Profiles live in `~/.objectio/config` (or `$IOLAKE_CONFIG_FILE`), mode
0600. The first source with a value wins: flags (`--endpoint`,
`--access-key`/`--secret-key`, `--region`), then `--profile`, then the
environment (`IOLAKE_ENDPOINT`, `IOLAKE_ACCESS_KEY[_FILE]`,
`IOLAKE_SECRET_KEY[_FILE]`, `AWS_*` as fallbacks), then the profile named
by `IOLAKE_PROFILE`, else `default`. The region defaults to `us-east-1`.

The credential must be **unscoped**. A key confined to a bucket is refused
by the admin API (403), by design.

## System admin and tenant admin

| Caller | Reaches |
|---|---|
| **System admin** (the key meta prints on first boot) | Everything: tenants, pools, nodes, OSDs, PGs, upgrade, stored config, KMS keys; any tenant's identities and buckets with `--tenant` |
| **Tenant admin** (a user in its tenant's `admin_users`) | Its own tenant only: users, keys, groups, policies, roles, buckets, provision, its Block Public Access, audit and replication targets, its OIDC provider `t-<tenant>`, its warehouses |

Without `--tenant`, a command acts in the caller's own tenant, which is
system scope for the system admin. A tenant admin cannot name another
tenant. `user list`, `bucket list` and `warehouse list` have no tenant on
the server: a tenant admin gets its tenant's, the system admin every
tenant's, and `--tenant` filters their answer. Cluster, node, pool and PG
commands answer a tenant admin with 403.

**The system admin bypasses every policy**, an explicit Deny included, and
reaches every tenant's buckets. Its requests still show in the bucket's
tenant's audit stream. Use it for administration only.

## The model

| Thing | What it is |
|---|---|
| Tenant | A hard boundary, and an IAM account (its id is the tenant's name). No policy can grant across it |
| User | An identity in one tenant. Names are case-insensitive and unique across the cluster |
| Access key | A user's credential. `--scope s3://b/p/` confines it; `--read-only` refuses PUT, POST and DELETE |
| Group | Users of one tenant; they get the group's policies |
| Policy | AWS-format JSON on a user, group, role or bucket. Explicit Deny wins, then any Allow; with neither, only the bucket's owner. `readonly`, `readwrite`, `writeonly` are built in |
| Role | Policies taken on for a while: through STS with an OIDC token, decided by its trust policy |
| OIDC provider | The operator's signs in system admins; a tenant's is named `t-<tenant>` |
| Pool | A protection scheme (EC k+m, LRC or replication), failure domain and fixed PG count. Buckets live in one |
| Node / OSD | A storage daemon on its disks, with an admin state `in`, `draining` or `out` |
| PG | Placement group: a pool's objects are hashed to PGs; each has an acting set of k+m OSDs |

## Onboard a tenant and its admin (system admin)

```bash
iolakectl tenant create acme --display-name "Acme" --default-pool default --quota-bytes 2T
ADMIN=$(iolakectl -o json user create acme-admin --tenant acme | jq -r .user_id)
iolakectl tenant admin add acme "$ADMIN"
(umask 077; iolakectl -o json key create "$ADMIN" > acme-admin-key.json)   # for acme's admin
```

`tenant update` changes only the flags given (`--allowed-pool`, quotas,
`--enabled false`). Quota 0 is unlimited; a write past one gets 403.

## Users, keys, groups, policies (tenant admin, or system admin with --tenant)

```bash
iolakectl user create alice --email alice@example.com
iolakectl key create <alice-id>                  # the secret is printed once
iolakectl key list <alice-id>
iolakectl policy create read-logs --file read-logs.json
iolakectl policy attach read-logs --user <alice-id>      # or --group G / --role R
iolakectl policy attached --user <alice-id>
iolakectl group create devs
iolakectl group add-user <group-id> <alice-id>
```

To cut someone off and decide later: `user suspend <id>` (every key
refused, nothing deleted; `user activate`) or `key deactivate <key-id>`.
Gateways cache credentials for up to 15 seconds.

## Roles, OIDC and STS

```bash
iolakectl oidc tenant-name acme                  # prints t-acme
iolakectl oidc put t-acme --file provider.json   # issuer_url, client_id, client_secret, claim_name, scopes
iolakectl role create etl --trust-file trust.json --max-session-seconds 3600
iolakectl policy attach read-logs --role etl
eval "$(iolakectl sts assume-role-with-web-identity \
  --role-arn arn:obio:iam::acme:role/etl --token-file /var/run/secrets/token --env)"
```

A tenant role accepts tokens from its tenant's provider only. Sessions
last from 900 seconds to the role's `--max-session-seconds` (default an
hour, at most 12). Only the system admin may set a provider's `system_admin`.
A tenant's `oidc_provider` must name a stored provider (else 400), and a
provider a tenant names can't be deleted (409, naming the tenants): set
the tenant's `--oidc-provider` elsewhere, or to `""`, first. A tenant
admin deleting its own `t-<tenant>` unbinds it.

## Buckets

```bash
iolakectl bucket create logs --pool default
iolakectl bucket policy put logs --file policy.json
iolakectl bucket lifecycle put logs --file lifecycle.xml   # S3 XML
iolakectl bucket cors put logs --file cors.xml             # S3 XML
iolakectl bucket set-quota logs --bytes 500G --objects 1000000
iolakectl bucket set-owner logs <user-id>
```

Policy, lifecycle and CORS also have `get` and `delete`. **New buckets start with all four Block
Public Access flags set**, so making data public is two deliberate steps:
lift the bucket's block, then set a policy granting `"Principal": "*"`.

```bash
iolakectl public-access-block bucket put assets            # no flags: lifts all four
iolakectl public-access-block bucket policy-status assets  # IsPublic: true/false
iolakectl public-access-block put --all                    # the tenant's (or, as system admin, the cluster's)
```

`put` **replaces**: flags not given are cleared. A bucket cannot lift its
tenant's block, and a tenant cannot lift the cluster's.

## A bucket for an application: provision

A bucket and one credential that reaches only it; the key's scope does
the work, no policy is written.

```bash
iolakectl -o json provision bucket ws-1 --user "$ADMIN" > ws-1-key.json
iolakectl provision bucket ws-2 --user "$ADMIN" --prefix in/ --read-only
iolakectl provision rotate-key ws-1 --user "$ADMIN"     # old key keeps working
iolakectl key delete <old-key-id>                       # then retire it
iolakectl provision deprovision ws-1 --user "$ADMIN"    # revokes its keys, deletes the (empty) bucket
```

`--user` (default `$IOLAKE_PROVISIONER_USER_ID`) owns the key. Its scope is
`s3://ws-1/` (or the prefix), and the admin API refuses it, so it cannot
mint itself a wider one.

## Pools and erasure coding (system admin)

```bash
iolakectl pool create fast --ec-type 0 --ec-k 4 --ec-m 2 --failure-domain rack
iolakectl pool create rep3 --ec-type 2 --replication-count 3
iolakectl cluster validate-placement fast     # enough failure domains for k+m?
iolakectl tenant update acme --allowed-pool default --allowed-pool fast
```

`--ec-type` is 0 Reed-Solomon, 1 LRC (`--ec-local-parity`,
`--ec-global-parity`), 2 replication. `--spread-domains` with
`--per-domain` spreads a PG over fewer domains (4+2 over 3 racks, 2 per
rack). Leave `--pg-count` out: it is sized from the OSDs. **Protection,
failure domain, placement rule and PG count are fixed when a pool is
made**; `pool update` changes quota, description, tier and `--enabled`
only. Grow capacity by adding OSDs or another pool; PGs never split.

## Cluster health

```bash
iolakectl node list                 # ONLINE, STATE (in/draining/out), USED, SHARDS
iolakectl node show <node-id|name>  # its disks; cluster topology: the failure domains
iolakectl cluster drain-status
iolakectl pg list --pool default    # a count by state, then each PG
iolakectl pg list --state degraded  # case-insensitive
iolakectl pg get 17 --pool default  # each member's part, last error, recovery, scrub
iolakectl pg scrub 17 --pool default
```

Repair is continuous (meta's leader peers and recovers each PG); there is
nothing to start by hand. PG states, as `iolakectl pg` prints them:

| State | Meaning | Act? |
|---|---|---|
| `Clean` | Every acting member holds every current object and shard | No |
| `Degraded` | Members miss objects or shards, a member did not answer, or a stand-in is filling; queued for recovery | Watch it fall |
| `Recovering` | Holds recovery slots on its OSDs; rebuilding what members miss | No |
| `Backfilling` | Copying the PG onto a new member (a stand-in or a rebalance), resumable | No |
| `WaitTooFull` | A target OSD is past the backfill full ratio (0.90); retried with backoff | Add capacity or delete data |
| `Undersized` | A position has no usable OSD and none can stand in under the pool's rule | Bring the OSD back or add OSDs |
| `Incomplete` | Too few members answered for a metadata quorum; nothing is rebuilt from a view that may be old | Bring the missing OSDs back |
| `Down` | Fewer than k members answered: no reads or writes | Bring OSDs back. Urgent |
| `Unknown` / `not peered yet` | Not peered yet (a pool just made) | Wait a minute |

Columns: `DEGRADED` objects missing something, `UNFOUND` objects with
fewer than k shards anywhere (lost unless an OSD returns), `MISSING` and
`STALE` metadata copies, `SHARDS` missing shards, `DOWN` members not
answering, `RECOVERED`/`LEFT` recovery progress. `pg get` shows the reason
for a stuck state in `last error`. In JSON, `state.remapped` is true while
acting differs from up.

An OSD that stops answering is marked down after about 45 seconds. Writes
go on at k+1 shards. After 2 minutes down (`pg/down_out_seconds`), each of
its PGs gets a stand-in OSD in a failure domain it does not use, if the
pool's rule has one, and backfills onto it; with none, the PG stays
`Undersized`.

## Taking an OSD out of service (system admin)

```bash
iolakectl node list                            # the 32-hex node id
iolakectl cluster validate-placement default   # is there a spare failure domain?
iolakectl osd set-state <node-id> draining     # disk still reads: copy everything off
iolakectl cluster drain-status                 # REMAINING falls; the OSD turns out and is wiped
iolakectl osd set-state <node-id> out          # disk or host gone for good: rebuild elsewhere
iolakectl osd set-state <node-id> in           # new disk in place, or cancel a drain
```

A drain needs somewhere to go: with exactly k+m failure domains (6 hosts
for 4+2), every PG of the drained OSD goes `Undersized` and the drain never
finishes. A drained OSD can rejoin only once its purge is done. Do not set
an OSD that went straight to `out` back `in` with its old data on it.

## Upgrades and meta backups (system admin)

```bash
iolakectl meta export --file meta-$(date +%F).backup   # meta's whole state, checked as it downloads
iolakectl upgrade status     # each node's release and format level, and what blocks finalize
iolakectl upgrade finalize   # irreversible: the new formats start
```

Take a meta backup before every finalize, and on a schedule: it is what a
cluster that lost a meta majority is restored from (`iolake-meta restore`,
run by whoever runs the deployment: `iolake-deploy`). A restore goes back
to the backup's point: users and keys deleted since are valid again. The
file holds every secret meta keeps (users' secret keys among them): keep it
off the cluster and private.

Rolling the binaries is `iolake-deploy`. `status` lists nodes heard from
in the last 90 seconds: check every gateway you run is there.

## KMS, warehouses, audit, replication

```bash
iolakectl kms status                                       # backend, master key configured
iolakectl kms keys create --key-id app-key --description "app data"   # list, show
iolakectl warehouse create analytics --tenant acme         # also makes bucket iceberg-analytics
iolakectl audit put --file audit.json                      # replaces; audit get shows tokens as ********
iolakectl replication target set site-b --remote-endpoint https://dr.example.com \
  --remote-bucket dr-copy --remote-access-key AKIA... --bandwidth 100M   # secret from IOLAKECTL_REMOTE_SECRET_KEY
iolakectl replication resync start photos site-b           # existing objects; status, cancel
```

KMS keys are cluster-wide: a tenant admin is refused unless a policy
allows the `kms:` actions. An audit config is `{"targets": [...]}`. The
operator's may use `webhook` or `stdout` and lists `allowed_tenant_hosts`;
a tenant's targets must be `https` webhooks on one of those hosts (a
tenant's `stdout` is refused).
Replication targets have the same rule for tenant admins: `https`, on a
host the operator allows (`iolakectl replication settings set
--allowed-tenant-host H`, repeatable; `settings get` reads them); until then the system admin sets them with `--tenant`. A
bucket's rules are S3's `PutBucketReplication` (an S3 client), naming
`arn:obio:replication:::<target>`; both buckets must be versioned.

## Metrics

`iolakectl metrics query` and `query-range --start --end --step` go through
the gateway to Prometheus; without the gateway's `--prometheus-url` they
answer 503 (that is `iolake-deploy`).

```bash
iolakectl metrics query 'sum by (state) (iolake_meta_pgs)'
iolakectl metrics query 'iolake_objects_at_risk'          # one more loss from unreadable
iolakectl metrics query 'iolake_osd_used_bytes / iolake_osd_capacity_bytes > 0.85'
```

Also: `iolake_meta_pg_objects_unfound`, `iolake_drain_shards_remaining`,
`iolake_replication_lag_seconds`, `iolake_audit_dropped_total`.

## Output for scripts

`-o json` prints the API's own JSON. Lists are wrapped (`.users`,
`.buckets`, `.nodes`, `.access_keys`, `.drains`; `pg list` gives `.pgs`
and `.by_state`); `tenant list` and `pool list` are bare arrays. Deletes
print nothing. Lifecycle and CORS are XML in both modes, ready for `put
--file`. An error exits non-zero with the server's message on stderr
(`error: DELETE /_admin/buckets/logs: 409: bucket 'logs' is not empty`).

## Do not

- **Do not delete without the human's say-so**: `tenant delete`, `bucket
  delete`, `user delete` (takes its keys), `key delete`, `pool delete`,
  `warehouse delete`, `provision deprovision`. Name exactly what goes. Never
  empty a bucket so that a delete succeeds.
- **Do not take more than one OSD out at a time.** Set one `draining` or
  `out`, wait for `cluster drain-status` to empty and `pg list` to show
  only `Clean`, then the next. A PG that loses more than m members before
  it recovers loses data.
- **Do not set OSDs out, or wipe disks, while any PG is `Down` or
  `Incomplete` or has unfound objects.** Bring back every intact OSD
  first: its shards are what makes the data readable.
- **Do not run `upgrade finalize` without the human**, a meta backup, and
  `upgrade status` clean. It cannot be undone.
- **Do not put secrets on the command line, or print, log or paste them.**
  `--secret-key`, `--remote-secret-key` and `--token` show in `ps`; use a
  profile, `IOLAKE_SECRET_KEY_FILE`, `IOLAKECTL_REMOTE_SECRET_KEY`,
  `--token-file`. A new secret is shown once: send it to its secret store.
- **Do not hand the system admin key, or any unscoped key, to an app or a
  tenant.** The system admin key bypasses every policy and tenant. Give
  apps `provision` keys, `--read-only` where they only read.
- **Do not run `public-access-block put` with only the flag you want on**:
  it clears the others. Pass `--all`, or every flag meant to stay.
- **Do not change `pg/` or `scrub/` keys with `config set`** to make
  recovery go faster or quieter without the human: they trade safety.
