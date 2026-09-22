# Diagnostic SMTP.
#
#     python supabase/test-smtp.py re_ta_cle
#
# Supabase masque la vraie cause derriere « Error sending magic link
# email ». Ce script parle directement a Resend et affiche le refus
# exact : mauvaise cle, mauvais port, ou destinataire interdit.
#
# Il n'ecrit la cle nulle part et n'envoie qu'a ton adresse.

import smtplib
import ssl
import sys
from email.message import EmailMessage

DEST = "axel.algarinscemama@yahoo.com"
EXPEDITEUR = "onboarding@resend.dev"
HOTE = "smtp.resend.com"
UTILISATEUR = "resend"

if len(sys.argv) < 2:
    print("Usage : python supabase/test-smtp.py re_ta_cle")
    raise SystemExit(1)

CLE = sys.argv[1].strip()
print("cle : %d caracteres, prefixe %s\n" % (len(CLE), CLE[:6]))


def message():
    m = EmailMessage()
    m["From"] = EXPEDITEUR
    m["To"] = DEST
    m["Subject"] = "Test RAPTAT"
    m.set_content("Si tu lis ceci, l'expediteur fonctionne.")
    return m


def essai(port, mode):
    etiquette = "port %-5s %s" % (port, mode)
    try:
        ctx = ssl.create_default_context()
        if mode == "SSL":
            s = smtplib.SMTP_SSL(HOTE, port, context=ctx, timeout=25)
        else:
            s = smtplib.SMTP(HOTE, port, timeout=25)
            s.ehlo()
            s.starttls(context=ctx)
            s.ehlo()
        try:
            s.login(UTILISATEUR, CLE)
        except smtplib.SMTPAuthenticationError as e:
            print("%s -> AUTHENTIFICATION REFUSEE : %s" % (etiquette, e.smtp_error.decode(errors="replace")[:150]))
            print("   => la cle est invalide, ou elle n'a pas le droit « Sending access ».")
            s.close()
            return False
        try:
            s.send_message(message())
            print("%s -> ENVOI REUSSI. Regarde ta boite (et les indesirables)." % etiquette)
            s.quit()
            return True
        except smtplib.SMTPRecipientsRefused as e:
            print("%s -> DESTINATAIRE REFUSE : %s" % (etiquette, str(e)[:200]))
            print("   => onboarding@resend.dev ne peut ecrire QU'A l'adresse du compte")
            print("      Resend. Ton compte Resend utilise-t-il bien %s ?" % DEST)
            s.close()
            return False
        except Exception as e:
            print("%s -> ENVOI REFUSE : %s" % (etiquette, str(e)[:220]))
            s.close()
            return False
    except Exception as e:
        print("%s -> CONNEXION IMPOSSIBLE : %s" % (etiquette, str(e)[:160]))
        return False


print("Ce que l'app utilise aujourd'hui :")
ok465 = essai(465, "SSL")
print()
print("La solution de repli, si le port 465 ne passe pas :")
ok587 = essai(587, "STARTTLS")

print()
print("=" * 58)
if ok465:
    print("Le port 465 fonctionne. Le probleme est donc ailleurs :")
    print("colle-moi la sortie complete, je cherche cote Supabase.")
elif ok587:
    print("Le port 587 fonctionne mais pas le 465.")
    print("Dis-le-moi : je bascule la configuration sur 587.")
else:
    print("Aucun port ne passe. La cause exacte est ecrite au-dessus.")
