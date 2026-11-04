import { useCallback, useEffect, useState } from "react";
import {
  readSetting,
  type EncryptionDoc,
  type LifecycleDoc,
  type LockDoc,
  type ReplicationDoc,
  type Setting,
} from "./model";

export interface BucketSettings {
  lock: Setting<LockDoc>;
  encryption: Setting<EncryptionDoc>;
  lifecycle: Setting<LifecycleDoc>;
  replication: Setting<ReplicationDoc>;
}

/// The settings S3 keeps as bucket sub-resources, for one bucket, read from
/// their admin routes when the bucket changes. `null` while loading.
/// `reload` reads them again after a change.
export function useBucketSettings(bucket: string | undefined) {
  const [state, setState] = useState<{ bucket: string; settings: BucketSettings } | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!bucket) return;
    let cancelled = false;
    void Promise.all([
      readSetting<LockDoc>(bucket, "object-lock"),
      readSetting<EncryptionDoc>(bucket, "encryption"),
      readSetting<LifecycleDoc>(bucket, "lifecycle"),
      readSetting<ReplicationDoc>(bucket, "replication"),
    ]).then(([lock, encryption, lifecycle, replication]) => {
      if (!cancelled) setState({ bucket, settings: { lock, encryption, lifecycle, replication } });
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, n]);

  const reload = useCallback(() => setN((x) => x + 1), []);
  const settings = state && state.bucket === bucket ? state.settings : null;
  return { settings, reload };
}

/// Re-render every `ms` so "2 min ago" stays true.
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
