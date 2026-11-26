//! История сборок: рецепт сборки после каждого изменения — версия игры и загрузчика, моды,
//! ресурспаки и шейдеры с источником и точной версией, настройки модов (config), options.txt и
//! параметры сборки. Хранится вечно, даже если сборку удалили: по рецепту её можно вернуть.
//! Файлы без источника (положенные вручную) и конфиги копируются в `history/blobs/<sha1>` —
//! одинаковые хранятся один раз. Решения владельца 26.11.2026, docs/plans/worlds-trash-history.md.
//!
//! Раскладка: `history/<id сборки>/<время>.json` — записи; `history/<id>/hashes.json` — кеш
//! SHA-1 по (путь, размер, время изменения), чтобы не перечитывать сотни мегабайт модов.

use crate::download::{self, Cancel, Expected, Task, Verify};
use crate::error::{Error, IoContext, Result};
use crate::instance::{Instance, InstanceStore};
use crate::metadata::sha1_hex;
use crate::mods::lock::{Layer, LockEntry, PackLock, Source};
use crate::paths::{DataDir, write_atomic};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Папки игры, файлы которых входят в рецепт.
const CONTENT_DIRS: [&str; 3] = ["mods", "resourcepacks", "shaderpacks"];
/// Конфиги крупнее этого не копируются (у некоторых модов в config лежат кеши).
const MAX_CONFIG: u64 = 1024 * 1024;

/// Откуда файл и как его скачать снова.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileSource {
    pub source: Source,
    pub project_id: String,
    pub version_id: Option<String>,
    pub version_number: Option<String>,
    pub title: Option<String>,
    #[serde(default = "user_layer")]
    pub layer: Layer,
}

fn user_layer() -> Layer {
    Layer::User
}

/// Мод, ресурспак или шейдер в рецепте.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecipeFile {
    /// Путь в папке игры через `/`, как есть (выключенный мод — с `.disabled`).
    pub path: String,
    pub sha1: String,
    pub size: u64,
    /// Есть источник — при возврате скачивается; нет — лежит копией в blobs.
    pub from: Option<FileSource>,
}

/// Рецепт сборки на момент времени.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipe {
    pub at: u64,
    /// Параметры сборки (без времени последнего запуска и внешней папки игры).
    pub instance: Instance,
    pub files: Vec<RecipeFile>,
    /// Настройки: путь → SHA-1 (содержимое — в blobs).
    pub configs: BTreeMap<String, String>,
}

impl Recipe {
    /// Одинаковы ли рецепты, не считая времени записи.
    fn same_as(&self, other: &Recipe) -> bool {
        serde_json::to_value(&self.instance).ok() == serde_json::to_value(&other.instance).ok()
            && self.files == other.files
            && self.configs == other.configs
    }
}

fn root(data: &DataDir) -> PathBuf {
    data.root().join("history")
}

fn blobs(data: &DataDir) -> PathBuf {
    root(data).join("blobs")
}

fn dir_of(data: &DataDir, id: &str) -> Result<PathBuf> {
    crate::instance::validate_id(id)?;
    Ok(root(data).join(id))
}

/// Кеш SHA-1: путь → (размер, время изменения в наносекундах, sha1).
type HashCache = BTreeMap<String, (u64, u64, String)>;

fn sha1_cached(cache: &mut HashCache, key: &str, path: &Path) -> Result<(String, u64)> {
    let meta = std::fs::metadata(path).at(path)?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        // Наносекунды: файл, переписанный в ту же секунду и того же размера, — тоже изменение.
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    if let Some((size, m, h)) = cache.get(key)
        && *size == meta.len()
        && *m == mtime
    {
        return Ok((h.clone(), *size));
    }
    let h = sha1_hex(&std::fs::read(path).at(path)?);
    cache.insert(key.to_string(), (meta.len(), mtime, h.clone()));
    Ok((h, meta.len()))
}

/// Положить файл в blobs (если такого содержимого ещё нет).
fn keep_blob(data: &DataDir, sha1: &str, path: &Path) -> Result<()> {
    let dest = blobs(data).join(sha1);
    if dest.is_file() {
        return Ok(());
    }
    write_atomic(&dest, &std::fs::read(path).at(path)?)
}

fn walk_configs(dir: &Path, base: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            walk_configs(&p, base, out);
        } else if ft.is_file() && e.metadata().is_ok_and(|m| m.len() <= MAX_CONFIG) {
            let rel = p
                .strip_prefix(base)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push((rel, p));
        }
    }
}

/// Собрать рецепт сборки сейчас (и сложить нужные копии в blobs).
pub fn build(store: &InstanceStore, id: &str) -> Result<Recipe> {
    let data = store.data();
    let mut inst = store.get(id)?;
    inst.last_launch = None;
    let game = store.game_dir(id)?;
    let lock = PackLock::load(&store.dir(id)?).unwrap_or_default();
    let cache_path = dir_of(data, id)?.join("hashes.json");
    let mut cache: HashCache = std::fs::read_to_string(&cache_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();

    let mut files = Vec::new();
    for folder in CONTENT_DIRS {
        let Ok(rd) = std::fs::read_dir(game.join(folder)) else {
            continue;
        };
        let mut entries: Vec<_> = rd.flatten().filter(|e| e.path().is_file()).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let rel = format!("{folder}/{}", e.file_name().to_string_lossy());
            let (sha1, size) = sha1_cached(&mut cache, &rel, &e.path())?;
            // Источник — из pack.lock (по пути без «.disabled» или по хэшу).
            let plain = rel.trim_end_matches(".disabled");
            let from = lock
                .files
                .iter()
                .find(|l| l.path == plain || l.path == rel || l.sha1.eq_ignore_ascii_case(&sha1))
                .filter(|l| matches!(l.source, Source::Modrinth | Source::CurseForge))
                .and_then(|l| {
                    Some(FileSource {
                        source: l.source,
                        project_id: l.project_id.clone()?,
                        version_id: l.version_id.clone(),
                        version_number: l.version_number.clone(),
                        title: l.title.clone(),
                        layer: l.layer,
                    })
                });
            if from.is_none() {
                keep_blob(data, &sha1, &e.path())?;
            }
            files.push(RecipeFile {
                path: rel,
                sha1,
                size,
                from,
            });
        }
    }

    let mut configs = BTreeMap::new();
    let mut cfg = Vec::new();
    walk_configs(&game.join("config"), &game, &mut cfg);
    if let Ok(rd) = std::fs::read_dir(&game) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with("options") && name.ends_with(".txt") && e.path().is_file() {
                cfg.push((name, e.path()));
            }
        }
    }
    for (rel, path) in cfg {
        let (sha1, _) = sha1_cached(&mut cache, &rel, &path)?;
        keep_blob(data, &sha1, &path)?;
        configs.insert(rel, sha1);
    }
    let _ = write_atomic(
        &cache_path,
        serde_json::to_string(&cache).unwrap_or_default().as_bytes(),
    );
    Ok(Recipe {
        at: crate::instance::now(),
        instance: inst,
        files,
        configs,
    })
}

/// Записи истории сборки (время), старые первыми.
pub fn entries(data: &DataDir, id: &str) -> Vec<u64> {
    let Ok(dir) = dir_of(data, id) else {
        return Vec::new();
    };
    let mut out: Vec<u64> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .strip_suffix(".json")?
                        .parse()
                        .ok()
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_unstable();
    out
}

pub fn read(data: &DataDir, id: &str, at: u64) -> Result<Recipe> {
    let path = dir_of(data, id)?.join(format!("{at}.json"));
    serde_json::from_str(&std::fs::read_to_string(&path).at(&path)?)
        .map_err(|e| Error::parse("запись истории", e))
}

/// Записать рецепт, если сборка изменилась с прошлой записи. `Some(время)` — новая запись.
pub fn record(store: &InstanceStore, id: &str) -> Result<Option<u64>> {
    let data = store.data();
    let recipe = build(store, id)?;
    if let Some(last) = entries(data, id).last()
        && let Ok(prev) = read(data, id, *last)
        && prev.same_as(&recipe)
    {
        return Ok(None);
    }
    let mut at = recipe.at;
    // Две записи в одну секунду — вторая на секунду позже.
    while dir_of(data, id)?.join(format!("{at}.json")).exists() {
        at += 1;
    }
    let recipe = Recipe { at, ..recipe };
    let path = dir_of(data, id)?.join(format!("{at}.json"));
    write_atomic(
        &path,
        serde_json::to_string_pretty(&recipe)
            .map_err(|e| Error::parse("запись истории", e))?
            .as_bytes(),
    )?;
    Ok(Some(at))
}

// ── Что изменилось ──────────────────────────────────────────────────────────────────────

/// Одно изменение между соседними записями — для карты истории.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Change {
    /// Сборка появилась в истории (первая запись).
    Created {
        files: usize,
    },
    Added {
        folder: String,
        title: String,
        version: Option<String>,
    },
    Removed {
        folder: String,
        title: String,
    },
    Updated {
        folder: String,
        title: String,
        from: Option<String>,
        to: Option<String>,
    },
    Enabled {
        title: String,
    },
    Disabled {
        title: String,
    },
    Configs {
        changed: usize,
    },
    Game {
        from: String,
        to: String,
    },
    Loader {
        from: String,
        to: String,
    },
    Renamed {
        from: String,
        to: String,
    },
    Settings,
}

/// Чем файл узнаётся между записями: проект источника или имя без «.disabled».
fn identity(f: &RecipeFile) -> String {
    let folder = f.path.split('/').next().unwrap_or("");
    match &f.from {
        Some(s) => format!("{folder}/{}", s.project_id),
        None => f.path.trim_end_matches(".disabled").to_string(),
    }
}

fn title(f: &RecipeFile) -> String {
    f.from
        .as_ref()
        .and_then(|s| s.title.clone())
        .unwrap_or_else(|| {
            f.path
                .rsplit('/')
                .next()
                .unwrap_or(&f.path)
                .trim_end_matches(".disabled")
                .to_string()
        })
}

fn version_of(f: &RecipeFile) -> Option<String> {
    f.from.as_ref().and_then(|s| s.version_number.clone())
}

fn folder_of(f: &RecipeFile) -> String {
    f.path.split('/').next().unwrap_or("").to_string()
}

pub fn diff(prev: Option<&Recipe>, cur: &Recipe) -> Vec<Change> {
    let Some(prev) = prev else {
        return vec![Change::Created {
            files: cur.files.len(),
        }];
    };
    let mut out = Vec::new();
    let (a, b) = (&prev.instance, &cur.instance);
    if a.name != b.name {
        out.push(Change::Renamed {
            from: a.name.clone(),
            to: b.name.clone(),
        });
    }
    if a.game_version != b.game_version {
        out.push(Change::Game {
            from: a.game_version.clone(),
            to: b.game_version.clone(),
        });
    }
    let loader = |i: &Instance| {
        format!(
            "{:?} {}",
            i.loader,
            i.loader_version.clone().unwrap_or_default()
        )
    };
    if a.loader != b.loader || a.loader_version != b.loader_version {
        out.push(Change::Loader {
            from: loader(a).trim().to_string(),
            to: loader(b).trim().to_string(),
        });
    }
    let old: BTreeMap<String, &RecipeFile> = prev.files.iter().map(|f| (identity(f), f)).collect();
    let new: BTreeMap<String, &RecipeFile> = cur.files.iter().map(|f| (identity(f), f)).collect();
    for (k, f) in &new {
        match old.get(k) {
            None => out.push(Change::Added {
                folder: folder_of(f),
                title: title(f),
                version: version_of(f),
            }),
            Some(o) => {
                if o.sha1 != f.sha1 {
                    out.push(Change::Updated {
                        folder: folder_of(f),
                        title: title(f),
                        from: version_of(o),
                        to: version_of(f),
                    });
                } else if o.path.ends_with(".disabled") != f.path.ends_with(".disabled") {
                    out.push(if f.path.ends_with(".disabled") {
                        Change::Disabled { title: title(f) }
                    } else {
                        Change::Enabled { title: title(f) }
                    });
                }
            }
        }
    }
    for (k, f) in &old {
        if !new.contains_key(k) {
            out.push(Change::Removed {
                folder: folder_of(f),
                title: title(f),
            });
        }
    }
    let changed = prev
        .configs
        .iter()
        .filter(|(p, h)| cur.configs.get(*p) != Some(*h))
        .count()
        + cur
            .configs
            .keys()
            .filter(|p| !prev.configs.contains_key(*p))
            .count();
    if changed > 0 {
        out.push(Change::Configs { changed });
    }
    // Прочие параметры сборки (память, Java, вход, заметка…).
    let rest = |i: &Instance| {
        let mut i = i.clone();
        i.name = String::new();
        i.game_version = String::new();
        i.loader_version = None;
        serde_json::to_value(i).ok()
    };
    if a.loader == b.loader && rest(a) != rest(b) {
        out.push(Change::Settings);
    }
    out
}

/// Запись истории для карты: время и что изменилось по сравнению с предыдущей.
#[derive(Debug, Clone, Serialize)]
pub struct Point {
    pub at: u64,
    pub changes: Vec<Change>,
    pub mods: usize,
}

/// Вся история сборки для карты.
pub fn timeline(data: &DataDir, id: &str) -> Vec<Point> {
    let mut prev: Option<Recipe> = None;
    let mut out = Vec::new();
    for at in entries(data, id) {
        let Ok(r) = read(data, id, at) else { continue };
        out.push(Point {
            at,
            changes: diff(prev.as_ref(), &r),
            mods: r
                .files
                .iter()
                .filter(|f| f.path.starts_with("mods/"))
                .count(),
        });
        prev = Some(r);
    }
    out
}

/// Сборка в истории — для фильтра «История» на вкладке «Сборки».
#[derive(Debug, Clone, Serialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub game_version: String,
    pub loader: crate::loader::LoaderKind,
    pub entries: usize,
    pub last_at: u64,
    /// Сборка есть сейчас (не удалена).
    pub alive: bool,
}

pub fn items(store: &InstanceStore) -> Vec<Item> {
    let data = store.data();
    let Ok(rd) = std::fs::read_dir(root(data)) else {
        return Vec::new();
    };
    let mut out: Vec<Item> = rd
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().into_owned();
            if id == "blobs" {
                return None;
            }
            let list = entries(data, &id);
            let last = *list.last()?;
            let r = read(data, &id, last).ok()?;
            Some(Item {
                alive: store.get(&id).is_ok(),
                name: r.instance.name,
                game_version: r.instance.game_version,
                loader: r.instance.loader,
                entries: list.len(),
                last_at: last,
                id,
            })
        })
        .collect();
    out.sort_by_key(|i| (i.alive, std::cmp::Reverse(i.last_at)));
    out
}

// ── Возврат ─────────────────────────────────────────────────────────────────────────────

/// Итог возврата: новая сборка и чего вернуть не удалось.
#[derive(Debug, Clone, Serialize)]
pub struct Restored {
    pub instance: Instance,
    /// Названия файлов, которых больше нет у источника и нет копии.
    pub missing: Vec<String>,
}

/// Откуда скачать файл рецепта.
async fn url_for(f: &FileSource, sha1: &str) -> Option<String> {
    let version = f.version_id.as_deref()?;
    match f.source {
        Source::Modrinth => {
            let v = crate::catalog::version(version).await.ok()?;
            v.files
                .iter()
                .find(|x| {
                    x.hashes
                        .get("sha1")
                        .is_some_and(|h| h.eq_ignore_ascii_case(sha1))
                })
                .or_else(|| v.primary_file())
                .map(|x| x.url.clone())
        }
        Source::CurseForge => {
            let file =
                crate::curseforge::file_by_id(f.project_id.parse().ok()?, version.parse().ok()?)
                    .await
                    .ok()?;
            file.download_url
        }
        _ => None,
    }
}

/// Вернуть сборку из записи истории. Удалённая сборка возвращается под прежним id (и снова
/// видит свои миры); живая — копией «Название (дата)», текущая не трогается.
pub async fn restore(
    store: &InstanceStore,
    id: &str,
    at: u64,
    cancel: &Cancel,
) -> Result<Restored> {
    let data = store.data();
    let recipe = read(data, id, at)?;
    let mut inst = recipe.instance.clone();
    inst.last_launch = None;
    inst.external_game_dir = None;
    inst.archived = false;
    if data.instances().join(id).exists() {
        let fresh = store.create(
            &format!("{} ({})", inst.name, crate::instance::date_label(at)),
            &inst.game_version,
            inst.loader,
            inst.loader_version.clone(),
        )?;
        inst.id = fresh.id;
        inst.name = fresh.name;
        inst.created_at = fresh.created_at;
    } else {
        std::fs::create_dir_all(data.instances().join(id).join("game"))
            .at(data.instances().join(id))?;
        inst.id = id.to_string();
    }
    store.save(&inst)?;
    let game = store.game_dir(&inst.id)?;
    crate::worlds::ensure_store(data, &inst.id, &game, false, &inst.name);

    let mut tasks = Vec::new();
    let mut lock = PackLock::default();
    let mut missing = Vec::new();
    for f in &recipe.files {
        let dest = crate::paths::safe_join(&game, &f.path)
            .ok_or_else(|| Error::invalid(format!("Недопустимый путь в истории: {}", f.path)))?;
        let blob = blobs(data).join(&f.sha1);
        if blob.is_file() {
            if let Some(p) = dest.parent() {
                std::fs::create_dir_all(p).at(p)?;
            }
            std::fs::copy(&blob, &dest).at(&dest)?;
            continue;
        }
        let Some(src) = &f.from else {
            missing.push(title(f));
            continue;
        };
        match url_for(src, &f.sha1).await {
            Some(url) => {
                tasks.push(Task {
                    url,
                    dest,
                    expected: Expected::Sha1(f.sha1.clone()),
                    size: Some(f.size),
                });
                lock.upsert(LockEntry {
                    path: f.path.trim_end_matches(".disabled").to_string(),
                    sha1: f.sha1.clone(),
                    sha512: None,
                    source: src.source,
                    project_id: Some(src.project_id.clone()),
                    version_id: src.version_id.clone(),
                    version_number: src.version_number.clone(),
                    title: src.title.clone(),
                    layer: src.layer,
                    installed_at: crate::instance::now(),
                    pinned: false,
                });
            }
            None => missing.push(title(f)),
        }
    }
    download::download_all(tasks, 8, Verify::Quick, None, cancel).await?;
    lock.save(&store.dir(&inst.id)?)?;
    for (rel, sha1) in &recipe.configs {
        let blob = blobs(data).join(sha1);
        let Some(dest) = crate::paths::safe_join(&game, rel) else {
            continue;
        };
        if blob.is_file() {
            if let Some(p) = dest.parent() {
                std::fs::create_dir_all(p).at(p)?;
            }
            std::fs::copy(&blob, &dest).at(&dest)?;
        }
    }
    let _ = record(store, &inst.id);
    Ok(Restored {
        instance: store.get(&inst.id)?,
        missing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loader::LoaderKind;

    fn tmp_store(tag: &str) -> InstanceStore {
        let root = std::env::temp_dir().join(format!("axel-hist-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        InstanceStore::new(DataDir::open(&root).unwrap())
    }

    fn put(store: &InstanceStore, id: &str, rel: &str, body: &[u8]) {
        let p = store.game_dir(id).unwrap().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn records_only_real_changes_and_explains_them() {
        let store = tmp_store("rec");
        let a = store
            .create("Моды", "26.3", LoaderKind::Fabric, Some("0.19".into()))
            .unwrap();
        put(&store, &a.id, "mods/own.jar", b"jar-1");
        put(&store, &a.id, "config/x.toml", b"a = 1");
        assert!(record(&store, &a.id).unwrap().is_some());
        assert!(
            record(&store, &a.id).unwrap().is_none(),
            "без изменений — без записи"
        );
        put(&store, &a.id, "mods/own.jar", b"jar-2");
        put(&store, &a.id, "mods/extra.jar", b"jar-3");
        put(&store, &a.id, "config/x.toml", b"a = 2");
        assert!(record(&store, &a.id).unwrap().is_some());
        let t = timeline(store.data(), &a.id);
        assert_eq!(t.len(), 2);
        assert!(matches!(t[0].changes[0], Change::Created { files: 1 }));
        let ch = &t[1].changes;
        assert!(
            ch.iter()
                .any(|c| matches!(c, Change::Added { title, .. } if title == "extra.jar")),
            "{ch:?}"
        );
        assert!(
            ch.iter()
                .any(|c| matches!(c, Change::Updated { title, .. } if title == "own.jar")),
            "{ch:?}"
        );
        assert!(ch.contains(&Change::Configs { changed: 1 }), "{ch:?}");
        let _ = std::fs::remove_dir_all(store.data().root());
    }

    #[tokio::test]
    async fn deleted_build_comes_back_with_files_and_worlds() {
        let store = tmp_store("back");
        let a = store
            .create("Своя", "26.3", LoaderKind::Fabric, Some("0.19".into()))
            .unwrap();
        put(&store, &a.id, "mods/own.jar", b"jar");
        put(&store, &a.id, "mods/off.jar.disabled", b"off");
        put(&store, &a.id, "options.txt", b"fov:80");
        put(&store, &a.id, "saves/W/level.dat", b"lvl");
        let at = record(&store, &a.id).unwrap().unwrap();
        store.trash(&a.id).unwrap();
        // Корзину очистили — сборки на диске нет совсем.
        let key = crate::trash::list(&store)[0].key.clone();
        crate::trash::delete_forever(&store, &key).unwrap();
        assert!(!items(&store)[0].alive);
        let r = restore(&store, &a.id, at, &Cancel::new()).await.unwrap();
        assert_eq!(r.instance.id, a.id, "прежний id — миры снова свои");
        assert!(r.missing.is_empty());
        let game = store.game_dir(&a.id).unwrap();
        assert_eq!(std::fs::read(game.join("mods/own.jar")).unwrap(), b"jar");
        assert!(
            game.join("mods/off.jar.disabled").is_file(),
            "выключенный мод остался выключенным"
        );
        assert_eq!(
            std::fs::read_to_string(game.join("options.txt")).unwrap(),
            "fov:80"
        );
        assert!(game.join("saves/W/level.dat").is_file(), "миры на месте");
        // Живую сборку возвращаем копией, текущую не трогаем.
        let copy = restore(&store, &a.id, at, &Cancel::new()).await.unwrap();
        assert_ne!(copy.instance.id, a.id);
        let _ = std::fs::remove_dir_all(store.data().root());
    }
}
