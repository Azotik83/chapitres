# Applique l'expediteur Resend au projet Supabase.
#
#     .\supabase\smtp.ps1
#
# Sans argument, le script DEMANDE la cle et la masque a la saisie :
# elle n'entre ni dans un fichier, ni dans l'historique PowerShell.
# C'est la bonne facon de faire. Le parametre -Key existe encore pour
# les scripts, mais il laisse la cle dans l'historique.
#
# Note : PowerShell n'a pas la syntaxe « VAR=valeur commande » du shell
# Unix. C'est ce qui faisait echouer la commande donnee au depart.
param(
  [string]$Key
)

if (-not $Key) {
  $secure = Read-Host "Colle ta cle Resend (elle ne s'affichera pas)" -AsSecureString
  $Key = [System.Net.NetworkCredential]::new("", $secure).Password
}

if (-not $Key) {
  Write-Host "Aucune cle fournie." -ForegroundColor Red
  exit 1
}
if (-not $Key.StartsWith("re_")) {
  Write-Host "Une cle Resend commence par « re_ ». Verifie ce que tu as colle." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Cle lue : $($Key.Length) caracteres. Envoi de la configuration..." -ForegroundColor DarkGray
Write-Host ""

$env:SMTP_PASSWORD = $Key
npx --yes supabase@latest config push --project-ref ziskwkobxfikcbybinny --yes
$code = $LASTEXITCODE
$env:SMTP_PASSWORD = $null
$Key = $null

Write-Host ""
if ($code -eq 0) {
  Write-Host "Configuration appliquee. Demande un code depuis l'app pour verifier." -ForegroundColor Green
} else {
  Write-Host "Echec (code $code). Colle la sortie ci-dessus." -ForegroundColor Red
}
