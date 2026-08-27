!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Souhaitez-vous également supprimer définitivement toutes les données de surveillance résiduelles (base de données SQLite %APPDATA%\defudelog, logs et configurations de DefuDelog) ?" IDNO skip_data_purge
    DetailPrint "Suppression des données de surveillance DefuDelog..."
    RMDir /r "$APPDATA\defudelog"
    RMDir /r "$LOCALAPPDATA\defudelog"
  skip_data_purge:
!macroend
