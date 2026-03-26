# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.0.1] - 24-03-2026

### Added
- **IPFS Pinata Storage**: Integrated Axios to pin uploaded files securely to the permanent IPFS network via Pinata.
- **Dedicated Gateway Support**: Added `PINATA_GATEWAY_URL`, `PINATA_API_KEY` and `PINATA_SECRET_API_KEY`, `PINATA_JWT` environment variables for reliable custom HTTP IPFS gateway resolution.

### Changed
- **Storage Service Refactor**: Deprecated the local file-system `uploads/` directory in favor of decentralized immutable IPFS storage.

## [1.0.0] - 20-03-2026

### Added
- **Uploader Attribution**: Added `uploaderDid` support across the controller and service layers.
- **Automated Record Management**: The `notarizeUpload` controller now automatically triggers the indexing in `IdentityService` upon successful blockchain execution.
- **Centralized Storage Service**: Introduced `StorageService` to handle off-chain filesystem storage for notarized files with unique ID generation.
- **SHA256 Integrity Verification**: Implementation of `HashUtil` for consistent file hashing before on-chain notarization.
- **Wallet authentication flow (Nonce/Verify)**.
- **Basic IOTA SDK integration**.
- Added POST /api/documents/:objectId/certify endpoint with cryptographic wallet signature verification via verifyPersonalMessageSignature, enabling technicians to issue Verifiable Credentials signed from their IOTA wallet
- Added GET /api/documents/all endpoint and getAllRecords() method to IdentityService to retrieve all notarization records
- **Finalize Notarization Route**: Added `POST /v1/identity/save-id` endpoint to handle the final stage of the notarization workflow.
- **DID-Certificate Mapping**: Implemented a new logic to create and pin a JSON metadata file on IPFS (via Pinata) that links a venue's `did` directly to its specific certificates.
- **Persistence Layer**: Enabled the controller to bridge local identity data with decentralized storage, ensuring certificates are correctly attributed to the venue's decentralized identifier.

### Changed
- **Notarization Service Refactor**: Streamlined the `createOnChainNotarization` flow to handle metadata construction and on-chain hashing in a single service call.
- **Workflow Optimization**: Refactored the finalization process to ensure that once a certificate is notarized, the association between the Venue DID and the IPFS CID is permanently stored.

### Security
- **Server-Side Signing**: Implemented secure transaction signing using the backend's `PRIVATE_KEY` (Ed25519) to automate notarization on behalf of users.
- **Multi-Part Buffer Handling**: Secured file uploads using Memory Storage to prevent temporary file leaks during processing.

