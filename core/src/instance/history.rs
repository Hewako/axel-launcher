//! Журнал запусков профиля: `launches.jsonl` в папке профиля, по строке на запуск.
//! Хранится столько же записей, сколько логов игры (`launch::rotate_logs`), — у каждой есть свой лог.

use super::{InstanceStore, LastLaunch};
use crate::error::Result;
use crate::paths::write_atomic;

/// Сколько запусков помнить: столько же логов игры держит ротация.
pub const KEEP: usize = 20;

impl InstanceStore {
    /// Дописать запуск в журнал профиля (старые записи сверх `KEEP` отбрасываются).
    pub fn record_launch(&self, id: &str, run: &LastLaunch) -> Result<()> {
        let path = self.dir(id)?.join("launches.jsonl");
        let mut lines: Vec<String> = std::fs::read_to_string(&path)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect();
        lines.push(serde_json::to_string(run).unwrap_or_default());
        let skip = lines.len().saturating_sub(KEEP);
        let text = lines[skip..].join("\n") + "\n";
        write_atomic(&path, text.as_bytes())
    }

    /// Запуски профиля, новые первыми. Профили до появления журнала отдают последний запуск.
    pub fn launches(&self, id: &str) -> Result<Vec<LastLaunch>> {
        let path = self.dir(id)?.join("launches.jsonl");
        let mut runs: Vec<LastLaunch> = std::fs::read_to_string(&path)
            .unwrap_or_default()
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        if runs.is_empty()
            && let Some(last) = self.get(id)?.last_launch
        {
            runs.push(last);
        }
        runs.reverse();
        Ok(runs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::LaunchOutcome;
    use crate::loader::LoaderKind;
    use crate::paths::DataDir;

    fn run(at: u64) -> LastLaunch {
        LastLaunch {
            at,
            outcome: LaunchOutcome::Success,
            exit_code: Some(0),
            duration_secs: 60,
            message: None,
            log_file: None,
            prepare_secs: None,
            peak_ram_mb: None,
            cpu_percent: None,
        }
    }

    #[test]
    fn keeps_last_runs_newest_first() {
        let root = std::env::temp_dir().join(format!("quarry-history-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let store = InstanceStore::new(DataDir::open(&root).unwrap());
        let mut i = store
            .create("Журнал", "26.3", LoaderKind::Vanilla, None)
            .unwrap();
        // До первого записанного запуска — последний запуск из профиля.
        assert!(store.launches(&i.id).unwrap().is_empty());
        i.last_launch = Some(run(5));
        store.save(&i).unwrap();
        assert_eq!(store.launches(&i.id).unwrap()[0].at, 5);

        for at in 1..=KEEP as u64 + 3 {
            store.record_launch(&i.id, &run(at)).unwrap();
        }
        let runs = store.launches(&i.id).unwrap();
        assert_eq!(runs.len(), KEEP);
        assert_eq!(runs[0].at, KEEP as u64 + 3);
        assert_eq!(runs[KEEP - 1].at, 4);
        // Испорченная строка не мешает читать остальные.
        let path = store.dir(&i.id).unwrap().join("launches.jsonl");
        let text = std::fs::read_to_string(&path).unwrap() + "{битая строка\n";
        std::fs::write(&path, text).unwrap();
        assert_eq!(store.launches(&i.id).unwrap().len(), KEEP);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
