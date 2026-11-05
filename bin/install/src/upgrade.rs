//! `iolake-install upgrade`: units under the new names for a host set up
//! by a release from before the rename to IOLake (0.1.0-rc.3).
//!
//! Such a host has a unit `objectio-<service>.service` per service, which
//! runs the binary `objectio-<service>`, maybe drop-ins beside it
//! (`objectio-<service>.service.d/*.conf`, where mTLS sets
//! `OBJECTIO_TLS_*`), and the gateway's environment file with `OBJECTIO_*`
//! settings. The releases since name the binaries `iolake-<service>` and
//! read `IOLAKE_*`.
//!
//! For each such unit this writes `iolake-<service>.service` and its
//! drop-ins: the binary, the units it orders after and the variables
//! renamed, everything else (flags, paths, user) as it was. To the
//! gateway's environment file it adds an `IOLAKE_*` line for each
//! `OBJECTIO_*` one, keeping those for the gateway of the old release
//! until it is replaced, and for going back. Nothing is stopped or
//! started: the operator swaps each service at its turn in the upgrade,
//! and removes the old units once the upgrade is finalized.
//!
//! Only for the upgrade from 0.1.0-rc.3; it goes with the release after.

use std::ffi::OsStr;
use std::fmt::Write as _;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tracing::info;

use crate::config::Layout;

const OLD: &str = "objectio-";
const NEW: &str = "iolake-";
const OLD_VAR: &str = "OBJECTIO_";
const NEW_VAR: &str = "IOLAKE_";

/// What [`upgrade`] did.
#[derive(Debug, Default)]
pub struct Report {
    /// Each old unit and its new one, written now or before.
    pub units: Vec<(String, String)>,
    /// New units left as they were, being there already.
    pub kept: Vec<String>,
    /// Variables added to the gateway's environment file.
    pub vars: Vec<String>,
}

/// Write the new units of every old one under `layout`. `bin_dir`: where
/// the new binaries are, else where the old ones were.
pub fn upgrade(layout: &Layout, bin_dir: Option<&Path>) -> Result<Report> {
    let mut report = Report::default();
    let dir = layout.unit_dir();
    for old in old_units(&dir)? {
        let name = old.strip_suffix(".service").unwrap_or(&old);
        let new_name = format!("{NEW}{}", &name[OLD.len()..]);
        let new = format!("{new_name}.service");
        report.units.push((name.to_string(), new_name.clone()));
        let target = dir.join(&new);
        if target.exists() {
            report.kept.push(new);
            continue;
        }
        let text = std::fs::read_to_string(dir.join(&old))
            .with_context(|| format!("reading {}", dir.join(&old).display()))?;
        // The drop-ins first: a unit whose drop-ins are missing would
        // start without its certificates.
        let drop_ins = dir.join(format!("{old}.d"));
        if drop_ins.is_dir() {
            let new_drop_ins = dir.join(format!("{new}.d"));
            std::fs::create_dir_all(&new_drop_ins)?;
            for entry in std::fs::read_dir(&drop_ins)? {
                let entry = entry?;
                let from = entry.path();
                if !from.is_file() {
                    continue;
                }
                let conf = std::fs::read_to_string(&from)
                    .with_context(|| format!("reading {}", from.display()))?;
                let to = new_drop_ins.join(entry.file_name());
                write_like(&to, &rename_unit(&conf, bin_dir), &from)?;
                info!("wrote {}", to.display());
            }
        }
        write_like(&target, &rename_unit(&text, bin_dir), &dir.join(&old))?;
        info!("wrote {}", target.display());
    }
    let env = layout.gateway_env();
    if env.is_file() {
        report.vars = add_new_vars(&env)?;
    }
    Ok(report)
}

/// The old units in `dir`, by name.
fn old_units(dir: &Path) -> Result<Vec<String>> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(Vec::new());
    };
    let mut names = Vec::new();
    for entry in entries {
        let name = entry?.file_name();
        if let Some(n) = name.to_str()
            && n.starts_with(OLD)
            && n.ends_with(".service")
        {
            names.push(n.to_string());
        }
    }
    names.sort();
    Ok(names)
}

/// Write `text` to `path`, with the permissions of `like` (a drop-in may
/// hold a secret), durably.
fn write_like(path: &Path, text: &str, like: &Path) -> Result<()> {
    let tmp = path.with_extension("iolake-tmp");
    {
        let mut f =
            std::fs::File::create(&tmp).with_context(|| format!("writing {}", tmp.display()))?;
        f.set_permissions(std::fs::metadata(like)?.permissions())?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path).with_context(|| format!("writing {}", path.display()))?;
    if let Some(parent) = path.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

/// A unit or drop-in of the old release, renamed.
pub fn rename_unit(text: &str, bin_dir: Option<&Path>) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let renamed = match line.split_once('=') {
            Some((key, value)) => {
                let value = match key.trim() {
                    "ExecStart" | "ExecStartPre" | "ExecStartPost" | "ExecReload" | "ExecStop"
                    | "ExecStopPost" => rename_program(value, bin_dir),
                    "After" | "Before" | "Wants" | "Requires" | "BindsTo" | "PartOf"
                    | "Requisite" | "Conflicts" => value
                        .split(' ')
                        .map(|u| {
                            u.strip_prefix(OLD)
                                .map_or_else(|| u.to_string(), |rest| format!("{NEW}{rest}"))
                        })
                        .collect::<Vec<_>>()
                        .join(" "),
                    "SyslogIdentifier" => value
                        .strip_prefix(OLD)
                        .map_or_else(|| value.to_string(), |rest| format!("{NEW}{rest}")),
                    "Description" => value.replace("ObjectIO", "IOLake"),
                    "Documentation" => {
                        value.replace("https://object-io.github.io", "https://iolake.dev")
                    }
                    "Environment" => rename_vars(value),
                    _ => value.to_string(),
                };
                format!("{key}={value}")
            }
            None => line.to_string(),
        };
        out.push_str(&renamed);
        out.push('\n');
    }
    out
}

/// An `ExecStart=` value with its program renamed (`objectio-meta` →
/// `iolake-meta`), and moved to `bin_dir` when given.
fn rename_program(value: &str, bin_dir: Option<&Path>) -> String {
    // A leading prefix (`-`, `@`, `+`, `!`, `:`) is systemd's, not the path's.
    let start = value
        .find(|c: char| !"-@+!:".contains(c))
        .unwrap_or(value.len());
    let (prefix, rest) = value.split_at(start);
    let (program, args) = rest.split_at(rest.find(char::is_whitespace).unwrap_or(rest.len()));
    let path = Path::new(program);
    let Some(file) = path.file_name().and_then(OsStr::to_str) else {
        return value.to_string();
    };
    let Some(service) = file.strip_prefix(OLD) else {
        return value.to_string();
    };
    let dir = bin_dir.map_or_else(
        || path.parent().map(Path::to_path_buf).unwrap_or_default(),
        Path::to_path_buf,
    );
    let program = dir.join(format!("{NEW}{service}"));
    format!("{prefix}{}{args}", program.display())
}

/// An `Environment=` value with each `OBJECTIO_` variable renamed.
fn rename_vars(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(i) = rest.find(OLD_VAR) {
        let at_name = i == 0 || rest[..i].ends_with([' ', '"', '\'']);
        out.push_str(&rest[..i]);
        out.push_str(if at_name { NEW_VAR } else { OLD_VAR });
        rest = &rest[i + OLD_VAR.len()..];
    }
    out.push_str(rest);
    out
}

/// Add to the environment file at `path` an `IOLAKE_*` line for each
/// `OBJECTIO_*` one it has no new line for. Returns the variables added.
fn add_new_vars(path: &Path) -> Result<Vec<String>> {
    let text =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let set = |line: &str| -> Option<(String, String)> {
        let line = line.trim_start();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let (name, value) = line.split_once('=')?;
        Some((name.trim().to_string(), value.to_string()))
    };
    let defined: Vec<String> = text
        .lines()
        .filter_map(|l| set(l).map(|(n, _)| n))
        .collect();
    let mut added = Vec::new();
    let mut lines = String::new();
    for (name, value) in text.lines().filter_map(set) {
        let Some(rest) = name.strip_prefix(OLD_VAR) else {
            continue;
        };
        let new = format!("{NEW_VAR}{rest}");
        if defined.contains(&new) || added.contains(&new) {
            continue;
        }
        let _ = writeln!(lines, "{new}={value}");
        added.push(new);
    }
    if added.is_empty() {
        return Ok(added);
    }
    // Appended in place: the file keeps its owner and mode (it holds the
    // SSE master key).
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .with_context(|| format!("writing {}", path.display()))?;
    let mut block = String::new();
    if !text.is_empty() && !text.ends_with('\n') {
        block.push('\n');
    }
    block.push_str(
        "# Added by iolake-install upgrade: the same settings under the names the\n\
         # IOLake binaries read. The OBJECTIO_* lines are for the old gateway;\n\
         # remove them once the upgrade is finalized.\n",
    );
    block.push_str(&lines);
    f.write_all(block.as_bytes())?;
    f.sync_all()?;
    info!("added {} to {}", added.join(" "), path.display());
    Ok(added)
}

/// The old units' directory entries a host keeps until it is finalized.
pub fn leftovers(layout: &Layout, report: &Report) -> Vec<PathBuf> {
    let dir = layout.unit_dir();
    report
        .units
        .iter()
        .flat_map(|(old, _)| {
            [
                dir.join(format!("{old}.service")),
                dir.join(format!("{old}.service.d")),
            ]
        })
        .filter(|p| p.exists())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const META: &str = "[Unit]\n\
        Description=ObjectIO metadata service\n\
        Documentation=https://object-io.github.io\n\
        After=network-online.target\n\
        \n\
        [Service]\n\
        User=objectio\n\
        ExecStart=/usr/local/bin/objectio-meta --node-id 1 --data-dir /var/lib/objectio/meta\n\
        ReadWritePaths=/var/lib/objectio/meta\n\
        SyslogIdentifier=objectio-meta\n";

    const GATEWAY: &str = "[Unit]\n\
        Description=ObjectIO S3 gateway\n\
        After=network-online.target\n\
        After=objectio-meta.service\n\
        \n\
        [Service]\n\
        EnvironmentFile=-/etc/objectio/gateway.env\n\
        ExecStart=/usr/local/bin/objectio-gateway --listen 0.0.0.0:9000\n\
        SyslogIdentifier=objectio-gateway\n";

    #[test]
    fn a_unit_runs_the_new_binary_and_keeps_its_paths_and_user() {
        let u = rename_unit(META, None);
        assert!(u.contains("\nExecStart=/usr/local/bin/iolake-meta --node-id 1 --data-dir /var/lib/objectio/meta\n"), "{u}");
        assert!(u.contains("\nDescription=IOLake metadata service\n"), "{u}");
        assert!(u.contains("\nDocumentation=https://iolake.dev\n"), "{u}");
        assert!(u.contains("\nUser=objectio\n"), "{u}");
        assert!(
            u.contains("\nReadWritePaths=/var/lib/objectio/meta\n"),
            "{u}"
        );
        assert!(u.contains("\nSyslogIdentifier=iolake-meta\n"), "{u}");

        let g = rename_unit(GATEWAY, Some(Path::new("/opt/iolake/bin")));
        assert!(g.contains("\nAfter=iolake-meta.service\n"), "{g}");
        assert!(g.contains("\nAfter=network-online.target\n"), "{g}");
        assert!(
            g.contains("\nEnvironmentFile=-/etc/objectio/gateway.env\n"),
            "{g}"
        );
        assert!(
            g.contains("\nExecStart=/opt/iolake/bin/iolake-gateway --listen 0.0.0.0:9000\n"),
            "{g}"
        );
    }

    #[test]
    fn a_drop_in_sets_the_new_variables() {
        let d = rename_unit(
            "[Service]\n\
             Environment=OBJECTIO_TLS_CERT=/etc/objectio/tls/meta.pem \"OBJECTIO_TLS_KEY=/k\"\n\
             Environment=OTHER=OBJECTIO_KEEP\n",
            None,
        );
        assert_eq!(
            d,
            "[Service]\n\
             Environment=IOLAKE_TLS_CERT=/etc/objectio/tls/meta.pem \"IOLAKE_TLS_KEY=/k\"\n\
             Environment=OTHER=OBJECTIO_KEEP\n"
        );
    }

    #[test]
    fn an_old_host_gets_new_units_once_and_both_sets_of_variables() {
        let root = tempfile::tempdir().unwrap();
        let layout = Layout::new(root.path()).unwrap();
        let units = layout.unit_dir();
        std::fs::create_dir_all(units.join("objectio-meta.service.d")).unwrap();
        std::fs::write(units.join("objectio-meta.service"), META).unwrap();
        std::fs::write(units.join("objectio-gateway.service"), GATEWAY).unwrap();
        std::fs::write(
            units.join("objectio-meta.service.d/tls.conf"),
            "[Service]\nEnvironment=OBJECTIO_TLS_CA=/ca.pem\n",
        )
        .unwrap();
        std::fs::write(units.join("other.service"), "[Unit]\n").unwrap();
        std::fs::create_dir_all(layout.config_dir()).unwrap();
        std::fs::write(
            layout.gateway_env(),
            "# keys\nOBJECTIO_MASTER_KEY=abc=\nexport OBJECTIO_REGION=eu\nIOLAKE_REGION=us\nRUST_LOG=info",
        )
        .unwrap();

        let r = upgrade(&layout, None).unwrap();
        assert_eq!(
            r.units,
            [
                ("objectio-gateway".to_string(), "iolake-gateway".to_string()),
                ("objectio-meta".to_string(), "iolake-meta".to_string())
            ]
        );
        assert!(r.kept.is_empty());
        assert_eq!(r.vars, ["IOLAKE_MASTER_KEY"]);
        let meta = std::fs::read_to_string(units.join("iolake-meta.service")).unwrap();
        assert!(
            meta.contains("ExecStart=/usr/local/bin/iolake-meta "),
            "{meta}"
        );
        assert_eq!(
            std::fs::read_to_string(units.join("iolake-meta.service.d/tls.conf")).unwrap(),
            "[Service]\nEnvironment=IOLAKE_TLS_CA=/ca.pem\n"
        );
        assert!(!units.join("iolake-other.service").exists());
        let env = std::fs::read_to_string(layout.gateway_env()).unwrap();
        assert!(
            env.starts_with("# keys\nOBJECTIO_MASTER_KEY=abc=\n"),
            "{env}"
        );
        assert!(env.ends_with("\nIOLAKE_MASTER_KEY=abc=\n"), "{env}");
        assert_eq!(env.matches("IOLAKE_REGION").count(), 1, "{env}");
        assert_eq!(leftovers(&layout, &r).len(), 3);

        // Again: nothing more, and a new unit changed since is left alone.
        std::fs::write(units.join("iolake-meta.service"), "edited\n").unwrap();
        let again = upgrade(&layout, None).unwrap();
        assert_eq!(again.kept.len(), 2);
        assert!(again.vars.is_empty());
        assert_eq!(
            std::fs::read_to_string(units.join("iolake-meta.service")).unwrap(),
            "edited\n"
        );
        assert_eq!(std::fs::read_to_string(layout.gateway_env()).unwrap(), env);
    }
}
