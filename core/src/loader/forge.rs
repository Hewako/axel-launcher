//! Forge: список версий из Maven Forge. Установка — тем же исполнителем установщика, что у
//! NeoForge (`neoforge::FORGE`): формат `install_profile.json` (spec 1) и процессоры у них
//! общие. Сверено по установщикам 26.3-66.1.9 и 1.20.1-47.4.28 (21.11.2026).
//!
//! Версия Forge в профиле хранится короткой (`47.4.28`, как в `.mrpack` и у Prism), а в Maven
//! она полная: `1.20.1-47.4.28`.

use crate::error::Result;
use std::collections::HashMap;

use super::LoaderVersion;

const METADATA: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const PROMOTIONS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

/// Версии игры, для которых установщик Forge устроен как у NeoForge (процессоры, загрузка
/// через bootstraplauncher): 1.17 и новее. Старые (1.12.2 и т. п.) ставятся иначе — пока нет.
pub fn supported_game(game: &str) -> bool {
    let parts: Vec<u32> = match game.split('.').map(str::parse).collect() {
        Ok(p) => p,
        Err(_) => return false, // снапшоты и пререлизы Forge не выпускает
    };
    match parts.as_slice() {
        [1, minor, ..] => *minor >= 17,
        [year, ..] => *year >= 25,
        _ => false,
    }
}

/// Полная версия в Maven Forge: `1.20.1` + `47.4.28` → `1.20.1-47.4.28`.
pub fn maven_version(game: &str, version: &str) -> String {
    if version.starts_with(&format!("{game}-")) {
        version.to_string()
    } else {
        format!("{game}-{version}")
    }
}

/// Версии Forge для версии игры из `maven-metadata.xml` (там от старых к новым), новые первыми.
/// Если у Forge есть «рекомендованная» версия, более новые помечены нестабильными — тогда
/// по умолчанию выбирается рекомендованная, как в установщике Forge.
fn parse_versions(xml: &str, game: &str, recommended: Option<&str>) -> Vec<LoaderVersion> {
    let prefix = format!("{game}-");
    let mut out: Vec<String> = xml
        .split("<version>")
        .skip(1)
        .filter_map(|s| s.split_once("</version>").map(|(v, _)| v.trim()))
        .filter_map(|v| v.strip_prefix(&prefix))
        // Старые ветки вида `10.13.4.1614-1.7.10` — не наш формат.
        .filter(|v| !v.contains('-'))
        .map(str::to_string)
        .collect();
    out.reverse();
    let mut newer = recommended.is_some_and(|r| out.iter().any(|v| v == r));
    out.into_iter()
        .map(|v| {
            if Some(v.as_str()) == recommended {
                newer = false;
            }
            LoaderVersion {
                stable: !newer,
                version: v,
            }
        })
        .collect()
}

pub async fn versions(game: &str) -> Result<Vec<LoaderVersion>> {
    if !supported_game(game) {
        return Ok(Vec::new());
    }
    let xml = crate::net::get_text(METADATA).await?;
    #[derive(serde::Deserialize)]
    struct Promos {
        promos: HashMap<String, String>,
    }
    // Без списка рекомендованных версий всё равно можно выбрать версию — просто без подсказки.
    let promos = crate::net::get_json::<Promos>(PROMOTIONS).await.ok();
    let recommended = promos
        .as_ref()
        .and_then(|p| p.promos.get(&format!("{game}-recommended")))
        .map(String::as_str);
    Ok(parse_versions(&xml, game, recommended))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_games() {
        assert!(supported_game("1.20.1"));
        assert!(supported_game("1.17"));
        assert!(supported_game("26.3"));
        assert!(supported_game("26.1.2"));
        assert!(!supported_game("1.16.5"));
        assert!(!supported_game("1.12.2"));
        assert!(!supported_game("26.4-snapshot-2"));
        assert!(!supported_game("b1.7.3"));
    }

    #[test]
    fn maven_versions() {
        assert_eq!(maven_version("1.20.1", "47.4.28"), "1.20.1-47.4.28");
        assert_eq!(maven_version("1.20.1", "1.20.1-47.4.28"), "1.20.1-47.4.28");
        assert_eq!(maven_version("26.3", "66.1.9"), "26.3-66.1.9");
    }

    #[test]
    fn versions_from_metadata() {
        let xml = "<metadata><versioning><versions>\
            <version>1.20.1-47.4.27</version><version>1.20.1-47.4.28</version>\
            <version>1.20.1-47.4.29</version><version>1.20.10-1.0.0</version>\
            <version>1.7.10-10.13.4.1614-1.7.10</version><version>26.3-66.1.9</version>\
            </versions></versioning></metadata>";
        let v = parse_versions(xml, "1.20.1", Some("47.4.28"));
        let got: Vec<(&str, bool)> = v.iter().map(|x| (x.version.as_str(), x.stable)).collect();
        assert_eq!(
            got,
            [("47.4.29", false), ("47.4.28", true), ("47.4.27", true)],
            "новые первыми, новее рекомендованной, нестабильные, чужие версии игры не попали"
        );
        // Без рекомендованной все версии стабильные.
        assert!(parse_versions(xml, "26.3", None).iter().all(|x| x.stable));
        assert!(parse_versions(xml, "1.7.10", None).is_empty());
    }
}
