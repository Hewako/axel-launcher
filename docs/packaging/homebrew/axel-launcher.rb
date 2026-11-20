# Заготовка cask для своего tap: репозиторий Hewako/homebrew-tap, файл Casks/axel-launcher.rb.
# Установка у игрока: brew install --cask hewako/tap/axel-launcher
# Перед публикацией: VERSION и SHA256 (из SHA256SUMS.txt), `brew audit --cask --new` и
# `brew install --cask ./Casks/axel-launcher.rb` на Mac.
cask "axel-launcher" do
  version "VERSION"
  sha256 "SHA256"

  url "https://github.com/Hewako/quarry-launcher/releases/download/v#{version}/Axel-Launcher-macOS.dmg"
  name "Axel Launcher"
  desc "Open-source Minecraft: Java Edition launcher for profiles and modpacks"
  homepage "https://github.com/Hewako/quarry-launcher"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "Axel Launcher.app"

  # Миры и профили (~/.quarry) намеренно не перечислены в zap: решение владельца —
  # удаление программы данные игрока не трогает.

  caveats <<~EOS
    Axel Launcher is not notarized by Apple. On first launch macOS will block it:
    open System Settings → Privacy & Security and click "Open Anyway".
  EOS
end
