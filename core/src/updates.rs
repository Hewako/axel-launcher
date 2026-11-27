//! Проверка новой версии Axel' на странице релизов GitHub. Ничего не скачивает и не
//! устанавливает сама: лаунчер предлагает скачать файл для своей системы в браузере или
//! открыть страницу релиза.

use crate::error::Result;
use serde::Serialize;

pub const RELEASES_URL: &str = "https://github.com/Hewako/axel-launcher/releases";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Release {
    pub version: String,
    pub url: String,
    pub notes: String,
    /// Постоянная ссылка на файл для этой системы (`releases/latest/download/…`); `None` — где
    /// файл не угадать, там только страница релиза.
    pub download_url: Option<String>,
}

/// Файл последней версии для системы `os` (`std::env::consts::OS`). Имена задаёт
/// `.github/workflows/release.yml`. Linux — только если программа запущена из AppImage:
/// `.deb` или `.rpm` нужен, надёжно не определить, и там открываем страницу релиза.
pub fn download_asset(os: &str, appimage: bool) -> Option<&'static str> {
    match os {
        "windows" => Some("Axel-Launcher-Windows.exe"),
        "macos" => Some("Axel-Launcher-macOS.dmg"),
        "linux" if appimage => Some("Axel-Launcher-Linux.AppImage"),
        _ => None,
    }
}

/// Постоянная ссылка на файл последней опубликованной (не пробной) версии для системы.
pub fn download_url(os: &str, appimage: bool) -> Option<String> {
    download_asset(os, appimage).map(|f| format!("{RELEASES_URL}/latest/download/{f}"))
}

/// Новее ли `candidate` (например `v0.2.0`), чем `current` (`0.1.0`). Предрелизы
/// (`-beta.1`) считаются старше той же версии без суффикса.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    fn parse(v: &str) -> Option<(Vec<u64>, bool)> {
        let v = v.trim().trim_start_matches('v');
        let (nums, pre) = v.split_once('-').map_or((v, false), |(n, _)| (n, true));
        let n: Vec<u64> = nums
            .split('.')
            .map(|p| p.parse().ok())
            .collect::<Option<_>>()?;
        (n.len() == 3).then_some((n, pre))
    }
    match (parse(candidate), parse(current)) {
        (Some((a, a_pre)), Some((b, b_pre))) => a > b || (a == b && b_pre && !a_pre),
        _ => false,
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
struct Gh {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
}

/// Самый новый релиз из списка, новее `current`: черновики не в счёт.
fn pick_newest<'a>(list: &'a [Gh], current: &str) -> Option<&'a Gh> {
    list.iter()
        .filter(|r| !r.draft && is_newer(&r.tag_name, current))
        .fold(None, |best: Option<&Gh>, r| match best {
            Some(b) if !is_newer(&r.tag_name, &b.tag_name) => Some(b),
            _ => Some(r),
        })
}

/// Последний релиз на GitHub, если он новее этой версии Axel'. Канал `beta` (идея 27)
/// учитывает и предрелизы, `stable` — только опубликованные версии.
pub async fn latest(channel: &str) -> Result<Option<Release>> {
    let api = "https://api.github.com/repos/Hewako/axel-launcher/releases";
    let list: Vec<Gh> = if channel == "beta" {
        let text = crate::net::get_text(&format!("{api}?per_page=20")).await?;
        serde_json::from_str(&text).map_err(|e| crate::error::Error::parse("ответ GitHub", e))?
    } else {
        let text = crate::net::get_text(&format!("{api}/latest")).await?;
        vec![
            serde_json::from_str(&text)
                .map_err(|e| crate::error::Error::parse("ответ GitHub", e))?,
        ]
    };
    let Some(r) = pick_newest(&list, crate::launch::LAUNCHER_VERSION) else {
        return Ok(None);
    };
    // Ссылку открываем только на страницу релизов этого проекта.
    if !r.html_url.starts_with(RELEASES_URL) {
        return Ok(None);
    }
    Ok(Some(Release {
        version: r.tag_name.trim_start_matches('v').to_string(),
        url: r.html_url.clone(),
        notes: r
            .body
            .clone()
            .unwrap_or_default()
            .chars()
            .take(2000)
            .collect(),
        // AppImage сам задаёт переменную APPIMAGE запущенной программе.
        download_url: download_asset(std::env::consts::OS, std::env::var_os("APPIMAGE").is_some())
            .map(|f| format!("{RELEASES_URL}/download/{}/{f}", r.tag_name)),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_release_skips_drafts_and_older() {
        let gh = |tag: &str, draft: bool| Gh {
            tag_name: tag.into(),
            html_url: format!("{RELEASES_URL}/tag/{tag}"),
            body: None,
            draft,
        };
        let list = [
            gh("v1.1.0-rc.1", false),
            gh("v1.2.0", true),
            gh("v1.0.1", false),
            gh("v0.9.0", false),
        ];
        assert_eq!(pick_newest(&list, "1.0.0").unwrap().tag_name, "v1.1.0-rc.1");
        assert!(
            pick_newest(&list, "1.1.0").is_none(),
            "черновик 1.2.0 не в счёт"
        );
        assert!(pick_newest(&list[2..], "1.0.1").is_none());
    }

    #[test]
    fn version_comparison() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("0.10.0", "0.9.9"), "числа, а не строки");
        assert!(is_newer("1.0.0", "1.0.0-beta.2"));
        assert!(!is_newer("v0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0-rc.1", "0.1.0"));
        assert!(!is_newer("мусор", "0.1.0"));
    }

    #[test]
    fn download_file_per_system() {
        assert_eq!(
            download_asset("windows", false),
            Some("Axel-Launcher-Windows.exe")
        );
        assert_eq!(
            download_asset("macos", false),
            Some("Axel-Launcher-macOS.dmg")
        );
        assert_eq!(
            download_asset("linux", true),
            Some("Axel-Launcher-Linux.AppImage")
        );
        // .deb и .rpm не различить надёжно — открываем страницу релиза.
        assert_eq!(download_asset("linux", false), None);
        assert_eq!(download_asset("freebsd", false), None);
        assert_eq!(
            download_url("macos", false).as_deref(),
            Some(
                "https://github.com/Hewako/axel-launcher/releases/latest/download/Axel-Launcher-macOS.dmg"
            )
        );
    }
}
