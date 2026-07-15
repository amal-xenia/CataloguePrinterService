!macro customInstall
  # Write registry key for autostart (most reliable method for NSIS)
  # This ensures the app starts on Windows login for the current user
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Xenia-Printer-App" '"$INSTDIR\Xenia-Printer-App.exe" --hidden'

  # Also create a shortcut in the Startup folder as a fallback
  CreateShortCut "$SMSTARTUP\Xenia-Printer-App.lnk" "$INSTDIR\Xenia-Printer-App.exe" "--hidden"
!macroend

!macro customUninstall
  # Remove the registry key on uninstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Xenia-Printer-App"

  # Remove the startup shortcut on uninstall
  Delete "$SMSTARTUP\Xenia-Printer-App.lnk"

  # Also clean up the old shortcut name in case it was there from a previous version
  Delete "$SMSTARTUP\PrinterApp.lnk"
!macroend
