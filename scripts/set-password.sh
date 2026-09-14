#!/bin/sh
# Guarda (o reemplaza) la contraseña SAP de un sistema en el almacén de secretos
# del sistema operativo. La pide por teclado: no queda en el historial ni en
# ningún archivo.
#   scripts/set-password.sh MI_DEV            macOS: llavero · Linux: secret-tool
#   scripts/set-password.sh --strict MI_DEV   macOS: ninguna app queda autorizada;
#                                             el llavero pregunta en cada lectura
set -e
STRICT=""
if [ "$1" = "--strict" ]; then STRICT=1; shift; fi
[ -n "$1" ] || { echo "uso: $0 [--strict] <id-de-sistema>"; exit 1; }
SERVICE=abap-adt-dozimple

case "$(uname -s)" in
  Darwin)
    if [ -n "$STRICT" ]; then
      security add-generic-password -U -s "$SERVICE" -a "$1" -T "" -w
    else
      security add-generic-password -U -s "$SERVICE" -a "$1" -w
    fi
    echo "Contraseña de $1 guardada en el llavero (servicio $SERVICE)."
    ;;
  Linux)
    command -v secret-tool >/dev/null || { echo "Falta secret-tool (paquete libsecret-tools)."; exit 1; }
    secret-tool store --label="$SERVICE $1" service "$SERVICE" account "$1"
    echo "Contraseña de $1 guardada en el Secret Service (servicio $SERVICE)."
    ;;
  *)
    echo "Sistema no soportado: usa \"password\": \"env:VARIABLE\" en systems.json."; exit 1
    ;;
esac
