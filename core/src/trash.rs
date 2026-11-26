//! Корзина сборок: `trash/<id>-<время>/` — папка удалённой сборки (миры и скриншоты в ней —
//! только ссылки, сами они остаются в `worlds/` и `screenshots/`). Сборку можно вернуть целиком;
//! через `trash_days` (настройка, 1–60 дней) папка удаляется сама, рецепт остаётся в истории.
//! Решения владельца 26.11.2026, см. docs/plans/worlds-trash-history.md.

use crate::error::{Error, IoContext, Result};
use crate::instance::{Instance, InstanceStore};
use serde::Serialize;
use std::path::PathBuf;

/// Удалённая сборка в корзине.
#[derive(Debug, Clone, Serialize)]
pub struct TrashEntry {
    /// Имя папки в корзине — по нему возвращают и удаляют.
    pub key: String,
    pub id: String,
    pub name: String,
    pub game_version: String,
    pub loader: crate::loader::LoaderKind,
    /// Когда удалили (unix, секунды).
    pub deleted_at: u64,
    pub size: u64,
}

/// Время удаления из имени папки `<id>-<время>`.
fn deleted_at(key: &str) -> Option<u64> {
    key.rsplit_once('-').and_then(|(_, t)| t.parse().ok())
}

fn entry_dir(store: &InstanceStore, key: &str) -> Result<PathBuf> {
    if !crate::paths::is_plain_file_name(key) {
        return Err(Error::invalid("Недопустимое имя в корзине"));
    }
    let dir = store.data().trash().join(key);
    if !dir.join("instance.toml").is_file() {
        return Err(Error::NotFound(format!("В корзине нет «{key}»")));
    }
    Ok(dir)
}

fn read_instance(dir: &std::path::Path) -> Option<Instance> {
    let text = std::fs::read_to_string(dir.join("instance.toml")).ok()?;
    toml::from_str(&text).ok()
}

/// Сборки в корзине, недавно удалённые первыми.
pub fn list(store: &InstanceStore) -> Vec<TrashEntry> {
    let Ok(rd) = std::fs::read_dir(store.data().trash()) else {
        return Vec::new();
    };
    let mut out: Vec<TrashEntry> = rd
        .flatten()
        .filter_map(|e| {
            let key = e.file_name().to_string_lossy().into_owned();
            let inst = read_instance(&e.path())?;
            Some(TrashEntry {
                deleted_at: deleted_at(&key).unwrap_or(0),
                size: crate::paths::dir_size(&e.path()),
                key,
                id: inst.id,
                name: inst.name,
                game_version: inst.game_version,
                loader: inst.loader,
            })
        })
        .collect();
    out.sort_by_key(|e| std::cmp::Reverse(e.deleted_at));
    out
}

/// Вернуть сборку из корзины. Если её id уже занят, она получает новый, а её миры, скриншоты
/// и бэкапы переезжают вместе с ней.
pub fn restore(store: &InstanceStore, key: &str) -> Result<Instance> {
    let dir = entry_dir(store, key)?;
    let mut inst =
        read_instance(&dir).ok_or_else(|| Error::invalid("instance.toml в корзине не прочитан"))?;
    let data = store.data();
    let old = inst.id.clone();
    let mut id = old.clone();
    let mut n = 2;
    while data.instances().join(&id).exists() {
        id = format!("{old}-{n}");
        n += 1;
    }
    let target = data.instances().join(&id);
    std::fs::create_dir_all(data.instances()).at(data.instances())?;
    std::fs::rename(&dir, &target).at(&dir)?;
    if id != old {
        for base in [data.worlds(), data.screenshots(), data.backups()] {
            let (from, to) = (base.join(&old), base.join(&id));
            if from.exists() && !to.exists() {
                let _ = std::fs::rename(&from, &to);
            }
        }
        inst.id = id.clone();
        store.save(&inst)?;
    }
    let game = store.game_dir(&id)?;
    crate::worlds::ensure_store(
        data,
        &id,
        &game,
        inst.external_game_dir.is_some(),
        &inst.name,
    );
    store.get(&id)
}

/// Удалить папку сборки из корзины навсегда. Миры остаются в `worlds/`, рецепт — в истории.
pub fn delete_forever(store: &InstanceStore, key: &str) -> Result<()> {
    let dir = entry_dir(store, key)?;
    // Ссылки saves/screenshots удаляются как ссылки: то, на что они указывают, не трогается.
    std::fs::remove_dir_all(&dir).at(&dir)
}

/// Удалить из корзины всё, что лежит дольше `days` дней. Возвращает, сколько удалено.
pub fn purge_expired(store: &InstanceStore, days: u32, now: u64) -> usize {
    let limit = u64::from(days.clamp(1, 60)) * 86_400;
    list(store)
        .into_iter()
        .filter(|e| e.deleted_at > 0 && now.saturating_sub(e.deleted_at) > limit)
        .filter(|e| delete_forever(store, &e.key).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loader::LoaderKind;

    fn tmp_store(tag: &str) -> InstanceStore {
        let root = std::env::temp_dir().join(format!("axel-trash-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        InstanceStore::new(crate::paths::DataDir::open(&root).unwrap())
    }

    #[test]
    fn delete_and_restore_keeps_everything() {
        let store = tmp_store("restore");
        let a = store
            .create("Тест", "26.3", LoaderKind::Vanilla, None)
            .unwrap();
        let game = store.game_dir(&a.id).unwrap();
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(game.join("mods/x.jar"), b"jar").unwrap();
        std::fs::create_dir_all(game.join("saves/W")).unwrap();
        std::fs::write(game.join("saves/W/level.dat"), b"lvl").unwrap();
        store.trash(&a.id).unwrap();
        let t = list(&store);
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].name, "Тест");
        let back = restore(&store, &t[0].key).unwrap();
        assert_eq!(back.id, a.id);
        let game = store.game_dir(&back.id).unwrap();
        assert!(game.join("mods/x.jar").is_file());
        assert!(game.join("saves/W/level.dat").is_file(), "миры снова видны");
        assert!(list(&store).is_empty());
        let _ = std::fs::remove_dir_all(store.data().root());
    }

    #[test]
    fn restore_with_taken_id_moves_worlds_along() {
        let store = tmp_store("taken");
        let a = store
            .create("Тест", "26.3", LoaderKind::Vanilla, None)
            .unwrap();
        store.trash(&a.id).unwrap();
        // Хранилище миров пустое — новая сборка может занять тот же id.
        let b = store
            .create("Тест", "26.3", LoaderKind::Vanilla, None)
            .unwrap();
        assert_eq!(b.id, a.id);
        let key = list(&store)[0].key.clone();
        let back = restore(&store, &key).unwrap();
        assert_ne!(back.id, b.id);
        assert_eq!(
            store.get(&back.id).unwrap().id,
            back.id,
            "id в instance.toml обновлён"
        );
        let _ = std::fs::remove_dir_all(store.data().root());
    }

    #[test]
    fn forever_and_expiry_keep_worlds() {
        let store = tmp_store("forever");
        let a = store
            .create("Тест", "26.3", LoaderKind::Vanilla, None)
            .unwrap();
        let game = store.game_dir(&a.id).unwrap();
        std::fs::create_dir_all(game.join("saves/W")).unwrap();
        std::fs::write(game.join("saves/W/level.dat"), b"lvl").unwrap();
        store.trash(&a.id).unwrap();
        let e = list(&store).remove(0);
        assert_eq!(
            purge_expired(&store, 30, e.deleted_at + 86_400),
            0,
            "свежая сборка не удаляется"
        );
        assert_eq!(purge_expired(&store, 30, e.deleted_at + 31 * 86_400), 1);
        assert!(list(&store).is_empty());
        assert!(
            crate::worlds::store_dir(store.data(), &a.id)
                .join("W/level.dat")
                .is_file(),
            "миры пережили удаление навсегда"
        );
        assert!(delete_forever(&store, "../x").is_err());
        let _ = std::fs::remove_dir_all(store.data().root());
    }
}
