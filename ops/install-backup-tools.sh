#!/usr/bin/env bash
# [INPUT]: Ubuntu 24.04、PostgreSQL 官方 APT 与系统包源。
# [OUTPUT]: PostgreSQL 17 客户端、age、AWS CLI 和独立备份用户。
# [POS]: VPS 备份工具入口；不安装数据库服务，不调整端口或现有服务。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -euo pipefail
[[ $EUID -eq 0 ]]
source /etc/os-release
[[ $ID == ubuntu && $VERSION_CODENAME == noble ]]
install -d -m 0755 /usr/share/postgresql-common/pgdg
curl --fail --silent --show-error --location https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
cat > /etc/apt/sources.list.d/lifeos-pgdg.sources <<'APT'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
APT
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update -qq
apt-get install -y --no-install-recommends postgresql-client-17 age curl unzip gnupg
if ! command -v aws >/dev/null 2>&1; then
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' EXIT
  mkdir -m 0700 "$scratch/gnupg"
  gpg --homedir "$scratch/gnupg" --batch --import "$(dirname "$0")/aws-cli-team.asc"
  gpg --homedir "$scratch/gnupg" --with-colons --fingerprint FB5DB77FD5C118B80511ADA8A6310ACC4672475C \
    | grep -q 'fpr:::::::::FB5DB77FD5C118B80511ADA8A6310ACC4672475C:'
  curl --fail --silent --show-error --location https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o "$scratch/aws.zip"
  curl --fail --silent --show-error --location https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip.sig -o "$scratch/aws.zip.sig"
  gpg --homedir "$scratch/gnupg" --batch --verify "$scratch/aws.zip.sig" "$scratch/aws.zip"
  unzip -q "$scratch/aws.zip" -d "$scratch"
  "$scratch/aws/install" --install-dir /usr/local/aws-cli --bin-dir /usr/local/bin
fi
if ! id lifeos-backup >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/lifeos-backup --shell /usr/sbin/nologin lifeos-backup
fi
install -d -m 0700 -o lifeos-backup -g lifeos-backup /var/lib/lifeos-backup
install -d -m 0750 -o root -g lifeos-backup /etc/lifeos-backup
/usr/lib/postgresql/17/bin/pg_dump --version
age --version
aws --version
