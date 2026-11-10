#!/usr/bin/env bash
# One-time setup from GitHub Codespaces (or any trusted machine).
# NEVER commit the private keystore or its passwords.
set -euo pipefail
REPO="youef/app_apk"
for tool in gh keytool openssl base64; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. Open a GitHub Codespace with Java JDK installed."; exit 1; }
done
gh auth status >/dev/null || { echo "Sign in to GitHub CLI first: gh auth login"; exit 1; }
echo "Setting up the permanent signing identity for $REPO"
echo "Choose a strong BACKUP PASSWORD and remember it. It will protect the encrypted key backup."
read -r -s -p "Backup password: " BACKUP_PASSWORD; echo
[[ ${#BACKUP_PASSWORD} -ge 12 ]] || { echo "Use at least 12 characters"; exit 1; }
read -r -s -p "Repeat backup password: " CONFIRM_PASSWORD; echo
[[ "$BACKUP_PASSWORD" == "$CONFIRM_PASSWORD" ]] || { echo "Passwords differ"; exit 1; }
unset CONFIRM_PASSWORD
umask 077
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"; unset STORE_PASSWORD KEY_PASSWORD BACKUP_PASSWORD' EXIT
KEYSTORE="$WORK_DIR/al-ezz-stable.jks"
STORE_PASSWORD="$(openssl rand -hex 32)"
KEY_PASSWORD="$STORE_PASSWORD"
keytool -genkeypair -noprompt -keystore "$KEYSTORE" -storetype JKS \
  -storepass "$STORE_PASSWORD" -keypass "$KEY_PASSWORD" \
  -alias alezz-stable -keyalg RSA -keysize 3072 -validity 10000 \
  -dname "CN=Al Ezz TV, OU=Android, O=Al Ezz TV, C=SA"
echo "Uploading signing credentials to GitHub encrypted Actions secrets..."
base64 -w 0 "$KEYSTORE" | gh secret set AL_EZZ_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$STORE_PASSWORD" | gh secret set AL_EZZ_STORE_PASSWORD -R "$REPO"
printf '%s' 'alezz-stable' | gh secret set AL_EZZ_KEY_ALIAS -R "$REPO"
printf '%s' "$KEY_PASSWORD" | gh secret set AL_EZZ_KEY_PASSWORD -R "$REPO"
BACKUP_FILE="$PWD/al-ezz-stable-key-backup.enc"
printf '%s' "$BACKUP_PASSWORD" | openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$KEYSTORE" -out "$BACKUP_FILE" -pass stdin
chmod 600 "$BACKUP_FILE"
echo
echo "Four GitHub Actions secrets were configured for $REPO."
echo "IMPORTANT: download $BACKUP_FILE via Codespaces file explorer to a safe private location."
echo "Keep the backup password safe. Without the keystore, you cannot sign compatible upgrades."
echo "Do NOT commit or upload the backup file to the repository."
echo "After downloading and confirming the backup, you may trigger the stable release workflow."
