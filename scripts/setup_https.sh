#!/usr/bin/env bash
# Configura HTTPS (Let's Encrypt + Nginx) en la VM. Se ejecuta como root (sudo bash).
# Uso: setup_https.sh <prepare|issue> <dominio> <correo>
#   prepare: instala certbot y deja el puerto 80 solo para la validación y la redirección a HTTPS.
#   issue:   emite el certificado (el puerto 80 debe ser accesible desde Internet), activa el
#            servidor 443 y comprueba la renovación automática.
set -euo pipefail

stage="${1:?stage}"
domain="${2:?domain}"
email="${3:?email}"

app_root=/var/app/bookreader/current/frontend/dist
site=/etc/nginx/sites-available/bookreader
cert_dir="/etc/letsencrypt/live/${domain}"

render_nginx() {
  local with_tls="$1"
  cat <<EOF
# Gestionado por scripts/setup_https.sh. El puerto 80 no sirve la aplicación: solo la
# validación de Let's Encrypt y la redirección a HTTPS (host fijo, no el de la petición).
server {
    listen 80 default_server;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://${domain}\$request_uri;
    }
}
EOF
  if [[ "$with_tls" == "yes" ]]; then
    cat <<EOF

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate ${cert_dir}/fullchain.pem;
    ssl_certificate_key ${cert_dir}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    root ${app_root};
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri /index.html;
    }
}
EOF
  fi
}

apply_nginx() {
  local with_tls="$1" tmp
  tmp="$(mktemp)"
  render_nginx "$with_tls" > "$tmp"
  install -m 0644 "$tmp" "$site"
  rm -f "$tmp"
  ln -sfn "$site" /etc/nginx/sites-enabled/bookreader
  nginx -t
  systemctl reload nginx
}

case "$stage" in
  prepare)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y certbot
    install -d -m 755 /var/www/certbot
    # Si ya hay certificado se conserva el servidor 443.
    if [[ -f "${cert_dir}/fullchain.pem" ]]; then apply_nginx yes; else apply_nginx no; fi
    echo "Puerto 80: solo validación y redirección."
    ;;
  issue)
    [[ -f "${cert_dir}/fullchain.pem" ]] || certbot certonly --webroot -w /var/www/certbot \
      -d "$domain" --email "$email" --agree-tos --no-eff-email --non-interactive
    apply_nginx yes

    install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
    cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
    chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

    systemctl enable --now certbot.timer
    certbot renew --dry-run
    certbot certificates | grep -E "Certificate Name|Domains|Expiry Date"
    # Comprobación local del servidor 443 con el dominio (SNI).
    curl -fsS --resolve "${domain}:443:127.0.0.1" "https://${domain}/api/health"
    echo
    ;;
  *)
    echo "stage desconocido: $stage" >&2
    exit 2
    ;;
esac
