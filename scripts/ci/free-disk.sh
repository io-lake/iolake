#!/usr/bin/env bash
# free-disk.sh: room on a CI runner's root filesystem, by removing
# toolchains the image ships and no job here uses. Some ubuntu-24.04
# runners have a 72 GB root with 12 GB free at the start of a job; after an
# end-to-end shard's downloads it was under a tenth free, and there an OSD
# keeps small shards on disk blocks rather than in its metadata store
# (iolake-docs core/small-object-path.md), which the small-object tests
# then can't see.
set -euo pipefail
df -h /
sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc \
  /opt/hostedtoolcache/CodeQL
df -h /
