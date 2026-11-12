//! The shell's whole job: let the interface read the user's own config files, and run the Tool up!
//! installer for catalog items. Reading and listing are limited to the home directory. The only
//! things that change the machine are the commands that run the bundled install.sh (adding or removing),
//! the skill commands, `write_text` (a short list of instruction files) and `backup_store` (git, on request).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct Entry {
    name: String,
    dir: bool,
    /// For a symlink, where it really points.
    link: Option<String>,
}

fn home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|e| e.to_string())
}

/// An absolute path under the home directory, with no `..` in it.
fn inside_home(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let clean = p.is_absolute() && !p.components().any(|c| matches!(c, Component::ParentDir));
    if clean && p.starts_with(home(app)?) {
        Ok(p)
    } else {
        Err(format!("{path} is outside the home directory"))
    }
}

#[tauri::command]
fn home_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(home(&app)?.to_string_lossy().into_owned())
}

/// A file's text, or null when it is missing or unreadable.
#[tauri::command]
fn read_text(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(inside_home(&app, &path)?).ok())
}

/// A directory's entries, or null when it does not exist.
#[tauri::command]
fn list_dir(app: tauri::AppHandle, path: String) -> Result<Option<Vec<Entry>>, String> {
    let dir = inside_home(&app, &path)?;
    let Ok(read) = fs::read_dir(&dir) else {
        return Ok(None);
    };
    let mut out = Vec::new();
    for e in read.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(kind) = e.file_type() else { continue };
        if kind.is_symlink() {
            let target = fs::canonicalize(e.path()).ok();
            let dir = target.as_ref().map(|t| t.is_dir()).unwrap_or(false);
            let link = target.unwrap_or_else(|| e.path()).to_string_lossy().into_owned();
            out.push(Entry { name, dir, link: Some(link) });
        } else {
            out.push(Entry { name, dir: kind.is_dir(), link: None });
        }
    }
    Ok(Some(out))
}

/// Show a file or folder under home in the file manager (Finder on macOS), selected.
#[tauri::command]
fn reveal_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = inside_home(&app, &path)?;
    if fs::symlink_metadata(&target).is_err() {
        return Err(format!("{path} is not there any more."));
    }
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = Command::new("/usr/bin/open");
        c.arg("-R").arg(&target);
        c
    } else if cfg!(target_os = "windows") {
        let mut c = Command::new("explorer");
        c.arg(format!("/select,{}", target.display()));
        c
    } else {
        let mut c = Command::new("xdg-open");
        c.arg(target.parent().unwrap_or(&target));
        c
    };
    cmd.stdin(Stdio::null()).spawn().map(|_| ()).map_err(|e| format!("Could not open the file manager: {e}"))
}

// The only web pages the app opens: the agents' own download pages, and a skill's repository on GitHub.
const AGENT_HOSTS: [&str; 12] = [
    "claude.com", "learn.chatgpt.com", "geminicli.com", "cursor.com", "code.visualstudio.com", "github.com",
    "windsurf.com", "cline.bot", "openclaw.ai", "block.github.io", "kiro.dev", "hermes-agent.nousresearch.com",
];

/// Open one of the agents' download pages in the user's browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let host = url.strip_prefix("https://").and_then(|rest| rest.split(|c| c == '/' || c == '?').next()).unwrap_or("");
    if !AGENT_HOSTS.contains(&host) || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("That is not a page Tool up! opens.".into());
    }
    let mut cmd = if cfg!(target_os = "macos") {
        Command::new("/usr/bin/open")
    } else if cfg!(target_os = "windows") {
        let mut c = Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    } else {
        Command::new("xdg-open")
    };
    cmd.arg(&url).stdin(Stdio::null()).spawn().map(|_| ()).map_err(|e| format!("Could not open the browser: {e}"))
}

/// Whether something exists at a path (used for app bundles such as /Applications/Cursor.app).
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Places commands are installed that an app opened from the Dock does not have on its PATH.
fn extra_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into()];
    if let Ok(h) = home(app) {
        for d in [".local/bin", ".npm-global/bin", ".bun/bin", ".volta/bin", ".cargo/bin"] {
            dirs.push(h.join(d));
        }
    }
    dirs
}

/// Whether a command is installed.
#[tauri::command]
fn on_path(app: tauri::AppHandle, bin: String) -> bool {
    if bin.is_empty() || bin.contains('/') || bin.contains('\\') {
        return false;
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.extend(extra_dirs(&app));
    dirs.iter().any(|d| d.join(&bin).exists())
}

// The same installer and catalog the site serves, built into the app.
const INSTALL_SH: &str = include_str!("../../../public/install.sh");
const CATALOG_TSV: &str = include_str!("../../../public/catalog.tsv");

#[derive(Serialize)]
struct RunOutput {
    code: i32,
    output: String,
}

/// A catalog id or an agent id: letters, digits, and - _ . only, so nothing else can reach the command line.
fn safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// The PATH of the user's login shell, where their agents and Node live.
fn shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok()?;
    let out = Command::new(shell)
        .args(["-l", "-c", "printf '%s\\n' \"$PATH\""])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8(out.stdout).ok()?;
    text.lines().last().map(str::to_owned).filter(|s| !s.is_empty())
}

/// The PATH to give anything the app runs: the login shell's, plus the usual install places.
fn user_path(app: &tauri::AppHandle) -> Option<std::ffi::OsString> {
    let mut dirs: Vec<PathBuf> = shell_path()
        .or_else(|| std::env::var("PATH").ok())
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.extend(extra_dirs(app));
    std::env::join_paths(dirs).ok()
}

/// Run the bundled installer against a catalog (TSV text) for these ids.
fn run_installer(app: &tauri::AppHandle, catalog: &str, ids: Vec<String>, to: Vec<String>, dry_run: bool, remove: bool) -> Result<RunOutput, String> {
    if ids.is_empty() || !ids.iter().chain(to.iter()).all(|s| safe_id(s)) {
        return Err("Nothing to install, or an id that is not a catalog id.".into());
    }
    let dir = std::env::temp_dir().join("toolup-app");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let script = dir.join("install.sh");
    let tsv = dir.join("catalog.tsv");
    fs::write(&script, INSTALL_SH).map_err(|e| e.to_string())?;
    fs::write(&tsv, catalog).map_err(|e| e.to_string())?;

    let mut cmd = Command::new("/bin/bash");
    cmd.arg(&script);
    if dry_run {
        cmd.arg("--dry-run");
    }
    if remove {
        cmd.arg("--remove");
    }
    if !to.is_empty() {
        cmd.arg("--to").arg(to.join(","));
    }
    cmd.args(&ids);

    if let Some(path) = user_path(app) {
        cmd.env("PATH", path);
    }
    let out = cmd
        .env("CATALOG_URL", format!("file://{}", tsv.display()))
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not start the installer: {e}"))?;

    let mut output = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str(&err);
    }
    Ok(RunOutput { code: out.status.code().unwrap_or(-1), output })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillFile {
    name: String,
    skill_md: String,
    files: usize,
}

fn count_files(dir: &Path) -> usize {
    let Ok(read) = fs::read_dir(dir) else { return 0 };
    read.flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => count_files(&e.path()),
            Ok(t) if t.is_file() => 1,
            _ => 0,
        })
        .sum()
}

/// Copy a folder, leaving out links and the clutter macOS adds to archives.
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for e in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name();
        if name == "__MACOSX" || name == ".DS_Store" {
            continue;
        }
        let kind = e.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            copy_dir(&e.path(), &to.join(&name))?;
        } else if kind.is_file() {
            fs::copy(e.path(), to.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Unpack a .skill file (a zip of a skill folder) into a scratch folder.
/// Returns the folder holding SKILL.md and the name the skill installs under.
fn unpack_skill(path: &str) -> Result<(PathBuf, String), String> {
    let src = Path::new(path);
    // a skill already downloaded and staged by `fetch_skill`
    if src.starts_with(staged_root()) && !src.components().any(|c| matches!(c, Component::ParentDir)) && src.join("SKILL.md").is_file() {
        let name = src.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if !safe_id(&name) {
            return Err(format!("“{name}” is not a usable skill name."));
        }
        return Ok((src.to_path_buf(), name));
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if ext != "skill" && ext != "zip" {
        return Err("That is not a .skill file.".into());
    }
    let meta = fs::metadata(src).map_err(|_| "The file could not be read.".to_string())?;
    if !meta.is_file() || meta.len() > 50 * 1024 * 1024 {
        return Err("That file is too large to be a skill (over 50 MB).".into());
    }
    let listing = Command::new("/usr/bin/unzip")
        .arg("-Z1")
        .arg(src)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not open the archive: {e}"))?;
    if !listing.status.success() {
        return Err("That file is not a valid .skill archive.".into());
    }
    let names = String::from_utf8_lossy(&listing.stdout);
    let entries: Vec<&str> = names.lines().filter(|l| !l.is_empty()).collect();
    let escapes = |e: &&str| e.starts_with('/') || e.split('/').any(|p| p == "..");
    if entries.is_empty() || entries.len() > 2000 || entries.iter().any(escapes) {
        return Err("That archive is empty, too large, or has paths that point outside itself.".into());
    }

    let tmp = std::env::temp_dir().join("toolup-app").join("skill");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let unpacked = Command::new("/usr/bin/unzip")
        .args(["-q", "-o"])
        .arg(src)
        .arg("-d")
        .arg(&tmp)
        .stdin(Stdio::null())
        .status()
        .map_err(|e| format!("Could not unpack the archive: {e}"))?;
    if !unpacked.success() {
        return Err("The archive could not be unpacked.".into());
    }

    // SKILL.md at the top (named after the file), or inside the one folder the archive holds
    let (root, name) = if tmp.join("SKILL.md").is_file() {
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        (tmp.clone(), stem)
    } else {
        let found = fs::read_dir(&tmp)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.is_dir() && p.join("SKILL.md").is_file());
        let Some(dir) = found else {
            return Err("There is no SKILL.md in that file, so it is not a skill.".into());
        };
        let name = dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        (dir, name)
    };
    if !safe_id(&name) {
        return Err(format!("“{name}” is not a usable skill name (letters, digits, - _ . only)."));
    }
    Ok((root, name))
}

/// Look inside a .skill file. Changes nothing outside the scratch folder.
#[tauri::command]
fn inspect_skill(path: String) -> Result<SkillFile, String> {
    let (root, name) = unpack_skill(&path)?;
    let skill_md = fs::read_to_string(root.join("SKILL.md")).map_err(|e| e.to_string())?;
    Ok(SkillFile { name, skill_md, files: count_files(&root) })
}

/// Clear whatever is at a path (a folder, a file or a link) so something new can go there.
fn clear(dest: &Path) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(dest) {
        let gone = if meta.is_dir() { fs::remove_dir_all(dest) } else { fs::remove_file(dest) };
        gone.map_err(|e| format!("Could not replace {}: {e}", dest.display()))?;
    }
    Ok(())
}

#[cfg(unix)]
fn link_dir(target: &Path, link: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, link).map_err(|e| format!("Could not link {}: {e}", link.display()))
}
// Windows needs special rights to make links, so there each agent gets its own copy.
#[cfg(not(unix))]
fn link_dir(target: &Path, link: &Path) -> Result<(), String> {
    copy_dir(target, link)
}

/// Install a .skill file: a copy in each of `dirs`, and in each of `link_dirs` a link to the first copy.
/// All must be skills folders under home. An older copy of the same skill is replaced. Returns where it went.
#[tauri::command]
fn install_skill(app: tauri::AppHandle, path: String, dirs: Vec<String>, link_dirs: Vec<String>, meta: Option<String>) -> Result<Vec<String>, String> {
    // where it came from and which version, kept beside the skill so a newer one can be noticed later
    let meta = meta.filter(|m| !m.is_empty() && m.len() <= 2000 && !m.chars().any(|c| c.is_control()));
    if dirs.is_empty() {
        return Err("No agents to install it into.".into());
    }
    let bases: Vec<PathBuf> = dirs.iter().map(|d| inside_home(&app, d)).collect::<Result<_, _>>()?;
    let links: Vec<PathBuf> = link_dirs.iter().map(|d| inside_home(&app, d)).collect::<Result<_, _>>()?;
    let (root, name) = unpack_skill(&path)?;
    let mut placed = Vec::new();
    for base in &bases {
        let dest = base.join(&name);
        clear(&dest)?;
        copy_dir(&root, &dest)?;
        if let Some(m) = &meta {
            fs::write(dest.join(".toolup.json"), m).map_err(|e| e.to_string())?;
        }
        placed.push(dest.to_string_lossy().into_owned());
    }
    let stored = bases[0].join(&name);
    for base in &links {
        let dest = base.join(&name);
        clear(&dest)?;
        fs::create_dir_all(base).map_err(|e| e.to_string())?;
        link_dir(&stored, &dest)?;
        placed.push(dest.to_string_lossy().into_owned());
    }
    Ok(placed)
}

/// A skill folder: directly inside a folder called `skills`, with a SKILL.md in it.
fn is_skill_dir(path: &Path) -> bool {
    let in_skills = path.parent().and_then(|d| d.file_name()).map(|n| n == "skills").unwrap_or(false);
    in_skills && path.join("SKILL.md").is_file()
}

/// Turn a skill on for more agents: in each of `link_dirs`, a link to the skill folder `target`.
/// Everything must be under home. A folder or link already in the way is left alone and reported.
#[tauri::command]
fn link_skill(app: tauri::AppHandle, target: String, link_dirs: Vec<String>) -> Result<Vec<String>, String> {
    let src = inside_home(&app, &target)?;
    if !is_skill_dir(&src) {
        return Err(format!("{target} is not a skill folder."));
    }
    let Some(name) = src.file_name().map(|n| n.to_os_string()) else {
        return Err(format!("{target} is not a skill folder."));
    };
    let bases: Vec<PathBuf> = link_dirs.iter().map(|d| inside_home(&app, d)).collect::<Result<_, _>>()?;
    let mut placed = Vec::new();
    for base in bases {
        let dest = base.join(&name);
        if dest == src {
            continue;
        }
        if fs::symlink_metadata(&dest).is_ok() {
            return Err(format!("{} is already there.", dest.display()));
        }
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        link_dir(&src, &dest)?;
        placed.push(dest.to_string_lossy().into_owned());
    }
    Ok(placed)
}

/// Take a skill out of an agent's folder without deleting it. The folder is moved to the store
/// (`store_dir`); if the store already holds a skill of that name, the folder goes to the Trash
/// instead, and if that is not possible nothing is changed. Then each of `relink_dirs` gets a link
/// to the stored copy (replacing a link that is there, never a real folder).
#[tauri::command]
fn park_skill(app: tauri::AppHandle, path: String, store_dir: String, relink_dirs: Vec<String>) -> Result<String, String> {
    let src = inside_home(&app, &path)?;
    let is_link = fs::symlink_metadata(&src).map(|m| m.file_type().is_symlink()).unwrap_or(true);
    if is_link || !is_skill_dir(&src) {
        return Err(format!("{path} is not a skill folder."));
    }
    let base = inside_home(&app, &store_dir)?;
    let links: Vec<PathBuf> = relink_dirs.iter().map(|d| inside_home(&app, d)).collect::<Result<_, _>>()?;
    let Some(name) = src.file_name().map(|n| n.to_os_string()) else {
        return Err(format!("{path} is not a skill folder."));
    };
    let dest = base.join(&name);
    if src == dest {
        return Ok(dest.to_string_lossy().into_owned());
    }
    if dest.exists() {
        // a saved copy is already there: this one is a duplicate, and the Trash keeps it recoverable
        let trash = home(&app)?.join(".Trash");
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let parked = trash.join(format!("{} {stamp}", name.to_string_lossy()));
        if !trash.is_dir() || fs::rename(&src, &parked).is_err() {
            return Err("A saved copy already exists and this one could not be moved to the Trash, so nothing was changed.".into());
        }
    } else {
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        if fs::rename(&src, &dest).is_err() {
            // a different disk: copy first, and only then take the original away
            copy_dir(&src, &dest)?;
            fs::remove_dir_all(&src).map_err(|e| format!("It was saved, but {} could not be removed: {e}", src.display()))?;
        }
    }
    for dir in links {
        let link = dir.join(&name);
        match fs::symlink_metadata(&link) {
            Ok(m) if m.file_type().is_symlink() => fs::remove_file(&link).map_err(|e| e.to_string())?,
            Ok(_) => continue,
            Err(_) => fs::create_dir_all(&dir).map_err(|e| e.to_string())?,
        }
        link_dir(&dest, &link)?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct Removed {
    path: String,
    how: &'static str,
}

/// Move a folder to the Trash where there is one; otherwise delete it.
fn trash_or_delete(home: &Path, path: &Path) -> Result<&'static str, String> {
    let trash = home.join(".Trash");
    if cfg!(target_os = "macos") && trash.is_dir() {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let mut dest = trash.join(&name);
        if dest.exists() {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            dest = trash.join(format!("{name} {stamp}"));
        }
        if fs::rename(path, &dest).is_ok() {
            return Ok("trashed");
        }
    }
    fs::remove_dir_all(path).map_err(|e| format!("Could not delete {}: {e}", path.display()))?;
    Ok("deleted")
}

/// Remove skills: each path must sit directly inside a `skills` folder under home, and be a link
/// or a folder with a SKILL.md. Links are removed; folders go to the Trash (or are deleted).
#[tauri::command]
fn remove_skill(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<Removed>, String> {
    let home_dir = home(&app)?;
    let mut targets = Vec::new();
    for p in &paths {
        let path = inside_home(&app, p)?;
        let in_skills = path.parent().and_then(|d| d.file_name()).map(|n| n == "skills").unwrap_or(false);
        let meta = fs::symlink_metadata(&path).map_err(|_| format!("{p} is not there any more."))?;
        let is_link = meta.file_type().is_symlink();
        if !in_skills || !(is_link || is_skill_dir(&path)) {
            return Err(format!("{p} is not a skill folder."));
        }
        targets.push((path, is_link));
    }
    let mut out = Vec::new();
    for (path, is_link) in targets {
        let how = if is_link {
            fs::remove_file(&path).map_err(|e| format!("Could not remove {}: {e}", path.display()))?;
            "unlinked"
        } else {
            trash_or_delete(&home_dir, &path)?
        };
        out.push(Removed { path: path.to_string_lossy().into_owned(), how });
    }
    Ok(out)
}

/// Install catalog items into agents with the Tool up! installer. `to` empty means every agent found.
/// With `dry_run` it only prints what it would do.
#[tauri::command]
async fn toolup(app: tauri::AppHandle, ids: Vec<String>, to: Vec<String>, dry_run: bool) -> Result<RunOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_installer(&app, CATALOG_TSV, ids, to, dry_run, false))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
struct RemoteServer {
    id: String,
    name: String,
    url: String,
}

/// Install remote MCP servers from another catalog. Each is turned into a catalog row for the
/// same installer, so they are added to each agent exactly as a Tool up! server would be.
#[tauri::command]
async fn toolup_servers(app: tauri::AppHandle, servers: Vec<RemoteServer>, to: Vec<String>, dry_run: bool) -> Result<RunOutput, String> {
    let plain = |s: &str, max: usize| !s.is_empty() && s.len() <= max && !s.chars().any(|c| c.is_control() || matches!(c, '"' | '\'' | '\\' | '$' | '`' | '<' | '>'));
    let mut catalog: String = CATALOG_TSV.lines().filter(|l| l.starts_with("agent\t")).map(|l| format!("{l}\n")).collect();
    let mut ids = Vec::new();
    for s in &servers {
        let url_ok = s.url.starts_with("https://") && plain(&s.url, 500) && !s.url.chars().any(char::is_whitespace);
        if !safe_id(&s.id) || !plain(&s.name, 80) || !url_ok {
            return Err(format!("“{}” is not a server Tool up! can add.", s.name));
        }
        catalog.push_str(&format!("mcp\t{}\t{}\thttp\t{}\t-\t-\n", s.id, s.name, s.url));
        ids.push(s.id.clone());
    }
    tauri::async_runtime::spawn_blocking(move || run_installer(&app, &catalog, ids, to, dry_run, false))
        .await
        .map_err(|e| e.to_string())?
}

// The other catalogs the app may ask. Nothing else can be fetched through `fetch_json`.
// api.github.com is asked one thing only: the latest commit of a skill's folder, to see if there is a newer version.
const CATALOG_HOSTS: [&str; 5] = ["skills.sh", "www.skillsdirectory.com", "registry.modelcontextprotocol.io", "api.github.com", "raw.githubusercontent.com"];

/// GET a JSON answer from one of the known catalogs.
#[tauri::command]
async fn fetch_json(url: String, bearer: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let host = url.strip_prefix("https://").and_then(|rest| rest.split(|c| c == '/' || c == '?').next()).unwrap_or("");
        if !CATALOG_HOSTS.contains(&host) || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("That is not a catalog Tool up! knows.".to_string());
        }
        let mut cmd = Command::new("/usr/bin/curl");
        cmd.args(["-fsSL", "--max-time", "20", "-H", "accept: application/json"]);
        if let Some(key) = bearer.filter(|k| !k.is_empty()) {
            if !key.chars().all(|c| c.is_ascii_graphic()) {
                return Err("That API key has characters a key cannot have.".to_string());
            }
            cmd.arg("-H").arg(format!("Authorization: Bearer {key}"));
        }
        let out = cmd.arg(&url).stdin(Stdio::null()).output().map_err(|e| format!("Could not reach the catalog: {e}"))?;
        if !out.status.success() {
            let why = String::from_utf8_lossy(&out.stderr);
            return Err(format!("The catalog did not answer. {}", why.trim().trim_start_matches("curl: ")));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Where a downloaded skill waits to be looked at and installed.
fn staged_root() -> PathBuf {
    std::env::temp_dir().join("toolup-app").join("staged")
}

/// The folder called `skill` with a SKILL.md in it, somewhere under `dir`.
fn find_skill(dir: &Path, skill: &str, depth: u8) -> Option<PathBuf> {
    if depth > 7 {
        return None;
    }
    let dirs: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    let named = |p: &PathBuf, n: &str| p.file_name().map(|f| f == n).unwrap_or(false);
    if let Some(hit) = dirs.iter().find(|p| named(*p, skill) && p.join("SKILL.md").is_file()) {
        return Some(hit.clone());
    }
    dirs.iter()
        .filter(|p| !named(*p, ".git") && !named(*p, "node_modules"))
        .find_map(|p| find_skill(p, skill, depth + 1))
}

#[derive(Serialize)]
struct FetchedSkill {
    /// Where the downloaded skill waits; `inspect_skill` and `install_skill` take it in place of a .skill file.
    staged: String,
    /// The skill's folder inside its repository ("" when the repository is the skill).
    path: String,
}

/// One part of a repo name or of a path inside a repo.
fn safe_part(s: &str) -> bool {
    safe_id(s) && s != "." && s != ".."
}
fn safe_repo(repo: &str) -> bool {
    repo.split('/').count() == 2 && repo.split('/').all(safe_part)
}

/// Download a GitHub repo's current files into a scratch folder and return that folder.
fn download_repo(repo: &str) -> Result<PathBuf, String> {
    let work = std::env::temp_dir().join("toolup-app").join("fetch");
    let _ = fs::remove_dir_all(&work);
    let src = work.join("src");
    fs::create_dir_all(&src).map_err(|e| e.to_string())?;
    let tar = work.join("repo.tar.gz");
    let got = Command::new("/usr/bin/curl")
        .args(["-fsSL", "--max-time", "180", "--max-filesize", "314572800", "-o"])
        .arg(&tar)
        .arg(format!("https://github.com/{repo}/archive/HEAD.tar.gz"))
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    if !got.status.success() {
        return Err(format!("Could not download {repo} from GitHub (it may be private, gone, or very large)."));
    }
    let unpacked = Command::new("/usr/bin/tar")
        .arg("-xzf")
        .arg(&tar)
        .arg("-C")
        .arg(&src)
        .args(["--strip-components", "1"])
        .stdin(Stdio::null())
        .status()
        .map_err(|e| format!("Could not unpack the download: {e}"))?;
    if !unpacked.success() {
        return Err("The download could not be unpacked.".into());
    }
    Ok(src)
}

/// Copy a skill folder found in a downloaded repo to where it waits to be installed.
fn stage_skill(src: &Path, found: &Path, name: &str) -> Result<FetchedSkill, String> {
    let path = found.strip_prefix(src).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let staged = staged_root().join(name);
    clear(&staged)?;
    copy_dir(found, &staged)?;
    Ok(FetchedSkill { staged: staged.to_string_lossy().into_owned(), path })
}

fn fetch_skill_blocking(repo: String, skill: String, hint: String) -> Result<FetchedSkill, String> {
    let hint_ok = hint.is_empty() || hint.split('/').all(safe_part);
    if !safe_repo(&repo) || !safe_part(&skill) || !hint_ok {
        return Err("That is not a GitHub skill Tool up! can fetch.".into());
    }
    let src = download_repo(&repo)?;
    let found = if !hint.is_empty() && src.join(&hint).join("SKILL.md").is_file() {
        src.join(&hint)
    } else if let Some(dir) = find_skill(&src, &skill, 0) {
        dir
    } else if src.join("SKILL.md").is_file() {
        src.clone()
    } else {
        return Err(format!("There is no skill called {skill} in {repo}."));
    };
    let out = stage_skill(&src, &found, &skill);
    let _ = fs::remove_dir_all(src.parent().unwrap_or(&src));
    out
}

/// Download a repo once and stage several of its skills, each given by its folder inside the repo.
fn fetch_skills_blocking(repo: String, paths: Vec<String>) -> Result<Vec<FetchedSkill>, String> {
    if !safe_repo(&repo) || paths.is_empty() || paths.len() > 200 || !paths.iter().all(|p| p.split('/').all(safe_part)) {
        return Err("Those are not skills Tool up! can fetch.".into());
    }
    let src = download_repo(&repo)?;
    let mut out = Vec::new();
    for p in &paths {
        let found = src.join(p);
        if !found.join("SKILL.md").is_file() {
            continue;
        }
        let name = p.rsplit('/').next().unwrap_or(p);
        out.push(stage_skill(&src, &found, name)?);
    }
    let _ = fs::remove_dir_all(src.parent().unwrap_or(&src));
    Ok(out)
}

#[tauri::command]
async fn fetch_skills(repo: String, paths: Vec<String>) -> Result<Vec<FetchedSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_skills_blocking(repo, paths))
        .await
        .map_err(|e| e.to_string())?
}

/// Install a plugin in Claude Code with its own command: add the marketplace (a GitHub repo) if it
/// is not there yet, then install the plugin from it.
fn claude_plugin_blocking(app: &tauri::AppHandle, repo: String, market: String, plugin: String) -> Result<RunOutput, String> {
    if !safe_repo(&repo) || !safe_part(&market) || !safe_part(&plugin) {
        return Err("That is not a plugin Tool up! can install.".into());
    }
    let path = user_path(app);
    let run = |args: &[&str]| -> Result<(i32, String), String> {
        let mut cmd = Command::new("claude");
        cmd.args(args).stdin(Stdio::null());
        if let Some(p) = &path {
            cmd.env("PATH", p);
        }
        let out = cmd.output().map_err(|e| format!("Could not run Claude Code: {e}"))?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        Ok((out.status.code().unwrap_or(-1), text))
    };
    // adding a marketplace that is already there fails harmlessly; the install below is what counts
    let (_, added) = run(&["plugin", "marketplace", "add", &repo])?;
    let (code, installed) = run(&["plugin", "install", &format!("{plugin}@{market}")])?;
    Ok(RunOutput { code, output: format!("{}\n{}", added.trim(), installed.trim()) })
}

/// Add a plugin marketplace to Codex (it reads Claude-style marketplaces). Codex has no documented
/// command to install a plugin without its own /plugins screen, so that last step is the user's.
#[tauri::command]
async fn codex_marketplace(app: tauri::AppHandle, repo: String) -> Result<RunOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !safe_repo(&repo) {
            return Err("That is not a marketplace Tool up! can add.".to_string());
        }
        let mut cmd = Command::new("codex");
        cmd.args(["plugin", "marketplace", "add", &repo]).stdin(Stdio::null());
        if let Some(p) = user_path(&app) {
            cmd.env("PATH", p);
        }
        let out = cmd.output().map_err(|e| format!("Could not run Codex: {e}"))?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        // a marketplace that is already there is not a failure
        let code = if out.status.success() || text.to_lowercase().contains("already") { 0 } else { out.status.code().unwrap_or(-1) };
        Ok(RunOutput { code, output: text.trim().to_string() })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn claude_plugin(app: tauri::AppHandle, repo: String, market: String, plugin: String) -> Result<RunOutput, String> {
    tauri::async_runtime::spawn_blocking(move || claude_plugin_blocking(&app, repo, market, plugin))
        .await
        .map_err(|e| e.to_string())?
}

/// Download one skill from a GitHub repo and stage it. Returns the staged folder, which
/// `inspect_skill` and `install_skill` take in place of a .skill file. Installs nothing.
#[tauri::command]
async fn fetch_skill(repo: String, skill: String, hint: String) -> Result<FetchedSkill, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_skill_blocking(repo, skill, hint))
        .await
        .map_err(|e| e.to_string())?
}

/// Take MCP servers out of agents, by the name each agent knows them by, with the same installer (`--remove`).
/// Names are held to the same plain alphabet as catalog ids; anything else is refused rather than passed on.
#[tauri::command]
async fn toolup_remove(app: tauri::AppHandle, names: Vec<String>, to: Vec<String>) -> Result<RunOutput, String> {
    if to.is_empty() {
        return Err("Say which agent to remove it from.".into());
    }
    tauri::async_runtime::spawn_blocking(move || run_installer(&app, CATALOG_TSV, names, to, false, true))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct TextFile {
    /// Where the file is inside the skill, with forward slashes.
    path: String,
    text: String,
}

/// The readable files of a skill about to be installed (a .skill file or a staged download), for the
/// safety check: scripts, instructions and config, each up to 200 KB, 400 files and 2 MB in all.
#[tauri::command]
fn skill_texts(path: String) -> Result<Vec<TextFile>, String> {
    const TEXT: [&str; 22] = ["md", "txt", "sh", "bash", "zsh", "fish", "py", "js", "mjs", "cjs", "ts", "json", "yaml", "yml", "toml", "rb", "pl", "ps1", "bat", "cmd", "php", "lua"];
    let (root, _) = unpack_skill(&path)?;
    let mut out = Vec::new();
    let mut total = 0usize;
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for e in read.flatten() {
            let Ok(kind) = e.file_type() else { continue };
            let p = e.path();
            if kind.is_dir() {
                if e.file_name() != ".git" && e.file_name() != "node_modules" {
                    stack.push(p);
                }
                continue;
            }
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
            if !kind.is_file() || !(TEXT.contains(&ext.as_str()) || ext.is_empty()) {
                continue;
            }
            let size = e.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
            if size > 200 * 1024 || out.len() >= 400 || total + size as usize > 2 * 1024 * 1024 {
                continue;
            }
            let Ok(text) = fs::read_to_string(&p) else { continue };   // not UTF-8: not text
            total += text.len();
            let rel = p.strip_prefix(&root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            out.push(TextFile { path: rel, text });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

// The only files the app writes text into: an agent's instructions for a project, and a skill's own instructions.
const WRITABLE: [&str; 4] = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "SKILL.md"];

/// Save one of the few files the app writes text into, under home, at most 1 MB:
///   - a file in `WRITABLE`, in a folder that already exists (a SKILL.md only inside a skill folder, one that
///     sits in a folder called `skills`);
///   - a project's own MCP servers: `.mcp.json`, or `mcp.json` in a project's `.cursor` or `.vscode` folder,
///     which is made if the project has none. Never the ones directly in home: those are an agent's own settings.
#[tauri::command]
fn write_text(app: tauri::AppHandle, path: String, text: String) -> Result<(), String> {
    let p = inside_home(&app, &path)?;
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let Some(dir) = p.parent() else {
        return Err("That is not a file Tool up! edits.".into());
    };
    let dir_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let editor_file = name == "mcp.json" && (dir_name == ".cursor" || dir_name == ".vscode");
    let project_servers = (name == ".mcp.json" && dir != home(&app)?) || (editor_file && dir.parent().map(|d| d != home(&app).unwrap_or_default()).unwrap_or(false));
    let in_skill = dir.parent().and_then(|d| d.file_name()).map(|n| n == "skills").unwrap_or(false);
    let instructions = WRITABLE.contains(&name) && (name != "SKILL.md" || in_skill);
    if !(instructions || project_servers) || text.len() > 1024 * 1024 || text.contains('\0') {
        return Err("That is not a file Tool up! edits.".into());
    }
    if editor_file && !dir.is_dir() && dir.parent().map(|d| d.is_dir()).unwrap_or(false) {
        fs::create_dir(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    }
    if !dir.is_dir() {
        return Err("The folder that file belongs in does not exist.".into());
    }
    fs::write(&p, text).map_err(|e| format!("Could not save {}: {e}", p.display()))
}

/// Make an editable copy of a skill: its folder, copied into `store_dir` under a new name, without the note
/// that says where the original came from (so the copy is yours, and is never updated over). Returns the copy.
#[tauri::command]
fn copy_skill(app: tauri::AppHandle, source: String, store_dir: String, name: String) -> Result<String, String> {
    let src = fs::canonicalize(inside_home(&app, &source)?).map_err(|_| "That skill could not be found.".to_string())?;
    let store = inside_home(&app, &store_dir)?;
    let in_skills = store.file_name().map(|n| n == "skills").unwrap_or(false);
    if !src.starts_with(home(&app)?) || !src.join("SKILL.md").is_file() || !in_skills || !safe_part(&name) {
        return Err("That is not a skill Tool up! can copy, or not a usable name (letters, digits, - _ . only).".into());
    }
    let dest = store.join(&name);
    if dest.exists() || dest.symlink_metadata().is_ok() {
        return Err(format!("You already have a skill called {name}."));
    }
    fs::create_dir_all(&store).map_err(|e| e.to_string())?;
    copy_dir(&src, &dest)?;
    let _ = fs::remove_file(dest.join(".toolup.json"));
    Ok(dest.to_string_lossy().into_owned())
}

/// Back up Tool up!'s saved skills to a GitHub repository of the user's, or bring them back from it, with the
/// user's own git and its sign-in. `store_dir` is the folder of saved skills; `remote` a github.com repository.
/// Backing up commits everything there and pushes it; restoring pulls, and never rewrites what is here.
#[tauri::command]
async fn backup_store(app: tauri::AppHandle, store_dir: String, remote: String, restore: bool) -> Result<RunOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = inside_home(&app, &store_dir)?;
        let named = dir.file_name().map(|n| n == "skills").unwrap_or(false) && dir.parent().and_then(|d| d.file_name()).map(|n| n == ".toolup").unwrap_or(false);
        let repo = remote.strip_prefix("https://github.com/").map(|r| r.trim_end_matches(".git").trim_end_matches('/'));
        let Some(repo) = repo.filter(|r| named && safe_repo(r)) else {
            return Err("Give the backup a GitHub repository, as https://github.com/you/your-backup.".to_string());
        };
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let url = format!("https://github.com/{repo}.git");
        let path = user_path(&app);
        let mut log = String::new();
        let mut git = |args: &[&str]| -> Result<bool, String> {
            let mut cmd = Command::new("git");
            cmd.arg("-C").arg(&dir).args(args).stdin(Stdio::null()).env("GIT_TERMINAL_PROMPT", "0");
            if let Some(p) = &path {
                cmd.env("PATH", p);
            }
            let out = cmd.output().map_err(|e| format!("Could not run git: {e}"))?;
            log.push_str(&format!("$ git {}\n{}{}", args.join(" "), String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)));
            Ok(out.status.success())
        };
        if !dir.join(".git").exists() {
            git(&["init", "-q", "-b", "main"])?;
        }
        if !git(&["remote", "set-url", "origin", &url])? {
            git(&["remote", "add", "origin", &url])?;
        }
        let ok = if restore {
            git(&["pull", "--ff-only", "origin", "main"])?
        } else {
            git(&["add", "-A"])?;
            // nothing new to commit is not a failure: the push below still brings the remote up to date
            git(&["-c", "user.name=Tool up!", "-c", "user.email=toolup@localhost", "commit", "-q", "-m", "Tool up! backup"])?;
            git(&["push", "-u", "origin", "main"])?
        };
        Ok(RunOutput { code: if ok { 0 } else { 1 }, output: log })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open Terminal in a project folder (under home) with an agent started on its own `/init`, which reads the
/// project and writes its instructions file. Only these three agents, each with one fixed command; the user
/// sees everything it does and approves what it writes. macOS only.
#[tauri::command]
fn open_terminal(app: tauri::AppHandle, path: String, agent: String) -> Result<(), String> {
    let dir = inside_home(&app, &path)?;
    let run = match agent.as_str() {
        "claude-code" => "claude '/init'",
        "codex" => "codex '/init'",
        "gemini" => "gemini -i '/init'",
        _ => return Err("That agent has no command for this.".into()),
    };
    let shown = dir.to_string_lossy();
    // the folder goes into a shell line inside an AppleScript string: anything that could end either is refused
    if !dir.is_dir() || shown.chars().any(|c| c.is_control() || matches!(c, '\'' | '"' | '\\' | '`' | '$')) {
        return Err("That folder's name has characters Tool up! will not put in a command. Open a terminal there yourself and run the agent's /init.".into());
    }
    if !cfg!(target_os = "macos") {
        return Err("Opening a terminal is only built for macOS so far. Open one in the project and run the agent's /init.".into());
    }
    let script = format!("tell application \"Terminal\"\nactivate\ndo script \"cd '{shown}' && {run}\"\nend tell");
    let out = Command::new("/usr/bin/osascript").arg("-e").arg(script).stdin(Stdio::null()).output().map_err(|e| format!("Could not open Terminal: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("Terminal could not be opened. {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// Let the user choose a folder with the system's own dialog, starting in their home directory.
/// Returns the folder, or nothing when they cancel. Choosing it changes nothing.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let start = home(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().set_directory(start).blocking_pick_folder();
        Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The toolup:// links the app was started with, if any (a link opened while it runs arrives as a "deep-link" event).
#[tauri::command]
fn start_links(app: tauri::AppHandle) -> Vec<String> {
    app.deep_link().get_current().ok().flatten().map(|urls| urls.iter().map(|u| u.to_string()).collect()).unwrap_or_default()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // a toolup:// link opened while the app runs: hand it to the window, which decides what it asks for
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                let _ = handle.emit("deep-link", urls);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![home_dir, read_text, list_dir, path_exists, reveal_path, open_url, on_path, toolup, inspect_skill, install_skill, link_skill, park_skill, remove_skill, toolup_servers, fetch_json, fetch_skill, fetch_skills, claude_plugin, codex_marketplace, toolup_remove, skill_texts, write_text, copy_skill, backup_store, start_links, pick_folder, open_terminal])
        .run(tauri::generate_context!())
        .expect("error while running Tool up!");
}
