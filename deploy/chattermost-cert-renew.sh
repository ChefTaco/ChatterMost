#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fqdn='__TAILSCALE_HOST__'
if [[ ! "$fqdn" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]]; then
  echo 'Invalid rendered Tailscale certificate hostname.' >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo 'Certificate renewal must run as root.' >&2
  exit 1
fi

certificate_root='/var/lib/tailscale/certs'
certificate="$certificate_root/$fqdn.crt"
private_key="$certificate_root/$fqdn.key"
staging_dir="$(mktemp -d /run/chattermost-cert-renew.XXXXXX)"
had_previous=0
cleanup() {
  rm -rf -- "$staging_dir"
}
trap cleanup EXIT

restore_previous() {
  if [[ "$had_previous" == 1 ]]; then
    install -m 0644 "$staging_dir/previous-certificate" "$certificate"
    install -m 0600 "$staging_dir/previous-private-key" "$private_key"
  else
    rm -f -- "$certificate" "$private_key"
  fi
}

install -d -m 0700 "$certificate_root"
if [[ -e "$certificate" || -e "$private_key" ]]; then
  if [[ ! -f "$certificate" || ! -f "$private_key" ]]; then
    echo 'Existing certificate state is incomplete; refusing renewal.' >&2
    exit 1
  fi
  cp -p -- "$certificate" "$staging_dir/previous-certificate"
  cp -p -- "$private_key" "$staging_dir/previous-private-key"
  had_previous=1
fi
tailscale cert --cert-file "$staging_dir/certificate" --key-file "$staging_dir/private-key" "$fqdn"
openssl x509 -in "$staging_dir/certificate" -noout -checkend 1209600
openssl x509 -in "$staging_dir/certificate" -noout -checkhost "$fqdn"
install -m 0644 "$staging_dir/certificate" "$certificate"
install -m 0600 "$staging_dir/private-key" "$private_key"
if ! nginx -t; then
  restore_previous
  nginx -t || true
  exit 1
fi
if ! systemctl reload nginx.service; then
  restore_previous
  nginx -t || true
  systemctl reload nginx.service || true
  exit 1
fi
