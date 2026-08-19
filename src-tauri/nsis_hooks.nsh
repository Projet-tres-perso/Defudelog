!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Souhaitez-vous également supprimer définitivement toutes les données de surveillance résiduelles (base de données SQLite %APPDATA%\defudolog, logs et configurations de DeFuDoLog) ?" IDNO skip_data_purge
    DetailPrint "Suppression des données de surveillance DeFuDoLog..."
    RMDir /r "$APPDATA\defudolog"
    RMDir /r "$LOCALAPPDATA\defudolog"
  skip_data_purge:
!macroend
