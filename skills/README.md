# IOLake agent skills

Skills teach a coding agent (Claude Code, Codex, opencode, pi, …) to work
with IOLake: what to do, in what order, and what not to do. Each is a
directory with a `SKILL.md`.

| Skill | For | What it covers |
|---|---|---|
| `iolake-deploy` | ops | Installing, sizing, upgrading, monitoring and troubleshooting a deployment: `iolake-aio`, the binaries, the Helm chart |
| `iolake-admin` | ops | Running a cluster with `iolakectl`: tenants, users and keys, policies, buckets, pools, placement groups, repair and drain |
| `iolake-sdk` | dev | Building on IOLake: S3 clients, the Python and Go SDKs, credentials and STS, the data lake APIs |

Skills for working *on* IOLake, for contributors, are elsewhere: in
`.claude/skills/`, loaded when an agent works in a checkout of this repo.

## Installing them

With `iolakectl` (they're compiled into it, so there is nothing to fetch):

```bash
iolakectl skills list
iolakectl skills install                    # every agent found under $HOME, and ~/.agents/skills
iolakectl skills install --audience ops     # only the operators' skills
iolakectl skills install --agent claude     # one agent (repeatable)
iolakectl skills install --dir ./.claude/skills   # one project
iolakectl skills install --force            # replace older copies, after upgrading iolakectl
```

`install` writes to each agent whose home exists: Claude Code
(`~/.claude/skills`), Codex (`~/.codex/skills`), opencode
(`~/.config/opencode/skills`), pi (`~/.pi/agent/skills`), and always
`~/.agents/skills`, which several agents read. A copy that differs from
the one carried (edited by hand, or from an older `iolakectl`) is kept
unless `--force` is given.

Without `iolakectl`, in Claude Code, this repository is a plugin
marketplace with two plugins, `iolake-ops` and `iolake-dev`:

```
/plugin marketplace add io-lake/iolake
/plugin install iolake-ops@iolake
/plugin install iolake-dev@iolake
```

## Changing them

This directory is the only copy: `iolakectl` compiles it in
(`bin/cli/src/skills.rs`) and the marketplace
(`.claude-plugin/marketplace.json`) points at it. A new skill is added in
three places, its directory, `SKILLS` in `skills.rs` and a plugin in
`marketplace.json`; a test fails if the first two disagree.

When editing one:

- **The description is the whole interface.** An agent decides whether to
  read a skill from its front-matter `description` alone, so it says what
  the skill covers *and when to reach for it* ("Use when …"). The test
  checks for that.
- **Only write commands that exist.** A skill is read as fact. An invented
  flag sends the agent into an error it can't explain, and then it can't
  tell which half of the skill to trust. Check every command against
  `--help` and the code; prefer adding the missing command to describing
  one that doesn't exist.
- **Say what not to do, and why.** These skills act on storage that holds
  other people's data. "Don't delete a bucket you didn't create without
  asking" is worth more than another example of a command the agent
  already knows.
- **Keep the guides the reference.** A skill is the shape of the job and
  what goes wrong; the full procedure is in the documentation
  (https://iolake.dev), linked from the skill.
