//! Миры профиля: данные из level.dat, бэкапы и восстановление, проверка совместимости версии.
//! Версия мира сравнивается по числу DataVersion (как это делает сама игра), а не по строке:
//! версия игры берётся из `version.json` внутри клиентского JAR (`world_version`).

use crate::error::{Error, IoContext, Result};
use crate::nbt;
use crate::paths::safe_join;
use crate::snapshot::{self, WorldBackup};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct WorldInfo {
    /// Имя папки в saves/.
    pub folder: String,
    /// Название мира из level.dat.
    pub name: String,
    pub version_name: Option<String>,
    pub data_version: Option<i64>,
    pub game_mode: String,
    pub hardcore: bool,
    /// Когда в мире играли последний раз (Unix-время, секунды).
    pub last_played: u64,
    pub size: u64,
    pub backups: Vec<WorldBackup>,
}

/// Сведения о версии игры из клиентского JAR.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GameJarInfo {
    pub world_version: Option<i64>,
    /// Формат ресурспаков (с 1.21.9 — старшая часть `resource_major`).
    pub resource_pack_format: Option<i64>,
    pub data_pack_format: Option<i64>,
}

pub fn game_jar_info(client_jar: &Path) -> Result<GameJarInfo> {
    let file = std::fs::File::open(client_jar).at(client_jar)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| Error::parse("клиент игры", e))?;
    let mut e = zip
        .by_name("version.json")
        .map_err(|_| Error::invalid("В клиенте игры нет version.json"))?;
    let mut s = String::new();
    e.read_to_string(&mut s).at(client_jar)?;
    let v: serde_json::Value =
        serde_json::from_str(&s).map_err(|e| Error::parse("version.json клиента", e))?;
    let pv = v.get("pack_version");
    let (res, data) = match pv {
        Some(serde_json::Value::Number(n)) => (n.as_i64(), n.as_i64()),
        Some(o) => (
            o.get("resource_major")
                .or_else(|| o.get("resource"))
                .and_then(|x| x.as_i64()),
            o.get("data_major")
                .or_else(|| o.get("data"))
                .and_then(|x| x.as_i64()),
        ),
        None => (None, None),
    };
    Ok(GameJarInfo {
        world_version: v.get("world_version").and_then(|x| x.as_i64()),
        resource_pack_format: res,
        data_pack_format: data,
    })
}

fn mode_name(v: i64) -> &'static str {
    match v {
        0 => "выживание",
        1 => "творчество",
        2 => "приключение",
        3 => "наблюдатель",
        _ => "неизвестно",
    }
}

/// Бэкапы мира в папке бэкапов профиля (`<мир>-<время>.zip`), новые первыми.
pub fn backups_of(backups_dir: &Path, world: &str) -> Vec<WorldBackup> {
    let prefix = format!("{world}-");
    let mut out: Vec<WorldBackup> = std::fs::read_dir(backups_dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let ts = name.strip_prefix(&prefix)?.strip_suffix(".zip")?;
                    let created_at: u64 = ts.parse().ok()?;
                    Some(WorldBackup {
                        world: world.to_string(),
                        size: e.metadata().map(|m| m.len()).unwrap_or(0),
                        file: e.path(),
                        created_at,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    out
}

pub fn read_world(game_dir: &Path, backups_dir: &Path, folder: &str) -> Result<WorldInfo> {
    read_world_at(&game_dir.join("saves"), backups_dir, folder)
}

/// То же, но мир ищется прямо в папке миров (`saves` или хранилище сборки).
fn read_world_at(saves: &Path, backups_dir: &Path, folder: &str) -> Result<WorldInfo> {
    let dir = saves.join(folder);
    let level = dir.join("level.dat");
    let root = nbt::read(&std::fs::read(&level).at(&level)?)?;
    let data = root
        .get("Data")
        .ok_or_else(|| Error::parse("level.dat", "нет раздела Data"))?;
    Ok(WorldInfo {
        folder: folder.to_string(),
        name: data
            .get("LevelName")
            .and_then(|t| t.as_str())
            .unwrap_or(folder)
            .to_string(),
        version_name: data
            .path("Version.Name")
            .and_then(|t| t.as_str())
            .map(str::to_string),
        data_version: data
            .get("DataVersion")
            .and_then(|t| t.as_i64())
            .or_else(|| data.path("Version.Id").and_then(|t| t.as_i64())),
        game_mode: mode_name(data.get("GameType").and_then(|t| t.as_i64()).unwrap_or(-1))
            .to_string(),
        hardcore: data.get("hardcore").and_then(|t| t.as_i64()).unwrap_or(0) != 0,
        last_played: data
            .get("LastPlayed")
            .and_then(|t| t.as_i64())
            .map(|ms| (ms / 1000).max(0) as u64)
            .unwrap_or(0),
        size: crate::paths::dir_size(&dir),
        backups: backups_of(backups_dir, folder),
    })
}

/// Все миры профиля, недавние первыми. Мир с повреждённым level.dat показывается с пометкой.
pub fn list(game_dir: &Path, backups_dir: &Path) -> Vec<WorldInfo> {
    let mut out: Vec<WorldInfo> = std::fs::read_dir(game_dir.join("saves"))
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().join("level.dat").is_file())
                .map(|e| {
                    let folder = e.file_name().to_string_lossy().into_owned();
                    read_world(game_dir, backups_dir, &folder).unwrap_or_else(|_| WorldInfo {
                        name: folder.clone(),
                        folder,
                        version_name: None,
                        data_version: None,
                        game_mode: "level.dat не прочитан".into(),
                        hardcore: false,
                        last_played: 0,
                        size: crate::paths::dir_size(&e.path()),
                        backups: Vec::new(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|w| std::cmp::Reverse(w.last_played));
    out
}

/// Восстановить мир из бэкапа. Текущий мир не удаляется: сначала он сам бэкапится,
/// затем откладывается в `<папка игры>/.axel-replaced/` — на тот же диск, что и мир
/// (папку игры могли перенести на другой диск, а rename между дисками не работает).
pub fn restore(game_dir: &Path, backups_dir: &Path, backup_file: &Path) -> Result<String> {
    let backup_file = std::fs::canonicalize(backup_file).at(backup_file)?;
    let base = std::fs::canonicalize(backups_dir).at(backups_dir)?;
    if backup_file.parent() != Some(base.as_path()) {
        return Err(Error::invalid("Бэкап не из папки бэкапов этой сборки"));
    }
    let file = std::fs::File::open(&backup_file).at(&backup_file)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| Error::parse("бэкап мира", e))?;
    // Все записи начинаются с «<мир>/».
    let world = {
        let first = zip.by_index(0).map_err(|e| Error::parse("бэкап мира", e))?;
        first
            .name()
            .unwrap_or_default()
            .split('/')
            .next()
            .unwrap_or_default()
            .to_string()
    };
    if world.is_empty() || world.starts_with('.') || world.contains(['\\', ':']) {
        return Err(Error::invalid("Бэкап повреждён"));
    }
    let saves = game_dir.join("saves");
    std::fs::create_dir_all(&saves).at(&saves)?;
    let staging = crate::paths::unique_sibling(&saves.join(&world), "restore");
    // Оборвавшаяся распаковка не должна оставить в saves/ полмира, который игра покажет.
    if let Err(e) = unpack_world(&mut zip, &world, &staging, &backup_file) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    let current = saves.join(&world);
    if current.exists() {
        snapshot::backup_world(game_dir, backups_dir, &world)?;
        // Рядом с настоящей папкой миров: saves может быть ссылкой в хранилище на другом диске.
        let real_saves = std::fs::canonicalize(&saves).at(&saves)?;
        let replaced = real_saves
            .parent()
            .unwrap_or(game_dir)
            .join(".axel-replaced");
        std::fs::create_dir_all(&replaced).at(&replaced)?;
        let aside = replaced.join(format!("{world}-{}", crate::instance::now()));
        std::fs::rename(&current, &aside).at(&current)?;
    }
    std::fs::rename(&staging, &current).at(&staging)?;
    Ok(world)
}

fn unpack_world(
    zip: &mut zip::ZipArchive<std::fs::File>,
    world: &str,
    staging: &Path,
    backup_file: &Path,
) -> Result<()> {
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(|e| Error::parse("бэкап мира", e))?;
        let name = e.name().unwrap_or_default().to_string();
        let Some(rel) = name.strip_prefix(&format!("{world}/")) else {
            return Err(Error::invalid("В бэкапе файлы разных миров"));
        };
        if e.is_dir() || rel.is_empty() {
            continue;
        }
        let target = safe_join(staging, rel)
            .ok_or_else(|| Error::invalid(format!("Недопустимый путь в бэкапе: {name}")))?;
        if let Some(p) = target.parent() {
            std::fs::create_dir_all(p).at(p)?;
        }
        let mut buf = Vec::new();
        e.read_to_end(&mut buf).at(backup_file)?;
        std::fs::write(&target, buf).at(&target)?;
    }
    Ok(())
}

/// Миры, сохранённые в более новой версии игры, чем запускаемая.
pub fn newer_than(worlds: &[WorldInfo], game_world_version: i64) -> Vec<&WorldInfo> {
    worlds
        .iter()
        .filter(|w| w.data_version.is_some_and(|v| v > game_world_version))
        .collect()
}

/// Пора ли делать бэкап по расписанию: раз в `every_days` дней, если в мир играли после
/// последнего бэкапа. `every_days == 0` — расписание выключено.
pub fn backup_due(w: &WorldInfo, every_days: u32, now: u64) -> bool {
    if every_days == 0 {
        return false;
    }
    match w.backups.iter().map(|b| b.created_at).max() {
        None => w.last_played > 0,
        Some(last) => {
            now.saturating_sub(last) >= u64::from(every_days) * 86_400 && w.last_played > last
        }
    }
}

/// Бэкап последнего мира, в который играли (если есть). Для автобэкапов.
pub fn backup_latest(game_dir: &Path, backups_dir: &Path) -> Option<WorldBackup> {
    let worlds = list(game_dir, backups_dir);
    let latest = worlds.first()?;
    snapshot::backup_world(game_dir, backups_dir, &latest.folder).ok()
}

pub fn backups_dir(data: &crate::paths::DataDir, instance_id: &str) -> PathBuf {
    data.backups().join(instance_id)
}

// ── Миры и скриншоты вне папки сборки ──────────────────────────────────────────────────────
//
// Миры сборки лежат в `<данные>/worlds/<id>/`, скриншоты — в `<данные>/screenshots/<id>/`.
// В папке игры `saves` и `screenshots` — ссылки туда (на Windows — junction: прав администратора
// не нужно). Игра ничего не замечает, а удаление сборки (в корзину уезжает только ссылка) миры
// не трогает. Решение владельца 26.11.2026, см. docs/plans/worlds-trash-history.md.

/// Папки игры, которые живут вне сборки, и где их хранилище.
fn linked_dirs(data: &crate::paths::DataDir, instance_id: &str) -> [(&'static str, PathBuf); 2] {
    [
        ("saves", data.worlds().join(instance_id)),
        ("screenshots", data.screenshots().join(instance_id)),
    ]
}

/// Хранилище миров сборки (существует, даже если сборку удалили).
pub fn store_dir(data: &crate::paths::DataDir, instance_id: &str) -> PathBuf {
    data.worlds().join(instance_id)
}

pub(crate) fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) || is_junction(p)
}

#[cfg(windows)]
fn is_junction(p: &Path) -> bool {
    junction::exists(p).unwrap_or(false)
}
#[cfg(not(windows))]
fn is_junction(_: &Path) -> bool {
    false
}

#[cfg(windows)]
fn make_link(target: &Path, link: &Path) -> std::io::Result<()> {
    junction::create(target, link)
}
#[cfg(not(windows))]
fn make_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

/// Убрать саму ссылку, не трогая то, на что она указывает.
fn remove_link(p: &Path) -> std::io::Result<()> {
    std::fs::remove_dir(p).or_else(|_| std::fs::remove_file(p))
}

fn is_empty_dir(p: &Path) -> bool {
    std::fs::read_dir(p).is_ok_and(|mut r| r.next().is_none())
}

/// Свободное имя в папке: `Мир`, `Мир (Сборка)`, `Мир (Сборка 2)`…
pub fn free_name(dir: &Path, name: &str, label: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    (1..)
        .map(|n| {
            if n == 1 {
                dir.join(format!("{name} ({label})"))
            } else {
                dir.join(format!("{name} ({label} {n})"))
            }
        })
        .find(|p| !p.exists())
        .expect("бесконечный ряд имён")
}

/// Линейка версий игры: миры внутри неё совместимы. `1.16.5` → `1.16`, `26.3.1` → `26.3`;
/// снапшоты и прочее — как есть.
pub fn version_line(version: &str) -> String {
    let parts: Vec<&str> = version.split('.').collect();
    let numeric = parts
        .iter()
        .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    if numeric && parts.len() >= 2 {
        parts[..2].join(".")
    } else {
        version.to_string()
    }
}

/// Сравнить линейки: `Less` — первая старше. Нечисловые (снапшоты) несравнимы.
fn line_order(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    let key = |s: &str| -> Option<Vec<u64>> { s.split('.').map(|p| p.parse().ok()).collect() };
    Some(key(a)?.cmp(&key(b)?))
}

/// Мир из хранилища другой сборки (живой или удалённой), который можно перенести сюда.
#[derive(Debug, Clone, Serialize)]
pub struct ForeignWorld {
    /// Сборка, где мир лежит сейчас (id папки хранилища).
    pub owner_id: String,
    /// Её название; `None` — сборку удалили, а мир остался.
    pub owner_name: Option<String>,
    /// Загрузчик той сборки и сколько в ней модов — чтобы предупредить о модах.
    pub owner_loader: Option<String>,
    /// Мир из более старой линейки: игра его обновит, назад он уже не откроется.
    pub older: bool,
    pub world: WorldInfo,
}

/// Миры других сборок, которые подходят этой: той же линейки или старше. Миры новее не
/// показываются — игра старой версии их не откроет.
pub fn foreign_worlds(
    store: &crate::instance::InstanceStore,
    target_id: &str,
    target_version: &str,
) -> Vec<ForeignWorld> {
    let data = store.data();
    let line = version_line(target_version);
    let Ok(owners) = std::fs::read_dir(data.worlds()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for owner in owners.flatten() {
        let owner_id = owner.file_name().to_string_lossy().into_owned();
        if owner_id == target_id || owner_id.starts_with('.') || !owner.path().is_dir() {
            continue;
        }
        let inst = store.get(&owner_id).ok();
        let backups = backups_dir(data, &owner_id);
        for w in std::fs::read_dir(owner.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            let folder = w.file_name().to_string_lossy().into_owned();
            if !w.path().join("level.dat").is_file() {
                continue;
            }
            let Ok(info) = read_world_at(&owner.path(), &backups, &folder) else {
                continue;
            };
            // Совсем старые миры (до 1.9) не пишут версию — считаем их старыми.
            let wline = info.version_name.as_deref().map(version_line);
            let older = match wline.as_deref() {
                Some(l) if l == line => false,
                Some(l) => match line_order(l, &line) {
                    Some(std::cmp::Ordering::Less) => true,
                    _ => continue,
                },
                None => true,
            };
            out.push(ForeignWorld {
                owner_id: owner_id.clone(),
                owner_name: inst.as_ref().map(|i| i.name.clone()),
                owner_loader: inst.as_ref().map(|i| format!("{:?}", i.loader)),
                older,
                world: info,
            });
        }
    }
    out.sort_by_key(|f| (f.older, std::cmp::Reverse(f.world.last_played)));
    out
}

/// Перенести мир из хранилища другой сборки в эту и сразу сделать бэкап (на случай, если моды
/// этой сборки или новая версия игры его испортят). Возвращает имя папки мира здесь.
pub fn adopt_world(
    store: &crate::instance::InstanceStore,
    from_id: &str,
    folder: &str,
    to_id: &str,
) -> Result<String> {
    if !crate::paths::is_plain_file_name(folder) {
        return Err(Error::invalid("Недопустимое имя мира"));
    }
    crate::instance::validate_id(from_id)?;
    let data = store.data();
    let to = store.get(to_id)?;
    let game = store.game_dir(to_id)?;
    ensure_store(data, to_id, &game, to.external_game_dir.is_some(), &to.name);
    let src = store_dir(data, from_id).join(folder);
    if !src.join("level.dat").is_file() {
        return Err(Error::NotFound(format!("Мир «{folder}» не найден")));
    }
    let label = store
        .get(from_id)
        .map(|i| i.name)
        .unwrap_or_else(|_| from_id.to_string());
    let saves = std::fs::canonicalize(game.join("saves")).at(game.join("saves"))?;
    let dest = free_name(&saves, folder, &label);
    std::fs::rename(&src, &dest).at(&src)?;
    let name = dest
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    snapshot::backup_world(&game, &backups_dir(data, to_id), &name)?;
    Ok(name)
}

/// Привести `saves` и `screenshots` сборки к ссылкам в общее хранилище. Безопасно вызывать
/// сколько угодно раз: при старте лаунчера, перед запуском, после создания и возврата сборки.
/// `external` — папка игры вне Axel' (официальный лаунчер, другой диск): там настоящие папки не
/// трогаем, ставим ссылку, только если папки нет, а в хранилище уже что-то лежит.
/// `label` — название сборки, для имён при совпадении.
pub fn ensure_store(
    data: &crate::paths::DataDir,
    instance_id: &str,
    game_dir: &Path,
    external: bool,
    label: &str,
) {
    for (name, store) in linked_dirs(data, instance_id) {
        let _ = ensure_linked(&game_dir.join(name), &store, external, label);
    }
}

fn ensure_linked(dir: &Path, store: &Path, external: bool, label: &str) -> Result<()> {
    if is_link(dir) {
        let same =
            std::fs::canonicalize(dir).ok() == std::fs::canonicalize(store).ok() && store.is_dir();
        if same {
            return Ok(());
        }
        // Ссылка ведёт не туда: папку данных перенесли или переименовали.
        remove_link(dir).at(dir)?;
    } else if dir.is_dir() {
        if external {
            return Ok(());
        }
        move_into_store(dir, store, label)?;
    } else if external && (!store.is_dir() || is_empty_dir(store)) {
        return Ok(());
    }
    std::fs::create_dir_all(store).at(store)?;
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).at(parent)?;
    }
    if let Err(e) = make_link(store, dir) {
        // Ссылку поставить нельзя (например, файловая система без ссылок): возвращаем всё как было.
        if !dir.exists() {
            let _ = std::fs::rename(store, dir);
        }
        return Err(Error::io(dir, e));
    }
    Ok(())
}

/// Перенести настоящую папку в хранилище. Тот же диск — одним переименованием; если в хранилище
/// уже что-то есть — по одному элементу, совпадающие имена получают суффикс с названием сборки.
/// Оборвалось на полпути — при следующем вызове продолжится с оставшегося.
fn move_into_store(dir: &Path, store: &Path, label: &str) -> Result<()> {
    if let Some(parent) = store.parent() {
        std::fs::create_dir_all(parent).at(parent)?;
    }
    if !store.exists() || is_empty_dir(store) {
        let _ = std::fs::remove_dir(store);
        if std::fs::rename(dir, store).is_ok() {
            return Ok(());
        }
    }
    std::fs::create_dir_all(store).at(store)?;
    for e in std::fs::read_dir(dir).at(dir)?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let to = free_name(store, &name, label);
        std::fs::rename(e.path(), &to).at(e.path())?;
    }
    std::fs::remove_dir(dir).at(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nbt::Tag;
    use std::collections::BTreeMap;
    use std::io::Write;

    pub fn make_world(game: &Path, folder: &str, name: &str, data_version: i32, last_played: i64) {
        let dir = game.join("saves").join(folder);
        std::fs::create_dir_all(dir.join("region")).unwrap();
        std::fs::write(dir.join("region/r.0.0.mca"), vec![1u8; 1000]).unwrap();
        let mut data = BTreeMap::new();
        data.insert("LevelName".to_string(), Tag::String(name.into()));
        data.insert("DataVersion".to_string(), Tag::Int(data_version));
        data.insert("GameType".to_string(), Tag::Int(1));
        data.insert("LastPlayed".to_string(), Tag::Long(last_played));
        let mut v = BTreeMap::new();
        v.insert("Name".to_string(), Tag::String("1.21.11".into()));
        data.insert("Version".to_string(), Tag::Compound(v));
        let mut root = BTreeMap::new();
        root.insert("Data".to_string(), Tag::Compound(data));
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&nbt::write(&Tag::Compound(root))).unwrap();
        std::fs::write(dir.join("level.dat"), gz.finish().unwrap()).unwrap();
    }

    #[test]
    fn list_restore_and_version_check() {
        let root = std::env::temp_dir().join(format!("axel-worlds-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (game, backups) = (root.join("game"), root.join("backups"));
        make_world(&game, "W1", "База у реки", 4671, 2_000_000_000_000);
        make_world(&game, "W2", "Старый", 2586, 1_000_000_000_000);
        let ws = list(&game, &backups);
        assert_eq!(ws[0].name, "База у реки", "недавний первым");
        assert_eq!(ws[0].game_mode, "творчество");
        assert!(ws[0].size >= 1000);
        assert_eq!(newer_than(&ws, 2586).len(), 1);

        let b = snapshot::backup_world(&game, &backups, "W1").unwrap();
        std::fs::write(game.join("saves/W1/region/r.0.0.mca"), b"broken").unwrap();
        assert_eq!(restore(&game, &backups, &b.file).unwrap(), "W1");
        assert_eq!(
            std::fs::metadata(game.join("saves/W1/region/r.0.0.mca"))
                .unwrap()
                .len(),
            1000
        );
        // Испорченная версия не пропала: забэкаплена и отложена на том же диске, что и мир.
        assert!(game.join(".axel-replaced").read_dir().unwrap().count() == 1);
        assert!(restore(&game, &backups, &root.join("elsewhere.zip")).is_err());
        assert!(backup_latest(&game, &backups).is_some());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn broken_backup_leaves_no_half_world() {
        let root = std::env::temp_dir().join(format!("axel-worlds-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (game, backups) = (root.join("game"), root.join("backups"));
        make_world(&game, "W1", "Мир", 4671, 1);
        std::fs::create_dir_all(&backups).unwrap();
        let bad = backups.join("W1-bad.zip");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&bad).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        z.start_file("W1/level.dat", opts).unwrap();
        z.write_all(b"x").unwrap();
        z.start_file("W1/../../evil", opts).unwrap();
        z.write_all(b"x").unwrap();
        z.finish().unwrap();
        assert!(restore(&game, &backups, &bad).is_err());
        let leftovers: Vec<_> = std::fs::read_dir(game.join("saves"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n != "W1")
            .collect();
        assert!(leftovers.is_empty(), "в saves остались {leftovers:?}");
        assert!(!root.join("evil").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn jar_info_both_formats() {
        let root = std::env::temp_dir().join(format!("axel-jarinfo-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        for (name, json, res) in [
            (
                "new.jar",
                r#"{"id":"26.3","world_version":5023,"pack_version":{"resource_major":97,"resource_minor":1,"data_major":121,"data_minor":0}}"#,
                97,
            ),
            (
                "old.jar",
                r#"{"id":"1.16.5","world_version":2586,"pack_version":6}"#,
                6,
            ),
        ] {
            let p = root.join(name);
            crate::mods::meta::tests::make_jar(&p, &[("version.json", json.as_bytes())]);
            let i = game_jar_info(&p).unwrap();
            assert_eq!(i.resource_pack_format, Some(res));
            assert!(i.world_version.is_some());
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn world(last_played: u64, backups: &[u64]) -> WorldInfo {
        WorldInfo {
            folder: "W".into(),
            name: "W".into(),
            version_name: None,
            data_version: None,
            game_mode: String::new(),
            hardcore: false,
            last_played,
            size: 0,
            backups: backups
                .iter()
                .map(|&t| WorldBackup {
                    world: "W".into(),
                    file: PathBuf::new(),
                    size: 0,
                    created_at: t,
                })
                .collect(),
        }
    }

    #[test]
    fn scheduled_backup_is_due_only_for_played_worlds() {
        let day = 86_400;
        let now = 100 * day;
        // Расписание выключено.
        assert!(!backup_due(&world(now, &[]), 0, now));
        // Бэкапов нет, в мир играли — пора.
        assert!(backup_due(&world(now - 10, &[]), 3, now));
        // Последний бэкап свежий.
        assert!(!backup_due(&world(now - 10, &[now - day]), 3, now));
        // Бэкап старый, и после него в мир играли.
        assert!(backup_due(&world(now - 10, &[now - 4 * day]), 3, now));
        // Бэкап старый, но в мир с тех пор не заходили — копировать нечего.
        assert!(!backup_due(&world(now - 5 * day, &[now - 4 * day]), 3, now));
    }

    fn tmp_data(tag: &str) -> crate::paths::DataDir {
        let root = std::env::temp_dir().join(format!("axel-store-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        crate::paths::DataDir::open(&root).unwrap()
    }

    #[test]
    fn existing_worlds_move_into_the_store() {
        let data = tmp_data("move");
        let game = data.instances().join("tech/game");
        make_world(&game, "W1", "Мой мир", 3700, 1);
        std::fs::create_dir_all(game.join("screenshots")).unwrap();
        std::fs::write(game.join("screenshots/a.png"), b"png").unwrap();
        ensure_store(&data, "tech", &game, false, "Технология+");
        assert!(is_link(&game.join("saves")), "saves стала ссылкой");
        assert!(
            store_dir(&data, "tech").join("W1/level.dat").is_file(),
            "мир в хранилище"
        );
        assert!(
            game.join("saves/W1/level.dat").is_file(),
            "игра видит мир по ссылке"
        );
        assert!(data.screenshots().join("tech/a.png").is_file());
        assert_eq!(list(&game, &data.backups()).len(), 1);
        // Повторный вызов ничего не ломает.
        ensure_store(&data, "tech", &game, false, "Технология+");
        assert!(game.join("saves/W1/level.dat").is_file());
        let _ = std::fs::remove_dir_all(data.root());
    }

    #[test]
    fn same_names_get_the_build_name() {
        let data = tmp_data("merge");
        let game = data.instances().join("tech/game");
        std::fs::create_dir_all(store_dir(&data, "tech").join("Новый мир")).unwrap();
        std::fs::create_dir_all(game.join("saves/Новый мир")).unwrap();
        ensure_store(&data, "tech", &game, false, "Технология+");
        assert!(store_dir(&data, "tech").join("Новый мир").is_dir());
        assert!(
            store_dir(&data, "tech")
                .join("Новый мир (Технология+)")
                .is_dir()
        );
        let _ = std::fs::remove_dir_all(data.root());
    }

    #[test]
    fn wrong_link_is_fixed_and_external_folders_are_left_alone() {
        let data = tmp_data("relink");
        let game = data.instances().join("tech/game");
        let elsewhere = data.root().join("old-store");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::create_dir_all(&game).unwrap();
        make_link(&elsewhere, &game.join("saves")).unwrap();
        ensure_store(&data, "tech", &game, false, "T");
        assert_eq!(
            std::fs::canonicalize(game.join("saves")).unwrap(),
            std::fs::canonicalize(store_dir(&data, "tech")).unwrap()
        );
        assert!(elsewhere.is_dir(), "то, на что вела ссылка, не удалено");
        // Папка официального лаунчера: настоящие saves остаются на месте.
        let official = data.root().join(".minecraft");
        make_world(&official, "W", "Мир", 3700, 1);
        ensure_store(&data, "official", &official, true, "Официальный");
        assert!(!is_link(&official.join("saves")));
        assert!(official.join("saves/W/level.dat").is_file());
        assert!(
            !official.join("screenshots").exists(),
            "лишних ссылок в чужой папке нет"
        );
        let _ = std::fs::remove_dir_all(data.root());
    }

    #[test]
    fn new_build_does_not_take_worlds_of_a_deleted_one() {
        let data = tmp_data("reuse");
        let store = crate::instance::InstanceStore::new(data.clone());
        let a = store
            .create("Тест", "26.3", crate::loader::LoaderKind::Vanilla, None)
            .unwrap();
        let game = store.game_dir(&a.id).unwrap();
        make_world(&game, "W", "Мир", 3700, 1);
        store.trash(&a.id).unwrap();
        assert!(
            store_dir(&data, &a.id).join("W/level.dat").is_file(),
            "мир пережил удаление"
        );
        let b = store
            .create("Тест", "26.3", crate::loader::LoaderKind::Vanilla, None)
            .unwrap();
        assert_ne!(a.id, b.id);
        assert!(list(&store.game_dir(&b.id).unwrap(), &data.backups()).is_empty());
        let _ = std::fs::remove_dir_all(data.root());
    }

    #[test]
    fn version_lines() {
        assert_eq!(version_line("1.16.5"), "1.16");
        assert_eq!(version_line("1.16"), "1.16");
        assert_eq!(version_line("26.3.1"), "26.3");
        assert_eq!(version_line("26.4-snapshot-2"), "26.4-snapshot-2");
        assert_eq!(line_order("1.12", "1.16"), Some(std::cmp::Ordering::Less));
        assert_eq!(
            line_order("26.3", "1.21"),
            Some(std::cmp::Ordering::Greater)
        );
    }

    #[test]
    fn worlds_of_other_builds_can_be_moved_here() {
        let data = tmp_data("adopt");
        let store = crate::instance::InstanceStore::new(data.clone());
        let old = store
            .create("Старая", "1.21.10", crate::loader::LoaderKind::Fabric, None)
            .unwrap();
        let new = store
            .create("Новая", "1.21.11", crate::loader::LoaderKind::Vanilla, None)
            .unwrap();
        // make_world пишет версию 1.21.11 — та же линейка 1.21.
        make_world(&store.game_dir(&old.id).unwrap(), "W", "Мир", 4000, 5);
        store.trash(&old.id).unwrap();
        let found = foreign_worlds(&store, &new.id, "1.21.11");
        assert_eq!(found.len(), 1, "мир удалённой сборки виден");
        assert!(found[0].owner_name.is_none() && !found[0].older);
        // Сборка 1.20 этот мир (1.21) не видит: он новее.
        assert!(foreign_worlds(&store, &new.id, "1.20.1").is_empty());
        let name = adopt_world(&store, &old.id, "W", &new.id).unwrap();
        assert_eq!(name, "W");
        let game = store.game_dir(&new.id).unwrap();
        assert!(game.join("saves/W/level.dat").is_file());
        assert_eq!(
            list(&game, &backups_dir(&data, &new.id))[0].backups.len(),
            1,
            "сразу бэкап"
        );
        assert!(foreign_worlds(&store, &new.id, "1.21.11").is_empty());
        let _ = std::fs::remove_dir_all(data.root());
    }
}
