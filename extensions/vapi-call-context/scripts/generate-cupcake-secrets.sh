#!/usr/bin/env bash
# PREP ONLY — generates replacement secrets into a NEW staging directory.
# It does not touch n8n, systemd, nginx, Vapi, or any running service, and it never
# prints a secret value (only sha256 fingerprints). Apply per runbooks/key-rotation.md
# after Matt approves the rotation.
#
#   sudo ./generate-cupcake-secrets.sh /root/cupcake-rotation-$(date +%Y%m%d)
set -euo pipefail

out="${1:-}"
if [[ -z "$out" ]]; then
  echo "usage: $0 <new-staging-dir>" >&2
  exit 2
fi
if [[ -e "$out" ]]; then
  echo "refusing: $out already exists (never overwrite staged secrets)" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

umask 077
mkdir -p "$out"

# One secret per trust boundary: Vapi->call-context, Vapi tools->brain, n8n webhook
# callers, and owner access to the private library. They were shared before; splitting
# them is what makes the next rotation (or a leak) cheap.
names=(
  vapi-webhook-secret
  cupcake-brain-key
  cupcake-webhook-key
  cupcake-library-key
)
for name in "${names[@]}"; do
  openssl rand -hex 32 | tr -d '\n' >"$out/$name"
  chmod 0600 "$out/$name"
done

echo "staged ${#names[@]} secrets in $out (mode 0600):"
for name in "${names[@]}"; do
  printf '  %-22s sha256:%s\n' "$name" "$(sha256sum "$out/$name" | cut -c1-12)"
done

cat <<EOF2

Next (NOT done by this script; see runbooks/key-rotation.md):
  install -d -m 0700 /etc/cupcake-vapi-call-context
  install -m 0600 $out/vapi-webhook-secret  /etc/cupcake-vapi-call-context/vapi-webhook-secret
  install -m 0600 $out/cupcake-library-key  /etc/cupcake-vapi-call-context/cupcake-library-key

systemd drop-in (vapi-call-context.service.d/credentials.conf):
  [Service]
  LoadCredential=vapi-webhook-secret:/etc/cupcake-vapi-call-context/vapi-webhook-secret
  LoadCredential=cupcake-library-key:/etc/cupcake-vapi-call-context/cupcake-library-key
  LoadCredential=vapi-api-key:/etc/cupcake-vapi-call-context/vapi-api-key
EOF2
