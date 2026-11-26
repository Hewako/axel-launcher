//! NeoForge и Forge: профиль версии (`version.json` с `inheritsFrom`) и процессоры установщика.
//! Установщики у них одного формата (Forge — предок NeoForge), различаются Maven и имена —
//! это `Flavor`. Список версий Forge — в `forge`.
//!
//! Установщик `neoforge-<v>-installer.jar` содержит `install_profile.json`: данные (`data`),
//! библиотеки для процессоров и сами процессоры — Java-программы, которые готовят клиент
//! (для 26.x — один: PROCESS_MINECRAFT_JAR, бинарный патч клиента). Лаунчер выполняет их сам:
//! с проверкой хэшей библиотек, логом и кешем результата. Формат сверен по установщику
//! 26.3.0.95 (21.10.2026).

use crate::download::{self, Cancel, Expected, Task, Verify};
use crate::error::{Error, IoContext, Result};
use crate::metadata::version::{Library, MavenCoord, VersionJson};
use crate::metadata::{self, sha1_hex};
use crate::paths::{DataDir, safe_join, write_atomic};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::LoaderVersion;

/// Чей установщик: где лежит в Maven и как называется.
pub struct Flavor {
    /// Для сообщений игроку: «NeoForge», «Forge».
    pub name: &'static str,
    maven: &'static str,
    /// Путь группы в Maven: `net/neoforged`.
    group: &'static str,
    artifact: &'static str,
}

pub const NEOFORGE: Flavor = Flavor {
    name: "NeoForge",
    maven: "https://maven.neoforged.net/releases",
    group: "net/neoforged",
    artifact: "neoforge",
};

pub const FORGE: Flavor = Flavor {
    name: "Forge",
    maven: "https://maven.minecraftforge.net",
    group: "net/minecraftforge",
    artifact: "forge",
};

impl Flavor {
    /// Версия в Maven: у NeoForge как есть, у Forge — с версией игры спереди.
    fn maven_version(&self, game: &str, version: &str) -> String {
        if self.artifact == "forge" {
            super::forge::maven_version(game, version)
        } else {
            version.to_string()
        }
    }
}
const VERSIONS_API: &str =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

#[derive(Deserialize)]
struct VersionsResponse {
    versions: Vec<String>,
}

/// Префикс версий NeoForge для версии игры (проверено по списку версий 21.10.2026):
/// `1.21.11` → `21.11.`, `1.21` → `21.0.`; новая схема `26.3` → `26.3.0.`, `26.1.2` → `26.1.2.`.
pub fn version_prefix(game: &str) -> Option<String> {
    let parts: Vec<&str> = game.split('.').collect();
    if parts
        .iter()
        .any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit()))
    {
        return None; // снапшоты и пререлизы NeoForge не поддерживает
    }
    match parts.as_slice() {
        ["1", minor] => Some(format!("{minor}.0.")),
        ["1", minor, patch] => Some(format!("{minor}.{patch}.")),
        [year, drop] => Some(format!("{year}.{drop}.0.")),
        [year, drop, hotfix] => Some(format!("{year}.{drop}.{hotfix}.")),
        _ => None,
    }
}

pub async fn versions(game: &str) -> Result<Vec<LoaderVersion>> {
    let Some(prefix) = version_prefix(game) else {
        return Ok(Vec::new());
    };
    let all: VersionsResponse = crate::net::get_json(VERSIONS_API).await?;
    // API отдаёт от старых к новым; показываем новые первыми.
    Ok(all
        .versions
        .into_iter()
        .rev()
        .filter(|v| v.starts_with(&prefix))
        .map(|v| LoaderVersion {
            stable: !v.contains("-beta") && !v.contains("-alpha"),
            version: v,
        })
        .collect())
}

fn installer_path(data: &DataDir, f: &Flavor, version: &str) -> PathBuf {
    data.libraries()
        .join(f.group)
        .join(f.artifact)
        .join(version)
        .join(format!("{}-{version}-installer.jar", f.artifact))
}

/// Скачать установщик (SHA-1 — из файла `.sha1` в Maven). `version` — полная, как в Maven.
async fn ensure_installer(
    data: &DataDir,
    f: &Flavor,
    version: &str,
    cancel: &Cancel,
) -> Result<PathBuf> {
    metadata::file_safe(version)?;
    let path = installer_path(data, f, version);
    let url = format!(
        "{}/{}/{}/{version}/{}-{version}-installer.jar",
        f.maven, f.group, f.artifact, f.artifact
    );
    let sha1 = crate::net::get_text(&format!("{url}.sha1"))
        .await
        .ok()
        .and_then(|t| t.split_whitespace().next().map(str::to_ascii_lowercase));
    let expected = match sha1 {
        Some(h) if h.len() == 40 => Expected::Sha1(h),
        // Нет сети, но установщик уже есть — работаем с ним.
        _ if path.exists() => return Ok(path),
        _ => {
            return Err(Error::invalid(format!(
                "Не удалось получить хэш установщика {}",
                f.name
            )));
        }
    };
    download::download_all(
        vec![Task {
            url,
            dest: path.clone(),
            expected,
            size: None,
        }],
        1,
        Verify::Full,
        None,
        cancel,
    )
    .await?;
    Ok(path)
}

fn read_zip_text(zip_path: &Path, name: &str) -> Result<String> {
    let file = std::fs::File::open(zip_path).at(zip_path)?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| Error::parse("установщик загрузчика", e))?;
    let mut entry = zip
        .by_name(name)
        .map_err(|_| Error::invalid(format!("В установщике загрузчика нет {name}")))?;
    let mut text = String::new();
    entry.read_to_string(&mut text).at(zip_path)?;
    Ok(text)
}

/// Библиотеки, которые лежат прямо в установщике (`maven/…`), а не в Maven: у Forge 1.13–1.16
/// это сам Forge и его universal-часть. В профиле у них пустая ссылка; официальный установщик их
/// просто распаковывает в libraries — делаем так же. Возвращает пути распакованных файлов.
fn extract_bundled(installer: &Path, libs: &Path) -> Result<Vec<PathBuf>> {
    let file = std::fs::File::open(installer).at(installer)?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| Error::parse("установщик загрузчика", e))?;
    let mut out = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| Error::parse("установщик загрузчика", e))?;
        let name = entry.name().map(|n| n.to_string()).unwrap_or_default();
        let Some(rel) = name.strip_prefix("maven/").map(str::to_string) else {
            continue;
        };
        if entry.is_dir() || !rel.ends_with(".jar") {
            continue;
        }
        let dest = safe_join(libs, &rel)
            .ok_or_else(|| Error::invalid(format!("Недопустимый путь в установщике: {rel}")))?;
        if std::fs::metadata(&dest).is_ok_and(|m| m.len() == entry.size()) {
            out.push(dest);
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).at(installer)?;
        write_atomic(&dest, &bytes)?;
        out.push(dest);
    }
    Ok(out)
}

/// Профиль версии без процессоров — для сборки classpath и аргументов.
pub async fn profile(data: &DataDir, f: &Flavor, game: &str, version: &str) -> Result<VersionJson> {
    let mv = f.maven_version(game, version);
    let installer = ensure_installer(data, f, &mv, &Cancel::new()).await?;
    let json = VersionJson::parse(&read_zip_text(&installer, "version.json")?)?;
    if json.inherits_from.as_deref() != Some(game) {
        return Err(Error::invalid(format!(
            "{} {version} рассчитан на Minecraft {:?}, а не {game}",
            f.name, json.inherits_from
        )));
    }
    Ok(json)
}

#[derive(Debug, Deserialize)]
struct InstallProfile {
    #[serde(default)]
    data: BTreeMap<String, SidedValue>,
    #[serde(default)]
    processors: Vec<Processor>,
    #[serde(default)]
    libraries: Vec<Library>,
}

#[derive(Debug, Deserialize)]
struct SidedValue {
    client: String,
}

#[derive(Debug, Deserialize)]
struct Processor {
    jar: String,
    #[serde(default)]
    classpath: Vec<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    sides: Option<Vec<String>>,
    #[serde(default)]
    outputs: BTreeMap<String, String>,
}

fn coord_path(libs: &Path, coord: &str) -> Result<PathBuf> {
    let c = MavenCoord::parse(coord)
        .ok_or_else(|| Error::invalid(format!("Недопустимая координата Maven: {coord}")))?;
    safe_join(libs, &c.path()).ok_or_else(|| Error::invalid(format!("Недопустимый путь: {coord}")))
}

/// Значение из `data`: `[coord]` — путь библиотеки, `'текст'` — строка, `/путь` — файл из
/// установщика (извлекается во временную папку).
fn resolve_value(value: &str, libs: &Path, installer: &Path, extract_dir: &Path) -> Result<String> {
    if let Some(coord) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        return Ok(coord_path(libs, coord)?.to_string_lossy().into_owned());
    }
    if let Some(lit) = value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')) {
        return Ok(lit.to_string());
    }
    if let Some(inner) = value.strip_prefix('/') {
        let target = safe_join(extract_dir, inner)
            .ok_or_else(|| Error::invalid(format!("Недопустимый путь в установщике: {value}")))?;
        let file = std::fs::File::open(installer).at(installer)?;
        let mut zip =
            zip::ZipArchive::new(file).map_err(|e| Error::parse("установщик загрузчика", e))?;
        let mut entry = zip
            .by_name(inner)
            .map_err(|_| Error::invalid(format!("В установщике нет {inner}")))?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).at(parent)?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).at(installer)?;
        std::fs::write(&target, buf).at(&target)?;
        return Ok(target.to_string_lossy().into_owned());
    }
    Ok(value.to_string())
}

/// Подставить `{КЛЮЧ}` (в любом месте строки) и `[coord]` (весь аргумент).
fn substitute(arg: &str, vars: &BTreeMap<String, String>, libs: &Path) -> Result<String> {
    if let Some(coord) = arg.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        return Ok(coord_path(libs, coord)?.to_string_lossy().into_owned());
    }
    let mut out = arg.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    if let Some(start) = out.find('{')
        && out[start..].contains('}')
    {
        return Err(Error::invalid(format!(
            "Неизвестная переменная в аргументе процессора: {arg}"
        )));
    }
    Ok(out)
}

/// `Main-Class` из манифеста JAR (с учётом переноса длинных строк в манифесте).
pub fn main_class(jar: &Path) -> Result<String> {
    let text = read_zip_text(jar, "META-INF/MANIFEST.MF")?;
    let mut joined: Vec<String> = Vec::new();
    for line in text.lines() {
        match line.strip_prefix(' ') {
            Some(cont) if !joined.is_empty() => joined.last_mut().unwrap().push_str(cont),
            _ => joined.push(line.to_string()),
        }
    }
    joined
        .iter()
        .find_map(|l| l.strip_prefix("Main-Class:").map(|v| v.trim().to_string()))
        .ok_or_else(|| Error::invalid(format!("В {} нет Main-Class", jar.display())))
}

fn marker_path(data: &DataDir, f: &Flavor, version: &str) -> PathBuf {
    data.meta()
        .join("loaders")
        .join(format!("{}-{version}.installed.json", f.artifact))
}

/// Выполнить клиентские процессоры, если их результат ещё не готов. `java` — Java версии игры,
/// `client_jar` — уже скачанный ванильный клиент. Лог — в `logs/<загрузчик>-<v>.log`.
pub async fn run_processors(
    data: &DataDir,
    f: &Flavor,
    game: &str,
    version: &str,
    java: &Path,
    client_jar: &Path,
    cancel: &Cancel,
) -> Result<()> {
    let version = &f.maven_version(game, version);
    let marker = marker_path(data, f, version);
    if let Ok(text) = std::fs::read_to_string(&marker) {
        let outputs: BTreeMap<PathBuf, String> = serde_json::from_str(&text).unwrap_or_default();
        if !outputs.is_empty() && outputs.keys().all(|p| p.exists()) {
            return Ok(());
        }
    }
    let installer = ensure_installer(data, f, version, cancel).await?;
    let profile: InstallProfile =
        serde_json::from_str(&read_zip_text(&installer, "install_profile.json")?)
            .map_err(|e| Error::parse("install_profile.json загрузчика", e))?;
    let libs = data.libraries();
    let bundled = extract_bundled(&installer, &libs)?;

    // Библиотеки процессоров — с хэшами из профиля.
    let mut tasks = Vec::new();
    for lib in &profile.libraries {
        if let Some(art) = lib.main_artifact().filter(|a| !a.url.is_empty()) {
            let rel = art.path.clone().unwrap_or_default();
            let dest = safe_join(&libs, &rel)
                .ok_or_else(|| Error::invalid(format!("Недопустимый путь библиотеки: {rel}")))?;
            tasks.push(Task {
                url: art.url.clone(),
                dest,
                expected: art.sha1.map(Expected::Sha1).unwrap_or(Expected::Unverified),
                size: art.size,
            });
        }
    }
    download::download_all(tasks, 8, Verify::Quick, None, cancel).await?;

    let work = crate::paths::unique_sibling(
        &data.tmp().join(format!("{}-{version}", f.artifact)),
        "work",
    );
    std::fs::create_dir_all(&work).at(&work)?;
    let mut vars: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in &profile.data {
        vars.insert(
            k.clone(),
            resolve_value(&v.client, &libs, &installer, &work)?,
        );
    }
    let path = |p: &Path| p.to_string_lossy().into_owned();
    vars.insert("SIDE".into(), "client".into());
    vars.insert("MINECRAFT_JAR".into(), path(client_jar));
    vars.insert("MINECRAFT_VERSION".into(), game.to_string());
    vars.insert("ROOT".into(), path(&data.cache())); // {ROOT}/libraries = cache/libraries
    vars.insert("INSTALLER".into(), path(&installer));
    vars.insert("LIBRARY_DIR".into(), path(&libs));

    std::fs::create_dir_all(data.logs()).at(data.logs())?;
    let log_path = data.logs().join(format!("{}-{version}.log", f.artifact));
    let mut log = String::new();
    let mut produced: BTreeMap<PathBuf, String> = BTreeMap::new();
    let sep = if cfg!(windows) { ";" } else { ":" };

    for proc in profile.processors.iter().filter(|p| {
        p.sides
            .as_ref()
            .is_none_or(|s| s.iter().any(|x| x == "client"))
    }) {
        cancel.check()?;
        let jar = coord_path(&libs, &proc.jar)?;
        let mut cp = vec![path(&jar)];
        for c in &proc.classpath {
            let p = path(&coord_path(&libs, c)?);
            if !cp.contains(&p) {
                cp.push(p);
            }
        }
        let main = main_class(&jar)?;
        let args = proc
            .args
            .iter()
            .map(|a| substitute(a, &vars, &libs))
            .collect::<Result<Vec<_>>>()?;
        log.push_str(&format!("> {} {}\n", main, args.join(" ")));
        let out = tokio::process::Command::new(java)
            .arg("-cp")
            .arg(cp.join(sep))
            .arg(&main)
            .args(&args)
            .current_dir(&work)
            .output()
            .await
            .map_err(|e| Error::Java(format!("Не удалось запустить процессор {}: {e}", f.name)))?;
        log.push_str(&String::from_utf8_lossy(&out.stdout));
        log.push_str(&String::from_utf8_lossy(&out.stderr));
        let _ = write_atomic(
            &log_path,
            crate::logmask::Masker::new().mask(&log).as_bytes(),
        );
        if !out.status.success() {
            return Err(Error::invalid(format!(
                "Процессор {} {} завершился с ошибкой (код {:?}). Подробности: {}",
                f.name,
                proc.jar,
                out.status.code(),
                log_path.display()
            )));
        }
        for (key, expected) in &proc.outputs {
            let file = PathBuf::from(substitute(key, &vars, &libs)?);
            let want = substitute(expected, &vars, &libs)?
                .trim_matches('\'')
                .to_ascii_lowercase();
            let got = sha1_hex(&std::fs::read(&file).at(&file)?);
            if got != want {
                return Err(Error::HashMismatch {
                    path: file,
                    expected: want,
                    actual: got,
                });
            }
        }
    }

    // Распакованное из установщика тоже должно быть на месте: иначе запуск не найдёт Forge.
    for p in bundled {
        let bytes = std::fs::read(&p).at(&p)?;
        produced.insert(p, sha1_hex(&bytes));
    }
    // Результат — пропатченный клиент (data.PATCHED); его наличие и хэш — маркер готовности.
    if let Some(patched) = vars.get("PATCHED") {
        let p = PathBuf::from(patched);
        let bytes = std::fs::read(&p).map_err(|_| {
            Error::invalid(format!(
                "После процессоров {} нет пропатченного клиента {}",
                f.name,
                p.display()
            ))
        })?;
        produced.insert(p, sha1_hex(&bytes));
    }
    let _ = std::fs::remove_dir_all(&work);
    write_atomic(
        &marker,
        serde_json::to_string_pretty(&produced)
            .unwrap_or_default()
            .as_bytes(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_prefixes_match_data() {
        assert_eq!(version_prefix("1.21.11").as_deref(), Some("21.11."));
        assert_eq!(version_prefix("1.21").as_deref(), Some("21.0."));
        assert_eq!(version_prefix("1.20.4").as_deref(), Some("20.4."));
        assert_eq!(version_prefix("26.3").as_deref(), Some("26.3.0."));
        assert_eq!(version_prefix("26.1.2").as_deref(), Some("26.1.2."));
        assert_eq!(version_prefix("26.4-snapshot-5"), None);
        assert_eq!(version_prefix("b1.7.3"), None);
    }

    #[test]
    fn data_values_and_substitution() {
        let libs = Path::new("/libs");
        let v = resolve_value(
            "[net.neoforged:minecraft-client-patched:26.3.0.95]",
            libs,
            Path::new("/none"),
            Path::new("/tmp"),
        )
        .unwrap();
        assert_eq!(
            v.replace('\\', "/"),
            "/libs/net/neoforged/minecraft-client-patched/26.3.0.95/minecraft-client-patched-26.3.0.95.jar"
        );
        assert_eq!(
            resolve_value("'26.3-1'", libs, Path::new("/none"), Path::new("/tmp")).unwrap(),
            "26.3-1"
        );
        let mut vars = BTreeMap::new();
        vars.insert("ROOT".to_string(), "/root".to_string());
        assert_eq!(
            substitute("{ROOT}/libraries/", &vars, libs).unwrap(),
            "/root/libraries/"
        );
        assert!(substitute("{UNKNOWN}", &vars, libs).is_err());
        assert!(
            resolve_value(
                "/../../etc/passwd",
                libs,
                Path::new("/none"),
                Path::new("/tmp")
            )
            .is_err()
        );
    }

    #[test]
    fn manifest_main_class_with_wrapping() {
        let dir = std::env::temp_dir().join(format!("axel-manifest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let jar = dir.join("t.jar");
        {
            use std::io::Write;
            let mut w = zip::ZipWriter::new(std::fs::File::create(&jar).unwrap());
            w.start_file(
                "META-INF/MANIFEST.MF",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            w.write_all(b"Manifest-Version: 1.0\r\nMain-Class: net.neoforged.installertools.Consol\r\n eTool\r\n\r\n").unwrap();
            w.finish().unwrap();
        }
        assert_eq!(
            main_class(&jar).unwrap(),
            "net.neoforged.installertools.ConsoleTool"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
