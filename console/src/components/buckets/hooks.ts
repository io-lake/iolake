import { useCallback, useEffect, useState } from "react";
import { readS3Setting, type S3Setting } from "./model";

export interface BucketSettings {
  lock: S3Setting;
  encryption: S3Setting;
  lifecycle: S3Setting;
  replication: S3Setting;
}

/// The settings S3 keeps as bucket sub-resources, for one bucket, read when
/// the bucket changes. `null` while loading. `reload` reads them again after
/// a change.
export function useBucketSettings(bucket: string | undefined) {
  const [state, setState] = useState<{ bucket: string; settings: BucketSettings; n: number } | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!bucket) return;
    let cancelled = false;
    // One read first: if the gateway refuses the session, the other three
    // are answered from that without asking.
    void readS3Setting(bucket, "object-lock")
      .then((lock) =>
        Promise.all([
          lock,
          readS3Setting(bucket, "encryption"),
          readS3Setting(bucket, "lifecycle"),
          readS3Setting(bucket, "replication"),
        ]),
      )
      .then(([lock, encryption, lifecycle, replication]) => {
      if (!cancelled) setState({ bucket, settings: { lock, encryption, lifecycle, replication }, n });
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
