# phloxCert_backend

**Backend API for the PhloxCert project.**

This service provides the server-side authentication flow and API endpoints used by the frontend for:
- nonce challenge / signature verification (wallet login)
- fetching IOTA owned objects

It is built with **Express + TypeScript** and uses **IOTA SDK** to talk to a local IOTA node.

---

## 📦 Setup

### 1) Install packages
```bash
npm install
```

### 2) Configure environment
Create a `.env` file from the sample and update values:
```bash
cp .env.example .env
```

Then edit `.env` and set:
- `PORT` → API port (default `8080`)
- `IOTA_NODE_URL` → the IOTA node (e.g. `http://127.0.0.1:14265` or `http://localhost:9000`)
- `PACKAGE_ID` → deployed Registry Move package ID
- `REGISTRY_ID` → deployed registry object ID
- `NOTARIZATION_PACKAGE_ID` → deployed notarization-move package ID
- `PRIVATE_KEY` → A valid Ed25519 secret key for the server to spawn and sign Notarization transactions.
- `PINATA_JWT` → Pinata JWT for IPFS file uploads (Alternatively, set `PINATA_API_KEY` and `PINATA_SECRET_API_KEY`).

### 3) Run
```bash
npm run dev
```

The server will start (default `http://localhost:8080`).


## 🔑 Security & Configuration

### Obtaining the `PRIVATE_KEY` for the backend
1. Generate an address: `iota client new-address ed25519`
2. Get the secret key: `iota client keytool <YOUR_ADDR>`
3. The format should be a string starting with `iotaprivkey1...`

### Pinata IPFS Setup
The backend uses Pinata to pin uploaded files to the permanent IPFS network.
1. Create a free account at [Pinata](https://app.pinata.cloud/).
2. Go to the API Keys section and create a new key (or get a JWT).
3. Copy the **JWT** token and use it as `PINATA_JWT` in your `.env` file. (Alternatively use `PINATA_API_KEY` and `PINATA_SECRET_API_KEY`).
4. (Optional) Provide your dedicated gateway URL in `PINATA_GATEWAY_URL` (e.g., `https://my-gateway.mypinata.cloud`) to ensure reliable file resolution. If omitted, the public `gateway.pinata.cloud` is used.

### Dual-Identity Indexing
The backend uses a JSON-based indexing system (located in `.data/`) that mirrors the on-chain state for fast querying. This index is automatically updated whenever a notarization is created, ensuring that the History view is always perfectly synced with both the uploader's and the subject's activity.

---

## 📌 Notes

- **Fail-Fast**: The server will not start if `NOTARIZATION_PACKAGE_ID` or `PRIVATE_KEY` are missing.
- **Storage**: Files are saved in the `uploads/` directory with standardized naming conventions.
