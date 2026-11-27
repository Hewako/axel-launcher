// Предпросмотр интерфейса в обычном браузере (только для разработки и визуальной проверки):
// IPC Tauri подменяется через официальный @tauri-apps/api/mocks тестовыми данными.
// Файл не входит в сборку приложения (vite build собирает только index.html).
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import React from "react";
import ReactDOM from "react-dom/client";
import type { Instance } from "./api";
import App from "./App";
import "./fonts";
import "./styles.css";

const now = Math.floor(Date.now() / 1000);
const instances: Instance[] = [
  { id: "tech", name: "Технология+", game_version: "26.3", loader: "fabric", loader_version: "0.19.5", created_at: now - 864000, favorite: true, group: "С друзьями", color: "#3b7dd8", auth_mode: "microsoft", settings: { max_memory_mb: 6144 }, pack_settings: {}, last_launch: { at: now - 86400, outcome: "success", duration_secs: 8040 } },
  { id: "shaders", name: "Шейдеры", game_version: "1.21.11", loader: "quilt", loader_version: "0.29.2", created_at: now - 864000, auth_mode: "microsoft", settings: {}, pack_settings: {}, last_launch: { at: now - 3600, outcome: "crashed", exit_code: -1, duration_secs: 31, message: "игра завершилась с кодом -1" } },
  { id: "vanilla", name: "Ванилла 26.3", game_version: "26.3", loader: "vanilla", created_at: now - 864000, auth_mode: "microsoft", settings: {}, pack_settings: {} },
  { id: "old", name: "Хардкор 1.16.5", game_version: "1.16.5", loader: "vanilla", created_at: now - 864000, auth_mode: "microsoft", settings: {}, pack_settings: {}, last_launch: { at: now - 3 * 86400, outcome: "failed_to_start", duration_secs: 0, message: "Нет аккаунта Microsoft. Войдите на экране «Аккаунты»" } },
];

const params = new URLSearchParams(location.search);
const withAccount = params.get("account") !== "none";

mockIPC((cmd, args) => {
  const a = args as Record<string, unknown>;
  switch (cmd) {
    case "app_info": return { curseforge: true, version: "1.0.0", dev_launch: params.has("dev"), data_dir: "/Users/player/.axel", microsoft_configured: params.has("ms"), os: "macos" };
    case "list_instances": return { instances, broken: [], running: [], mods: { tech: 87, shaders: 44 } };
    case "update_instance": return { ...instances.find((i) => i.id === a.id)!, ...((a.meta as object) ?? {}) };
    case "resources_list": if (a.kind === "datapack") return { game_format: 61, shader_loader: true, packs: [{ file_name: "Towers.zip", description: "Башни в мире", size: 340_000, is_dir: false, enabled: false, formats: [61, 61], compatible: true }] };
      return a.kind === "resourcepack"
      ? { game_format: 75, shader_loader: true, packs: [
        { file_name: "Faithful 32x.zip", description: "Те же текстуры, в два раза чётче", size: 9_400_000, is_dir: false, enabled: true, formats: [75, 75], compatible: true },
        { file_name: "Fresh Animations.zip", description: "Живые анимации мобов", size: 2_100_000, is_dir: false, enabled: true, formats: [70, 75], compatible: true },
        { file_name: "Old Pack.zip", description: "Для 1.20", size: 800_000, is_dir: false, enabled: false, formats: [15, 15], compatible: false },
      ] }
      : { shader_loader: true, packs: [
        { file_name: "ComplementaryReimagined.zip", description: "", size: 1_200_000, is_dir: false, enabled: true },
        { file_name: "BSL.zip", description: "", size: 900_000, is_dir: false, enabled: false },
      ] };
    case "mods_groups": return { names: ["Оптимизация", "Визуал", "Удобство", "Серверные", "Разработка"], groups: { "sodium.jar": "Оптимизация", "iris.jar": "Визуал", "indium.jar": "Визуал" } };
    case "configs_list": return [{ path: "config/iris.properties", size: 120, user_edited: false }, { path: "config/sodium-options.json", size: 840, user_edited: true }, { path: "options.txt", size: 4200, user_edited: false }];
    case "configs_search": return [{ path: "config/iris.properties", line: 2, text: "shaderPack=BSL.zip" }];
    case "config_read": return "{\n  \"quality\": {\n    \"weather_quality\": \"FAST\"\n  }\n}\n";
    case "config_history": return [{ at: Date.now() - 3600_000, size: 830 }];
    case "config_preview": return { diff: [{ kind: "=", text: "{" }, { kind: "-", text: "  \"fps\": 60" }, { kind: "+", text: "  \"fps\": 144" }, { kind: "=", text: "}" }] };
    case "memory_advice": return Number(a.maxMb) > 12_000 ? ["Отдано 14 из 16 ГБ памяти компьютера — системе и браузеру может не хватить, игра начнёт тормозить"] : [];
    case "options_view": return {
      entries: [["version", "4671"], ["renderDistance", "12"], ["simulationDistance", "8"], ["maxFps", "120"], ["fov", "0.25"], ["gamma", "0.5"], ["guiScale", "0"], ["enableVsync", "true"], ["fullscreen", "false"],
        ["soundCategory_master", "1.0"], ["soundCategory_music", "0.3"], ["key_key.jump", "key.keyboard.space"], ["key_key.drop", "key.keyboard.q"], ["key_key.sprint", "key.keyboard.q"], ["key_key.attack", "key.mouse.left"]],
      conflicts: [{ key: "key.keyboard.q", actions: ["key.drop", "key.sprint"] }],
      presets: [{ name: "Слабый ноутбук", category: "graphics", count: 6 }],
    };
    case "storage_overview": return [{ label: "Профили (миры, моды, настройки)", size: 6_200_000_000, cleanable: false }, { label: "Библиотеки и ресурсы игры (общие для профилей)", size: 1_900_000_000, cleanable: false }, { label: "Временные файлы и кеш", size: 240_000_000, cleanable: true }];
    case "cache_clean": return 240_000_000;
    case "crash_reports": return [{ file: "crash-2026-10-21_09.30.00-client.txt", when: "2026-10-21 09:30:00", size: 18_000, description: "Rendering overlay" }];
    case "support_report_preview": return [{ name: "summary.txt", content: "Отчёт поддержки Axel'\n\nAxel': 1.0.0\nВерсия игры: 26.3" }, { name: "mods.txt", content: "[вкл] Sodium 0.8.14 (sodium.jar)" }];
    case "first_run_info": return { data_dir: "/Users/player/.axel", free_bytes: 84_000_000_000, javas: [{ path: "/usr/bin/java", major: 21, version: "21.0.4", arch: "aarch64" }] };
    case "first_run_done": return null;
    case "account_skin": return null;
    case "profiles_compare": return { basics: [["Minecraft", "26.3", "1.21.11"], ["Загрузчик", "Fabric 0.19.5", "Quilt 0.29.2"]], only_a: ["Fabric API 0.120.0"], only_b: ["Iris Shaders 1.10.8"], versions: [["Sodium", "0.8.14", "0.7.2"]], settings: [["max_memory_mb", "6144", "4096"]], options: [["fov", "70", "90"]] };
    case "preview_command": return "java -Xms6144M -Xmx6144M -XX:+UseG1GC -cp …87 модов, библиотеки… net.fabricmc.loader.impl.launch.knot.KnotClient --username Steve_Builder --accessToken ‹скрыт›";
    case "servers_list": return [{ name: "Сервер с друзьями", ip: "mc.example.org" }, { name: "Локальный", ip: "127.0.0.1:25566" }];
    case "server_ping": return a.address === "mc.example.org"
      ? { version: "Paper 26.3", protocol: 800, online: 7, max: 50, motd: "Добро пожаловать!\nВыживание с друзьями", latency_ms: 38 }
      : Promise.reject("Сервер не ответил: Connection refused");
    case "servers_save": return null;
    case "room_create": return "K7M2Q";
    case "room_join": return String(a.code).toUpperCase();
    case "room_leave": return null;
    case "server_tags": return { "mc.example.org": ["друзья", "выживание"] };
    case "server_set_tags": return null;
    case "disk_usage": return { total: 1_480_000_000, parts: [{ label: "Миры", size: 820_000_000 }, { label: "Моды", size: 410_000_000 }, { label: "Ресурспаки и шейдеры", size: 160_000_000 }, { label: "Снимки модов", size: 70_000_000 }, { label: "Скриншоты", size: 20_000_000 }] };
    case "list_accounts": return withAccount ? [{ provider: "microsoft", uuid: "0123", name: "Steve_Builder", owns_java_edition: true, checked_at: now }] : [];
    case "global_settings": return { launch: {}, theme: params.get("theme") ?? "dark", streamer_mode: false, language: params.get("lang") ?? "ru", ui_scale: 100, compact: false, font: "system", first_run_done: !params.has("firstrun"), backup_before_risky_launch: true, backup_after_exit: false, backup_every_days: 0, download_limit_kbps: 0, check_launcher_updates: true };
    case "save_global_settings": return null;
    case "launch_settings": {
      const i = instances.find((x) => x.id === a.id)!;
      return {
        resolved: {
          max_memory_mb: { value: i.settings.max_memory_mb ?? 4096, source: i.settings.max_memory_mb ? "profile" : "default" },
          min_memory_mb: { value: i.settings.max_memory_mb ?? 4096, source: "default" },
          java_path: { value: null, source: "default" }, jvm_args: { value: [], source: "default" }, resolution: { value: null, source: "default" },
        },
        profile: i.settings, global: {}, total_memory_mb: 16384, memory_range: [2048, 12288],
      };
    }
    case "list_versions": return { versions: [{ id: "26.4-snapshot-2", type: "snapshot", releaseTime: "2026-11-12T10:00:00+00:00" }, { id: "26.3", type: "release", releaseTime: "2026-10-14T10:00:00+00:00" }, { id: "26.2", type: "release", releaseTime: "2026-07-01T10:00:00+00:00" }, { id: "1.21.11", type: "release", releaseTime: "2025-12-09T10:00:00+00:00" }, { id: "b1.7.3", type: "old_beta", releaseTime: "2011-07-08T10:00:00+00:00" }], latest_release: "26.3", offline: false };
    case "launch_history": {
      if (params.has("nolaunch")) return [];
      const now = Math.floor(Date.now() / 1000);
      const runs = instances.filter((i) => i.last_launch).map((i) => ({ id: i.id, ...i.last_launch! }));
      runs.push({ id: instances[0].id, at: now - 26 * 3600, outcome: "success", duration_secs: 8040, peak_ram_mb: 5222, log_file: "game-1.log" } as never);
      runs.push({ id: instances[0].id, at: now - 30 * 3600, outcome: "crashed", duration_secs: 11, message: "Indium несовместим с новой версией Sodium", log_file: "game-0.log" } as never);
      return runs.sort((x, y) => y.at - x.at);
    }
    case "launcher_update": return params.has("update") ? { version: "0.2.0", url: "https://github.com/Hewako/axel-launcher/releases", notes: "", download_url: "https://github.com/Hewako/axel-launcher/releases/latest/download/Axel-Launcher-macOS.dmg" } : null;
    case "version_info": return { java_major: 25, java_reason: "javaVersion.majorVersion = 25 в JSON версии" };
    case "loader_versions": return [{ version: "0.20.1", stable: false }, { version: "0.19.5", stable: true }];
    case "read_log_file": return ["[13:47:02] [main/INFO]: Loading Minecraft 1.21.11 with Quilt Loader 0.29.2", "[13:47:03] [main/WARN]: Mod distanthorizons recommends sodium >=0.7.3", "[13:47:04] [main/INFO]: Game directory: ‹HOME›/.axel/instances/shaders/game", "[13:47:33] [Render thread/ERROR]: Mixin apply for mod indium failed", "java.lang.RuntimeException: boom", "\tat a.b(C.java:1)"];
    case "launch_instance": {
      const id = a.id as string;
      setTimeout(async () => {
        await emit("launch-event", { id, event: { type: "stage", stage: "assets", label: "Ресурсы игры" } });
        await emit("launch-event", { id, event: { type: "progress", stage: "assets", progress: { files_total: 4231, files_done: 1730, bytes_total: 680_000_000, bytes_done: 270_000_000, retries: 0 } } });
        await emit("launch-event", { id, event: { type: "java", label: "Eclipse Adoptium 25.0.4.1 (aarch64)", reason: "нужна Java 25 (javaVersion.majorVersion = 25 в JSON версии) — найдена Eclipse Adoptium 25.0.4.1 (aarch64)" } });
        if (params.has("crash")) {
          const analysis = { title: "Indium несовместим с новой версией Sodium", explanation: "Indium добавлял Fabric Rendering API для Sodium до 0.6; в Sodium 0.8 этих классов больше нет.", confidence: "high", confidence_label: "высокая", evidence: ["Mixin apply for mod indium failed indium.mixins.json"], suspects: ["indium.jar"], actions: [{ kind: "disable_mod", file_name: "indium.jar" }, { kind: "safe_launch" }] };
          await emit("launch-event", { id, event: { type: "exited", info: { code: -1, duration_secs: 31, killed: false, crashed: true, log_file: "", tail: [], analysis } } });
          await emit("launch-finished", { id });
        }
        if (params.has("run")) {
          await new Promise((r) => setTimeout(r, 1500));
          await emit("launch-event", { id, event: { type: "started", command: "java …" } });
          for (const line of ["[14:02:21] [main/INFO]: Loading Minecraft 26.3 with Fabric Loader 0.19.5", "[14:02:23] [main/INFO]: Loading 86 mods", "[14:02:28] [main/WARN]: Mod distanthorizons recommends sodium >=0.7.3", "[14:02:31] [main/INFO]: Applying mixins…", "[14:02:36] [Render thread/INFO]: Setting user: Steve_Builder"]) await emit("launch-event", { id, event: { type: "log", line } });
        }
      }, 50);
      return null;
    }
    case "mods_view": {
      const dep = (id: string, kind = "required", range = "*") => ({ id, range, kind });
      const fm = (id: string, name: string, version: string, side: string, dependencies: { id: string; range: string; kind: string }[] = []) => [{ loader: "fabric", id, name, version, side, dependencies, mixins: [] }];
      const files = [
        { file_name: "sodium.jar", rel_path: "mods/sodium.jar", enabled: true, size: 1, sha1: "a", mods: fm("sodium", "Sodium", "0.8.14", "client"), source: { path: "mods/sodium.jar", sha1: "a", source: "modrinth", layer: "base" } },
        { file_name: "indium.jar", rel_path: "mods/indium.jar", enabled: true, size: 1, sha1: "b", mods: fm("indium", "Indium", "1.0.30", "client", [dep("sodium", "required", "<0.6"), dep("fabric-api")]), source: { path: "mods/indium.jar", sha1: "b", source: "modrinth", layer: "user" } },
        { file_name: "iris.jar", rel_path: "mods/iris.jar", enabled: true, size: 1, sha1: "c", mods: fm("iris", "Iris Shaders", "1.10.8", "client", [dep("sodium"), dep("fabric-api")]), source: { path: "mods/iris.jar", sha1: "c", source: "modrinth", layer: "base" } },
        { file_name: "fabric-api.jar", rel_path: "mods/fabric-api.jar", enabled: true, size: 1, sha1: "e", mods: fm("fabric-api", "Fabric API", "0.120.0", "both"), source: { path: "mods/fabric-api.jar", sha1: "e", source: "modrinth", layer: "base" } },
        { file_name: "dh.jar", rel_path: "mods/dh.jar", enabled: true, size: 1, sha1: "f", mods: fm("distanthorizons", "Distant Horizons", "2.3.4", "client", [dep("sodium", "optional"), dep("fabric-api")]), source: { path: "mods/dh.jar", sha1: "f", source: "modrinth", layer: "user" } },
        { file_name: "old.jar.disabled", rel_path: "mods/old.jar.disabled", enabled: false, size: 1, sha1: "d", mods: [], read_error: "в файле нет метаданных мода" },
      ];
      return {
        files,
        report: {
          findings: [{ severity: "blocking", title: "Indium требует sodium <0.6, а стоит 0.8.14", detail: "Версии не подходят друг к другу — загрузчик остановит запуск.", evidence: "fabric.mod.json: зависимость sodium <0.6", files: ["indium.jar"], fixes: [{ kind: "disable", file_name: "indium.jar" }] }],
          mods: [
            { file_name: "sodium.jar", state: "ok", state_label: "конфликтов не найдено", notes: [] },
            { file_name: "indium.jar", state: "blocked", state_label: "блокирует запуск", notes: ["Indium требует sodium <0.6, а стоит 0.8.14"] },
            { file_name: "iris.jar", state: "ok", state_label: "конфликтов не найдено", notes: [] },
            { file_name: "old.jar", state: "disabled", state_label: "выключен", notes: [] },
          ],
          total: 4, ok: 2, warnings: 0, blocked: 1, can_launch: false,
        },
        journal: [{ at: now - 3600, action: "Установлено", what: "Iris Shaders 1.10.8", reason: "выбран вами", snapshot: "s1" }],
      };
    }
    case "snapshots_list": return [
      { id: "s2", reason: "Перед установкой Distant Horizons", created_at: now - 3600, pinned: false, auto: true, mods: 44, configs: 121 },
      { id: "s1", reason: "Чистая сборка 1.8", created_at: now - 9 * 86400, pinned: true, auto: false, mods: 42, configs: 118 },
    ];
    case "snapshot_diff": return { added: ["mods/DistantHorizons-2.3.4.jar"], removed: [], changed: [], options: [["renderDistance", "12", "16"]] };
    case "worlds_list": return [
      { folder: "New World", name: "База у реки", version_name: "26.3", data_version: 5023, game_mode: "выживание", hardcore: false, last_played: now - 3600, size: 21_000_000,
        backups: [{ world: "New World", file: "/b/New World-1.zip", size: 18_000_000, created_at: now - 7200 }, { world: "New World", file: "/b/New World-2.zip", size: 17_500_000, created_at: now - 86400 * 2 }] },
      { folder: "Creative", name: "Творческий", version_name: "26.4-snapshot-2", data_version: 5101, game_mode: "творчество", hardcore: true, last_played: now - 86400 * 9, size: 4_200_000, backups: [] },
    ];
    case "world_restore": return "New World";
    case "history_items": return [
      { id: "tech", name: "Технология+", game_version: "26.3", loader: "fabric", entries: 4, last_at: now - 3600, alive: true },
      { id: "survival", name: "Выживание с друзьями", game_version: "1.20.1", loader: "forge", entries: 9, last_at: now - 86400 * 40, alive: false },
    ];
    case "history_timeline": return [
      { at: now - 86400 * 9, mods: 42, changes: [{ kind: "created", files: 48 }] },
      { at: now - 86400 * 6, mods: 43, changes: [{ kind: "added", folder: "mods", title: "Iris Shaders", version: "1.10.8" }, { kind: "configs", changed: 2 }] },
      { at: now - 86400 * 2, mods: 43, changes: [{ kind: "updated", folder: "mods", title: "Sodium", from: "0.8.12", to: "0.8.14" }, { kind: "disabled", title: "Indium" }] },
      { at: now - 3600, mods: 44, changes: [{ kind: "added", folder: "mods", title: "Distant Horizons", version: "2.3.4" }, { kind: "added", folder: "shaderpacks", title: "BSL" }, { kind: "removed", folder: "resourcepacks", title: "Old Pack" }, { kind: "settings" }] },
    ];
    case "trash_list": return [{ key: "survival-1764100000", id: "survival", name: "Выживание с друзьями", game_version: "1.20.1", loader: "forge", deleted_at: now - 86400 * 3, size: 312_000_000 }];
    case "worlds_foreign": return [
      { owner_id: "old", owner_name: null, owner_loader: null, older: false, world: { folder: "Island", name: "Остров", version_name: "26.3", data_version: 5023, game_mode: "выживание", hardcore: false, last_played: now - 86400 * 20, size: 54_000_000, backups: [] } },
      { owner_id: "shaders", owner_name: "Шейдеры", owner_loader: "Quilt", older: true, world: { folder: "Old", name: "Старый город", version_name: "1.21.11", data_version: 4671, game_mode: "творчество", hardcore: false, last_played: now - 86400 * 90, size: 120_000_000, backups: [] } },
    ];
    case "import_sources": return { prism: [["/Users/player/Library/Application Support/PrismLauncher/instances/Tech", "Технология+ (1.21.11 · Fabric)"]], official: "/Users/player/Library/Application Support/minecraft" };
    case "mods_check_updates": return { changes: [{ kind: "update", title: "Sodium", old_version: "0.8.12", new_version: "0.8.14", reason: "новая версия", size: 1914874 }], notes: ["Моды, которых нет на Modrinth, проверить на обновления нельзя"] };
    case "catalog_installed": return [{ project_id: "AANobbMI", slug: "sodium", title: "Sodium", description: "Современный движок отрисовки, заметно поднимает FPS", downloads: 250585660, author: "", client_side: "required", categories: [] }];
    case "modpack_search": return { hits: [{ project_id: "1KVo5zza", slug: "fabulously-optimized", title: "Fabulously Optimized", description: "Простая сборка для быстрой и красивой игры", downloads: 12000000, author: "robotkoer", client_side: "required", categories: [] }], total_hits: 1 };
    case "catalog_search": return { hits: [
      { project_id: "AANobbMI", slug: "sodium", title: "Sodium", description: "Современный движок отрисовки, заметно поднимает FPS", downloads: 250585660, author: "jellysquid3", client_side: "required", categories: [] },
      { project_id: "YL57xq9U", slug: "iris", title: "Iris Shaders", description: "Шейдеры вместе с Sodium", downloads: 120000000, author: "coderbot", client_side: "required", categories: [] },
      { project_id: "gvQqBUqZ", slug: "lithium", title: "Lithium", description: "Оптимизация логики игры без изменения правил", downloads: 90000000, author: "jellysquid3", client_side: "optional", categories: [] },
    ], total_hits: 57 };
    case "__old_catalog_search": return { hits: [{ project_id: "AANobbMI", slug: "sodium", title: "Sodium", description: "Современный движок отрисовки, заметно поднимает FPS", downloads: 250585660, author: "jellysquid3", client_side: "required", categories: [] }], total_hits: 1 };
    default: return null;
  }
}, { shouldMockEvents: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
