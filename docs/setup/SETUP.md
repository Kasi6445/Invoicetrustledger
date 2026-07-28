# Setup guide for Invoice Trust Ledger

This repository is designed to work from a fresh Windows + WSL2 machine in under 5 minutes in mock mode, and to support a longer Fabric-backed demo path when Docker is available.

## 1. Prerequisites on Windows + WSL2

Install these first:

- Windows 11 or recent Windows 10 build
- WSL2 with an Ubuntu distro
- Git
- Node.js 20+ and npm
- Docker Desktop with WSL2 integration enabled
- Optional: VS Code with the WSL extension

Inside WSL, verify the basics:

```bash
node -v
npm -v
docker --version
```

If Docker is installed but not reachable, start Docker Desktop and confirm:

```bash
docker run --rm hello-world
```

## 2. Clone and bootstrap the repo

From WSL:

```bash
cd ~
git clone <your-fork-or-repo-url> invoice-trust-ledger
cd invoice-trust-ledger
bash docs/setup/setup.sh
```

The bootstrap script is idempotent. It will:

- verify Node, npm, and Docker
- install dependencies in api, portal, and e2e
- create api/.env from api/.env.example
- default to mock mode for a fast start
- optionally set up the Fabric test network if you choose the longer path

## 3. Fast path: mock mode in about 5 minutes

Choose mock when you want the most reliable demo path.

```bash
cd ~/invoice-trust-ledger/api
node server.js
```

In a second terminal:

```bash
cd ~/invoice-trust-ledger/api
bash test-flow.sh
node seed.js
```

In a third terminal:

```bash
cd ~/invoice-trust-ledger/portal
npm run dev
```

Open http://localhost:5173 and log in with:

- supplier1 / demo123
- payer1 / demo123
- lloyds / demo123
- otherbank / demo123

## 4. Longer path: full Fabric mode

Choose fabric if you want the real Hyperledger Fabric test network.

The setup script will:

- ensure ~/fabric exists
- download or reuse install-fabric.sh
- install Fabric samples and binaries into ~/fabric/fabric-samples
- bring up the test network
- deploy the chaincode from ./chaincode

Then start the API with Fabric enabled:

```bash
cd ~/invoice-trust-ledger/api
node server.js
```

Run the same regression suite:

```bash
cd ~/invoice-trust-ledger/api
bash test-flow.sh
node seed.js
```

And launch the portal:

```bash
cd ~/invoice-trust-ledger/portal
npm run dev
```

## 5. What is not in git and why

The following items are intentionally not committed:

- api/.env
  - Reason: local secrets and environment-specific settings.
  - Obtained by: running docs/setup/setup.sh, which creates it from api/.env.example.

- node_modules/
  - Reason: local package installs are environment-specific and can be large.
  - Obtained by: npm install in api, portal, and e2e.

- api/data/
  - Reason: local demo ledger/off-chain state is generated at runtime.
  - Obtained by: starting the API and running node seed.js in mock mode.

- portal/dist/
  - Reason: generated build output for the portal.
  - Obtained by: npm run build in the portal.

- api/public/
  - Reason: generated build output for the hosted portal bundle.
  - Obtained by: npm run build:portal from the api folder.

- ~/fabric/fabric-samples/
  - Reason: large Fabric binaries, images, and test-network material live outside the repo.
  - Obtained by: docs/setup/setup.sh in fabric mode, or by running the Fabric install script manually.

- evidence-package.zip
  - Reason: generated evidence artifact from the e2e suite.
  - Obtained by: the e2e workflow when it packages evidence.

## 6. Final commands after setup

After the script completes, the terminal will print the commands to use next. The usual commands are:

```bash
cd ~/invoice-trust-ledger/api
node server.js
```

```bash
cd ~/invoice-trust-ledger/api
bash test-flow.sh
node seed.js
```

```bash
cd ~/invoice-trust-ledger/portal
npm run dev
```
