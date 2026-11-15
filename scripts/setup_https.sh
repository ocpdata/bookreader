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
  # Cabeceras comunes de los proxies hacia la API (Host se conserva: el control de origen lo necesita).
  local proxy_common security_headers
  # add_header no se hereda en un location que define el suyo: estas cabeceras se repiten en cada uno.
  security_headers='add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "same-origin" always;'
  proxy_common='proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        '"${security_headers}"
  cat <<EOF
# Gestionado por scripts/setup_https.sh. El puerto 80 no sirve la aplicación: solo la
# validación de Let's Encrypt y la redirección a HTTPS (host fijo, no el de la petición).

server_tokens off;
limit_req_status 429;

# Límite de intentos de acceso (la API aplica además el suyo por cuenta). Rutas de las apps y de la web.
limit_req_zone \$binary_remote_addr zone=bookreader_login:10m rate=10r/m;

# El registro de accesos no debe guardar secretos: se usa \$uri (sin query: no queda ?token=) y los ids
# de sesión de reproducción de /public/session/ se ocultan.
map \$uri \$bookreader_logged_uri {
    ~^/public/session/    /public/session/[oculto];
    default               \$uri;
}
log_format bookreader '\$remote_addr [\$time_local] "\$request_method \$bookreader_logged_uri" \$status \$body_bytes_sent "\$http_user_agent"';

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

    access_log /var/log/nginx/bookreader.access.log bookreader;

    location /api/ {
        client_max_body_size 2m;
        ${proxy_common}
    }

    location = /api/auth/login {
        limit_req zone=bookreader_login burst=5 nodelay;
        ${proxy_common}
    }

    # Rutas de las apps compatibles con Audiobookshelf (viven en la raíz, fuera de /api).
    location = /ping {
        ${proxy_common}
    }

    location = /status {
        ${proxy_common}
    }

    # La pantalla web de acceso está en /entrar; /login es el acceso de las apps (POST) y redirige si se abre en un navegador.
    location = /login {
        limit_req zone=bookreader_login burst=5 nodelay;
        ${proxy_common}
    }

    location = /logout {
        ${proxy_common}
    }

    # Audio de las sesiones de reproducción: se transmite sin almacenar en búfer y con lecturas largas.
    location /public/session/ {
        ${proxy_common}
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Archivos con hash en el nombre (Vite): nunca cambian, se cachean por mucho tiempo.
    location /assets/ {
        try_files \$uri =404;
        # Sin "always": un 404 no debe quedar cacheado como inmutable.
        add_header Cache-Control "public, max-age=31536000, immutable";
        ${security_headers}
    }

    # index.html y el resto de la raíz: el navegador siempre revalida, así un despliegue nuevo
    # se ve de inmediato (index.html apunta a los assets con hash del release activo).
    location / {
        try_files \$uri /index.html;
        add_header Cache-Control "no-cache" always;
        ${security_headers}
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
