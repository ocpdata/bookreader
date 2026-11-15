#!/usr/bin/env bash
# Se ejecuta en la VM como usuario deployer.
# Uso: deploy_remote.sh <release.tgz> <api.env> <release_id> <run_migrations: true|false> [dominio]
# Con dominio, el healthcheck pasa por HTTPS (443) con SNI; sin él, por HTTP (80).
set -euo pipefail

archive="$1"
env_file="$2"
release_id="$3"
run_migrations="${4:-true}"
domain="${5:-}"

app_root=/var/app/bookreader
release_root="${app_root}/releases/${release_id}"
current_link="${app_root}/current"
shared_env="${app_root}/shared/api.env"
keep_releases=5

previous_release=""
if [[ -L "$current_link" ]]; then
  previous_release="$(readlink -f "$current_link")"
fi

rollback() {
  echo "::error::El despliegue falló; revirtiendo." >&2
  sudo -n /usr/bin/systemctl status bookreader-api 2>&1 | tail -n 20 >&2 || true
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    # Las versiones anteriores exponen todas las categorías privadas y no pueden servir esta base.
    if [[ -f "${release_root}/backend/dist/categories/categories.service.js" \
      && ! -f "${previous_release}/backend/dist/categories/categories.service.js" ]]; then
      if sudo systemctl stop bookreader-api; then
        echo "::error::Rollback automático bloqueado: la versión anterior no aísla categorías privadas. El servicio quedó detenido; despliega una versión compatible." >&2
      else
        echo "::error::Rollback bloqueado y no se pudo detener bookreader-api; revisa el servicio manualmente." >&2
      fi
      return
    fi
    ln -sfn "$previous_release" "$current_link"
    sudo systemctl restart bookreader-api || true
    echo "Revertido a ${previous_release}" >&2
  fi
}

# El bootstrap de cloud-init debe haber terminado (Nginx, Node, servicio systemd).
for _ in $(seq 1 60); do
  [[ -f /var/lib/bookreader-bootstrap-done ]] && break
  echo "Esperando a que cloud-init termine..."
  sleep 10
done
[[ -f /var/lib/bookreader-bootstrap-done ]] || { echo "cloud-init no terminó a tiempo" >&2; exit 1; }

mkdir -p "$release_root"
tar -xzf "$archive" -C "$release_root"
install -m 0640 "$env_file" "$shared_env"
rm -f "$archive" "$env_file"

# Nginx (www-data) solo necesita atravesar estos directorios para llegar al frontend.
# shared/ (con las credenciales) se mantiene en 750.
chmod 751 "$app_root" "${app_root}/releases"

trap rollback ERR

if [[ "$run_migrations" == "true" ]]; then
  (
    cd "${release_root}/backend"
    export CHECKPOINT_DISABLE=1
    set -a
    # shellcheck disable=SC1090
    source "$shared_env"
    set +a
    npx prisma migrate deploy
    npx prisma db seed
  )
fi

ln -sfn "$release_root" "$current_link"
sudo systemctl restart bookreader-api

# Healthcheck local: API directa, y API y frontend estático a través de Nginx.
# Con dominio se usa HTTPS (el 80 solo redirige): --resolve fuerza SNI hacia 127.0.0.1.
if [[ -n "$domain" ]]; then
  front_url="https://${domain}"
  curl_front=(curl -fsS --resolve "${domain}:443:127.0.0.1")
else
  front_url="http://127.0.0.1"
  curl_front=(curl -fsS)
fi

ok=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 \
    && "${curl_front[@]}" "${front_url}/api/health" >/dev/null 2>&1 \
    && "${curl_front[@]}" "${front_url}/" 2>/dev/null | grep -q 'id="root"'; then
    ok=true
    break
  fi
  sleep 2
done
if [[ "$ok" != "true" ]]; then
  false
fi
trap - ERR

"${curl_front[@]}" "${front_url}/api/health" && echo

# Conserva solo los últimos releases.
cd "${app_root}/releases"
ls -1t | tail -n +$((keep_releases + 1)) | while read -r old; do
  [[ "${app_root}/releases/${old}" == "$(readlink -f "$current_link")" ]] || rm -rf -- "$old"
done

echo "Release ${release_id} activo."
