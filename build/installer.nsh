!macro customInstall
  DetailPrint "Installing ViGEmBus driver (required for game controller emulation)..."
  ExecShellWait "runas" "$INSTDIR\resources\tools\drivers\ViGEmBus_1.22.0_x64_x86_arm64.exe" "/q /norestart"
!macroend

