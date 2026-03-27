import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { Transaction } from '@iota/iota-sdk/transactions';
import { NotarizationClient, NotarizationClientReadOnly, TimeLock, State } from '@iota/notarization/node';
import { HashUtil } from '../utils/hash.util.js';
import { IotaService } from './iota.service.js';
import { StorageService } from './storage.service.js';
import { IdentityService, NotarizationRecord } from './identity.service.js';
import * as dotenv from 'dotenv';
import { PublicKey } from '@iota/iota-sdk/cryptography';
import { Ed25519PublicKey } from '@iota/iota-sdk/keypairs/ed25519';

dotenv.config();

export interface NotarizationResult {
    digest: string;
    objectId: string;
    offchainUrl: string;
}

export class NotarizationService {
    private readOnlyClient: NotarizationClientReadOnly | null = null;

    // ─── Client helpers ────────────────────────────────────────────────────────

    /**
     * Initializes or returns the cached read-only client for the Notarization package.
     */
    private async getReadOnlyClient(): Promise<NotarizationClientReadOnly> {
        if (this.readOnlyClient) return this.readOnlyClient;

        const packageId = process.env.NOTARIZATION_PACKAGE_ID;
        if (!packageId) {
            throw new Error('NOTARIZATION_PACKAGE_ID not set in environment');
        }

        const iotaClient = IotaService.getClient();
        this.readOnlyClient = await NotarizationClientReadOnly.createWithPkgId(iotaClient as any, packageId);
        return this.readOnlyClient;
    }

    /**
     * Retrieves the backend signer keypair from environment variables.
     */
    private getSigner(): Ed25519Keypair {
        const privateKeyB64 = process.env.PRIVATE_KEY;
        if (!privateKeyB64) {
            throw new Error('PRIVATE_KEY not set in environment (required for backend signing)');
        }
        return Ed25519Keypair.fromSecretKey(privateKeyB64);
    }

    /**
     * Formats the signer into a wrapper compatible with the WASM client layer.
     */
    private buildSignerWrapper(keypair: Ed25519Keypair) {
        return {
            sign: async (txData: Uint8Array) => {
                const { signature } = await keypair.signTransaction(txData);
                return signature;
            },
            publicKey: async () => keypair.getPublicKey(),
            iotaPublicKeyBytes: async () => keypair.getPublicKey().toIotaBytes(),
            keyId: () => keypair.toIotaAddress(),
        };
    }

    // ─── Notarization ──────────────────────────────────────────────────────────

    /**
     * Executes the full notarization flow:
     * 1. Generates file hash & uploads original to IPFS.
     * 2. Creates an immutable locked object on the IOTA blockchain.
     * 3. Updates the remote registry (record.json) on Pinata for persistence.
     */
    async createOnChainNotarization(
        fileBuffer: Buffer,
        fileName: string,
        metadata: any 
    ): Promise<NotarizationResult> {
        const fileHashHex = HashUtil.sha256(fileBuffer);
        const fileHashUint8 = new Uint8Array(Buffer.from(fileHashHex, 'hex'));

        const offchainUrl = await StorageService.storeFile(fileBuffer, fileName);

        // 1. The ON-CHAIN metadata remains complete (contains issuedBy for audit)
        const metadataString = JSON.stringify({
            name: metadata.fileName,
            activityDid: metadata.activityDid,
            uploaderDid: metadata.uploaderDid,
            issuedBy: metadata.issuedBy, 
            expirationDate: metadata.expirationDate,
            offchainUrl,
            createdAt: new Date().toISOString(),
        });

        const readOnly = await this.getReadOnlyClient();
        const keypair = this.getSigner();
        const signerWrapper = this.buildSignerWrapper(keypair);
        const client = await NotarizationClient.create(readOnly, signerWrapper as any);

        const expirationTs = Math.floor(new Date(metadata.expirationDate).getTime() / 1000);
        
        const txBuilder = client
            .createLocked()
            .withBytesState(fileHashUint8, metadataString)
            .withDeleteLock(TimeLock.withUnlockAt(expirationTs))
            .finish()
            .withSender(keypair.toIotaAddress());

        const [txBytes] = await txBuilder.build(client);
        const tx = Transaction.from(txBytes);

        const result = await IotaService.getClient().signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: { showEffects: true, showObjectChanges: true },
        });

        const objectId = (result.objectChanges as any[])
            ?.find((c: any) => c.type === 'created')?.objectId;

        if (!objectId) throw new Error('Failed to extract objectId');

        await IdentityService.saveRecord(
            objectId, 
            metadata.activityDid
        );

        return { digest: result.digest, objectId, offchainUrl };
    }

    async getNotarization(objectId: string): Promise<any> {
        const iotaClient = IotaService.getClient();
        const response = await iotaClient.getObject({
            id: objectId,
            options: { showContent: true, showOwner: true }
        });

        const fields = (response.data?.content as any)?.fields;
        if (!fields) return null;

        try {
            // Description is inside immutable_metadata
            const immutableMetadata = fields.immutable_metadata?.fields;
            const descriptionRaw = immutableMetadata?.description;

            // Description is Option<String>: can be null or { fields: { vec: [...] } }
            const descriptionString =
                typeof descriptionRaw === 'string'
                    ? descriptionRaw
                    : descriptionRaw?.fields?.vec?.[0] ?? null;

            if (!descriptionString) {
                console.warn(`[NotarizationService] No description found for ${objectId}`);
                return null;
            }

            const parsed = JSON.parse(descriptionString);

            return {
                objectId,
                createdAt: parsed.createdAt ?? new Date(immutableMetadata?.created_at ?? 0).toISOString(),
                metadata: {
                    name:           parsed.name           ?? 'Untitled Document',
                    offchainUrl:    parsed.offchainUrl     ?? '',
                    expirationDate: parsed.expirationDate  ?? '',
                    activityDid:    parsed.activityDid     ?? '',
                    issuedBy:       parsed.issuedBy        ?? '',
                    uploaderDid:    parsed.uploaderDid      ?? '',
                }
            };
        } catch (e) {
            console.error(`[NotarizationService] Decode error for ID ${objectId}`, e);
            return null;
        }
    }

    /**
     * Fetches the current state (VC or Hash) of a specific object from the chain.
     */
    async getNotarizationState(objectId: string) {
        const client = await this.getReadOnlyClient();
        return await client.state(objectId);
    }


    async prepareNotarizationTransaction(
        fileBuffer: Buffer,
        fileName: string,
        metadata: any
    ): Promise<{ txBytes: string, metadataString: string, offchainUrl: string }> {

        // --- BACKEND VALIDATION ---
        // Verify that activityDid is a registered Business (Role 1)
        const cleanActAddress = metadata.activityDid.includes(':') 
            ? metadata.activityDid.split(':').pop() 
            : metadata.activityDid;
        
        const businessProfile = await IdentityService.getContractUser(cleanActAddress!);
        
        if (!businessProfile.registered) {
            throw new Error(`The Activity DID '${metadata.activityDid}' is not registered on-chain.`);
        }
        
        if (businessProfile.role === 2) {
            throw new Error(`Cannot notarize documents for a Technician identity. '${metadata.activityDid}' corresponds to an Authorized Technician.`);
        }
        // --------------------------

        const fileHashHex = HashUtil.sha256(fileBuffer);
        const fileHashUint8 = Array.from(Buffer.from(fileHashHex, 'hex'));
        const offchainUrl = await StorageService.storeFile(fileBuffer, fileName);

        const metadataString = JSON.stringify({
            name: fileName,
            activityDid: metadata.activityDid,
            issuedBy: metadata.issuedBy,
            expirationDate: metadata.expirationDate,
            offchainUrl,
            createdAt: new Date().toISOString(),
        });

        const expirationTs = Math.floor(
            new Date(metadata.expirationDate).getTime() / 1000
        );

        const packageId = process.env.NOTARIZATION_PACKAGE_ID;
        if (!packageId) throw new Error('NOTARIZATION_PACKAGE_ID not set');

        const CLOCK_ID = '0x0000000000000000000000000000000000000000000000000000000000000006';

        const tx = new Transaction();
        tx.setSender(metadata.technicianAddress);

        // 1. Build the State<vector<u8>> by calling new_state_from_bytes
        const [state] = tx.moveCall({
            target: `${packageId}::notarization::new_state_from_bytes`,
            arguments: [
                tx.pure.vector('u8', fileHashUint8),
                // Optional state metadata: Option<String> = none
                tx.moveCall({
                    target: '0x1::option::none',
                    typeArguments: ['0x1::string::String'],
                    arguments: [],
                }),
            ],
        });

        // 2. Build the TimeLock with unlock_at
        const [timeLock] = tx.moveCall({
            target: `${packageId}::timelock::unlock_at`,
            arguments: [
                tx.pure.u32(expirationTs),
                tx.object(CLOCK_ID),
            ],
        });

        // 3. Call locked_notarization::create
        tx.moveCall({
            target: `${packageId}::locked_notarization::create`,
            typeArguments: ['vector<u8>'],
            arguments: [
                state,
                // description: Option<String> with metadataString
                tx.moveCall({
                    target: '0x1::option::some',
                    typeArguments: ['0x1::string::String'],
                    arguments: [tx.pure.string(metadataString)],
                }),
                // updatable_metadata: Option<String> = none
                tx.moveCall({
                    target: '0x1::option::none',
                    typeArguments: ['0x1::string::String'],
                    arguments: [],
                }),
                timeLock,
                tx.object(CLOCK_ID),
            ],
        });

        const iotaClient = IotaService.getClient();
        const txBytes = await tx.build({ client: iotaClient as any });

        return {
            txBytes: Buffer.from(txBytes).toString('base64'),
            metadataString,
            offchainUrl
        };
    }
}