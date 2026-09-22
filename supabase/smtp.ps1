# Applique l'expediteur Resend au projet Supabase.
#
#     .\supabase\smtp.ps1 -Key "re_ta_cle"
#
# PowerShell n'a pas la syntaxe « VAR=valeur commande » du shell Unix :
# c'est ce qui faisait echouer la commande donnee au depart. Ce script
# pose la variable correctement, puis pousse la configuration.
param(
  [Parameter(Mandatory = $true)]
  [string]$Key
)

$env:SMTP_PASSWORD = $Key
npx --yes supabase@latest config push --project-ref ziskwkobxfikcbybinny --yes
$env:SMTP_PASSWORD = $null
