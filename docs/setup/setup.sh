#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="$ROOT_DIR/api"
PORTAL_DIR="$ROOT_DIR/portal"
E2E_DIR="$ROOT_DIR/e2e"
HOME_DIR="${HOME}"
FABRIC_ROOT="$HOME_DIR/fabric"
FABRIC_SAMPLES="$FABRIC_ROOT/fabric-samples"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_env_file() {
  if [ ! -f "$API_DIR/.env" ]; then
    cp "$API_DIR/.env.example" "$API_DIR/.env"
  fi

  if grep -q '^FABRIC_SAMPLES=' "$API_DIR/.env"; then
    sed -i "s#^FABRIC_SAMPLES=.*#FABRIC_SAMPLES=$FABRIC_SAMPLES#" "$API_DIR/.env"
  else
    printf '\nFABRIC_SAMPLES=%s\n' "$FABRIC_SAMPLES" >> "$API_DIR/.env"
  fi

  if grep -q '^JWT_SECRET=' "$API_DIR/.env"; then
    sed -i "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 24)}#" "$API_DIR/.env"
  else
    printf 'JWT_SECRET=%s\n' "${JWT_SECRET:-$(openssl rand -hex 24)}" >> "$API_DIR/.env"
  fi

  if grep -q '^LEDGER_MODE=' "$API_DIR/.env"; then
    sed -i "s#^LEDGER_MODE=.*#LEDGER_MODE=mock#" "$API_DIR/.env"
  else
    printf 'LEDGER_MODE=mock\n' >> "$API_DIR/.env"
  fi
}

install_deps() {
  echo "Installing Node dependencies..."
  (cd "$API_DIR" && npm install)
  (cd "$PORTAL_DIR" && npm install)
  (cd "$E2E_DIR" && npm install)
}

setup_fabric() {
  mkdir -p "$FABRIC_ROOT"
  if [ ! -f "$FABRIC_ROOT/install-fabric.sh" ]; then
    curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o "$FABRIC_ROOT/install-fabric.sh"
    chmod +x "$FABRIC_ROOT/install-fabric.sh"
  fi

  if [ ! -d "$FABRIC_SAMPLES" ]; then
    (cd "$FABRIC_ROOT" && ./install-fabric.sh docker samples binary)
  fi

  echo "Bringing up Fabric test network..."
  (cd "$FABRIC_SAMPLES/test-network" && ./network.sh down >/dev/null 2>&1 || true)
  (cd "$FABRIC_SAMPLES/test-network" && ./network.sh up createChannel -c mychannel -ca)
  (cd "$FABRIC_SAMPLES/test-network" && ./network.sh deployCC -ccn invoicecc -ccp "$ROOT_DIR/chaincode" -ccl javascript)
}

prompt_mode() {
  echo "Choose the setup mode:"
  echo "1) mock (fast, no Docker required)"
  echo "2) fabric (longer, requires Docker and Fabric samples)"
  read -r -p "Enter 1 or 2 [1]: " mode
  mode="${mode:-1}"
  if [ "$mode" = "2" ]; then
    return 0
  fi
  return 1
}

main() {
  require_command node
  require_command npm
  require_command docker

  ensure_env_file
  install_deps

  if prompt_mode; then
    setup_fabric
    echo "Fabric setup completed."
  else
    echo "Mock mode selected."
  fi

  echo
  echo "Next commands:"
  echo "  cd $API_DIR && node server.js"
  echo "  cd $API_DIR && bash test-flow.sh && node seed.js"
  echo "  cd $PORTAL_DIR && npm run dev"
}

main "$@"
