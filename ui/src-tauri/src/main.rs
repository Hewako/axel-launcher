// Без окна консоли на Windows и в обычной, и в сборке разработчика (она тоже отладочная).
// Цена: на Windows вывод `npm run tauri dev` в терминал не идёт; на macOS и Linux не влияет.
#![windows_subsystem = "windows"]

fn main() {
    axel_ui_lib::run()
}
