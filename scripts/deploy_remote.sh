#!/usr/bin/env bash
# Se ejecuta en la VM como usuario deployer.
# Uso: deploy_remote.sh <release.tgz> <api.env> <release_id> <run_migrations: true|false>
set -euo pipefail

archive="$1"
env_file="$2"
release_id="$3"
run_migrations="${4:-true}"

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
  sudo journalctl -u bookreader-api -n 40 --no-pager >&2 || true
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
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
ok=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1/ 2>/dev/null | grep -q 'id="root"'; then
    ok=true
    break
  fi
  sleep 2
done
if [[ "$ok" != "true" ]]; then
  false
fi
trap - ERR

curl -fsS http://127.0.0.1/api/health && echo

# Conserva solo los últimos releases.
cd "${app_root}/releases"
ls -1t | tail -n +$((keep_releases + 1)) | while read -r old; do
  [[ "${app_root}/releases/${old}" == "$(readlink -f "$current_link")" ]] || rm -rf -- "$old"
done

echo "Release ${release_id} activo."
