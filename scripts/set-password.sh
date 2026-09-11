#!/bin/sh
# Guarda (o reemplaza) la contraseña SAP de un sistema en el llavero de macOS.
# La pide por teclado: no queda en el historial ni en ningún archivo.
#   scripts/set-password.sh MI_DEV
set -e
[ -n "$1" ] || { echo "uso: $0 <id-de-sistema>"; exit 1; }
security add-generic-password -U -s abap-adt-dozimple -a "$1" -w
echo "Contraseña de $1 guardada en el llavero (servicio abap-adt-dozimple)."
