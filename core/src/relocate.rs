//! Смена папки данных. По умолчанию данные лежат в `~/.quarry`; другую папку игрок выбирает в
//! «Настройках» или в мастере первого запуска. Где лежат данные, записано в маленьком файле в
//! системной папке настроек (`%APPDATA%\Axel`, `~/Library/Application Support/Axel`,
//! `~/.config/axel`): саму папку данных лаунчер должен найти ещё до того, как её откроет.

use crate::error::{Error, IoContext, Result};
use crate::paths::{DataDir, dir_size, free_space, write_atomic};
use std::path::{Path, PathBuf};

/// Запас места сверх размера данных при копировании на другой диск.
const SPARE: u64 = 200 * 1024 * 1024;

/// Файл, где записан путь к папке данных.
pub fn pointer_file() -> Option<PathBuf> {
    let dir = if cfg!(any(windows, target_os = "macos")) {
        "Axel"
    } else {
        "axel"
    };
    dirs::config_dir().map(|c| c.join(dir).join("data-dir.txt"))
}

/// Папка данных: из файла-указателя или по умолчанию. Если записанной папки нет (например,
/// внешний диск не подключён), берём папку по умолчанию, а не создаём пустую на месте диска.
pub fn resolve_root() -> Option<PathBuf> {
    pointer_file()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| p.is_absolute() && p.is_dir())
        .or_else(DataDir::default_root)
}

/// Запомнить папку данных. Папка по умолчанию — указатель просто удаляется.
pub fn remember(root: &Path) -> Result<()> {
    let Some(file) = pointer_file() else {
        return Err(Error::invalid("Не удалось найти системную папку настроек"));
    };
    if DataDir::default_root().as_deref() == Some(root) {
        return match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(Error::io(&file, e)),
            _ => Ok(()),
        };
    }
    write_atomic(&file, root.display().to_string().as_bytes())
}

/// Что получится, если выбрать эту папку.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Check {
    /// Куда на самом деле лягут данные: выбранная папка или папка «Axel» внутри неё.
    pub target: PathBuf,
    /// Там уже есть данные Axel': можно перейти на них без переноса.
    pub has_data: bool,
    /// Сколько занимают текущие данные.
    pub size: u64,
    /// Свободно на диске выбранной папки.
    pub free: Option<u64>,
}

fn is_data_dir(p: &Path) -> bool {
    p.join("launcher.toml").is_file() || p.join("instances").is_dir()
}

fn is_empty_dir(p: &Path) -> bool {
    std::fs::read_dir(p).is_ok_and(|mut r| r.next().is_none())
}

/// Путь без `..` и ссылок — чтобы честно сравнить «внутри ли одна папка другой».
fn real(p: &Path) -> PathBuf {
    // У ещё не созданной папки настоящий путь считаем по ближайшей существующей папке выше.
    let mut tail = Vec::new();
    let mut cur = p.to_path_buf();
    loop {
        if let Ok(r) = cur.canonicalize() {
            return tail.into_iter().rev().fold(r, |acc, part| acc.join(part));
        }
        match (cur.file_name().map(|n| n.to_os_string()), cur.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name);
                cur = parent.to_path_buf();
            }
            _ => return p.to_path_buf(),
        }
    }
}

/// Проверить выбранную папку. Пустая или новая — данные лягут прямо в неё; непустая чужая —
/// в папку «Axel» внутри (чтобы не смешивать данные с чужими файлами).
pub fn check(current: &Path, chosen: &Path) -> Result<Check> {
    if !chosen.is_absolute() {
        return Err(Error::invalid("Нужен полный путь к папке"));
    }
    let target = if !chosen.exists() || is_empty_dir(chosen) || is_data_dir(chosen) {
        chosen.to_path_buf()
    } else {
        chosen.join("Axel")
    };
    if target.exists() && !target.is_dir() {
        return Err(Error::invalid("По этому пути лежит файл, а не папка"));
    }
    let (cur, tgt) = (real(current), real(&target));
    if cur == tgt {
        return Err(Error::invalid("Данные уже лежат в этой папке"));
    }
    if tgt.starts_with(&cur) || cur.starts_with(&tgt) {
        return Err(Error::invalid(
            "Новая папка не может быть внутри текущей папки данных, и наоборот",
        ));
    }
    let has_data = is_data_dir(&target);
    if target.exists() && !has_data && !is_empty_dir(&target) {
        return Err(Error::invalid(format!(
            "Папка {} уже занята другими файлами. Выберите пустую папку.",
            target.display()
        )));
    }
    Ok(Check {
        has_data,
        size: dir_size(current),
        free: free_space(&target),
        target,
    })
}

/// Как сменить папку.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Перенести текущие данные в новую папку.
    Move,
    /// Начать с пустой папки; старые данные остаются на месте.
    Empty,
    /// В новой папке уже есть данные Axel' — просто перейти на них.
    UseExisting,
}

/// Сменить папку данных. `progress(готово, всего)` — байты при копировании на другой диск.
/// Лаунчер после этого нужно перезапустить: открытая `DataDir` смотрит на старую папку.
pub fn relocate(
    current: &Path,
    target: &Path,
    mode: Mode,
    progress: &dyn Fn(u64, u64),
) -> Result<()> {
    match mode {
        Mode::UseExisting if !is_data_dir(target) => {
            return Err(Error::invalid("В этой папке нет данных Axel'"));
        }
        Mode::UseExisting => {}
        Mode::Empty => std::fs::create_dir_all(target).at(target)?,
        Mode::Move => move_data(current, target, progress)?,
    }
    remember(target)
}

fn move_data(from: &Path, to: &Path, progress: &dyn Fn(u64, u64)) -> Result<()> {
    if is_data_dir(to) || (to.exists() && !is_empty_dir(to)) {
        return Err(Error::invalid("Папка для переноса должна быть пустой"));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).at(parent)?;
    }
    // Тот же диск: переименование, мгновенно. Пустую папку назначения rename не заменит везде.
    let _ = std::fs::remove_dir(to);
    if std::fs::rename(from, to).is_ok() {
        rewrite_paths(to, from);
        return Ok(());
    }
    // Другой диск: копируем, а старое удаляем только после того, как всё скопировалось.
    let total = dir_size(from);
    if let Some(free) = free_space(to)
        && free < total + SPARE
    {
        return Err(Error::invalid(format!(
            "На диске не хватает места: нужно {} МБ, свободно {} МБ",
            (total + SPARE) / 1024 / 1024,
            free / 1024 / 1024
        )));
    }
    let mut done = 0;
    if let Err(e) = copy_tree(from, to, &mut done, total, progress) {
        // Недокопированное убираем, чтобы следующая попытка начиналась с пустой папки.
        let _ = std::fs::remove_dir_all(to);
        return Err(e);
    }
    rewrite_paths(to, from);
    // Занятые файлы (например, открытый лог) могут не удалиться — копия уже на месте, это не страшно.
    let _ = std::fs::remove_dir_all(from);
    Ok(())
}

fn copy_tree(
    from: &Path,
    to: &Path,
    done: &mut u64,
    total: u64,
    progress: &dyn Fn(u64, u64),
) -> Result<()> {
    std::fs::create_dir_all(to).at(to)?;
    for e in std::fs::read_dir(from).at(from)? {
        let e = e.at(from)?;
        let (src, dst) = (e.path(), to.join(e.file_name()));
        let ft = e.file_type().at(&src)?;
        if ft.is_dir() {
            copy_tree(&src, &dst, done, total, progress)?;
        } else if ft.is_file() {
            *done += std::fs::copy(&src, &dst).at(&dst)?;
            progress(*done, total);
        }
    }
    Ok(())
}

/// В настройках могут быть полные пути внутрь папки данных (Java из `runtimes/`, папка игры
/// профиля). После переноса они указывают в старое место — заменяем начало пути на новое.
fn rewrite_paths(root: &Path, old: &Path) {
    let (old_s, new_s) = (old.display().to_string(), root.display().to_string());
    if old_s.is_empty() {
        return;
    }
    // В TOML обратная косая черта (пути Windows) записана удвоенной.
    let pairs = [
        (old_s.replace('\\', "\\\\"), new_s.replace('\\', "\\\\")),
        (old_s, new_s),
    ];
    let mut files = vec![root.join("launcher.toml")];
    if let Ok(rd) = std::fs::read_dir(root.join("instances")) {
        files.extend(rd.flatten().map(|e| e.path().join("instance.toml")));
    }
    for f in files {
        let Ok(text) = std::fs::read_to_string(&f) else {
            continue;
        };
        let mut out = text.clone();
        for (a, b) in &pairs {
            out = out.replace(a.as_str(), b);
        }
        if out != text {
            let _ = write_atomic(&f, out.as_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("axel-reloc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    fn data(root: &Path) {
        std::fs::create_dir_all(root.join("instances/a")).unwrap();
        let java = root.join("runtimes/java-21/bin/java").display().to_string();
        std::fs::write(
            root.join("launcher.toml"),
            format!("java_path = {}\n", toml::Value::String(java.clone())),
        )
        .unwrap();
        std::fs::write(root.join("instances/a/instance.toml"), "name = \"A\"\n").unwrap();
    }

    #[test]
    fn checks_where_data_will_go() {
        let base = tmp("check");
        let cur = base.join("cur");
        data(&cur);
        // Новая папка — прямо в неё.
        let c = check(&cur, &base.join("new")).unwrap();
        assert_eq!((c.target, c.has_data), (base.join("new"), false));
        assert!(c.size > 0);
        // Чужая непустая папка — данные в «Axel» внутри неё.
        std::fs::create_dir_all(base.join("games/other")).unwrap();
        assert_eq!(
            check(&cur, &base.join("games")).unwrap().target,
            base.join("games/Axel")
        );
        // Внутрь текущей и саму текущую — нельзя.
        assert!(check(&cur, &cur.join("sub")).is_err());
        assert!(check(&cur, &cur).is_err());
        assert!(check(&cur, Path::new("relative")).is_err());
        // Там уже данные Axel'.
        data(&base.join("old"));
        assert!(check(&cur, &base.join("old")).unwrap().has_data);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn move_keeps_everything_and_fixes_paths() {
        let base = tmp("move");
        let (cur, new) = (base.join("cur"), base.join("new"));
        data(&cur);
        move_data(&cur, &new, &|_, _| {}).unwrap();
        assert!(!cur.exists(), "старая папка убрана");
        assert!(new.join("instances/a/instance.toml").is_file());
        let settings = std::fs::read_to_string(new.join("launcher.toml")).unwrap();
        let java: toml::Value = toml::from_str(&settings).unwrap();
        assert_eq!(
            java["java_path"].as_str().unwrap(),
            new.join("runtimes/java-21/bin/java").display().to_string(),
            "путь к Java указывает в новую папку"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn copy_reports_progress_and_skips_nothing() {
        let base = tmp("copy");
        let (cur, new) = (base.join("cur"), base.join("new"));
        data(&cur);
        let seen = std::cell::Cell::new(0);
        let mut done = 0;
        copy_tree(&cur, &new, &mut done, dir_size(&cur), &|d, _| seen.set(d)).unwrap();
        assert_eq!(seen.get(), dir_size(&cur));
        assert_eq!(dir_size(&new), dir_size(&cur));
        let _ = std::fs::remove_dir_all(&base);
    }
}
