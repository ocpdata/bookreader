#!/usr/bin/env bash
set -euo pipefail

exec 9>/var/lock/bookreader-cloudwatch-agent.lock
flock -w 600 9

if ! dpkg-query -W -f='${Status}' amazon-cloudwatch-agent 2>/dev/null | grep -q 'install ok installed'; then
  arch="$(dpkg --print-architecture)"
  case "$arch" in amd64|arm64) ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
  package="$(mktemp)"
  trap 'rm -f "$package"' EXIT
  curl -fsSL "https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/$arch/latest/amazon-cloudwatch-agent.deb" -o "$package"
  dpkg -i "$package"
  rm -f "$package"
  trap - EXIT
fi

config=/opt/aws/amazon-cloudwatch-agent/etc/bookreader.json
new_config="$(mktemp)"
trap 'rm -f "$new_config"' EXIT
cat > "$new_config" <<'EOF'
{
  "agent": { "metrics_collection_interval": 60 },
  "metrics": {
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "aggregation_dimensions": [["InstanceId"]],
    "metrics_collected": {
      "mem": { "measurement": ["mem_used_percent"] },
      "disk": {
        "measurement": ["used_percent"],
        "resources": ["/"],
        "drop_original_metrics": ["disk_used_percent"]
      }
    }
  }
}
EOF
if ! cmp -s "$new_config" "$config" || ! systemctl is-active --quiet amazon-cloudwatch-agent; then
  install -m 644 "$new_config" "$config"
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config -m ec2 -c "file:$config" -s
fi
systemctl is-active --quiet amazon-cloudwatch-agent
