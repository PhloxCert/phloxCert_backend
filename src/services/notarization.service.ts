import { IotaClient } from '@iota/iota-sdk/client';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { Transaction } from '@iota/iota-sdk/transactions';
import { NotarizationClient, NotarizationClientReadOnly, TimeLock } from '@iota/notarization/node';
import { HashUtil } from '../utils/hash.util.js';
import { IotaService } from './iota.service.js';
import { StorageService } from './storage.service.js';
import { IdentityService } from './identity.service.js';
import * as dotenv from 'dotenv';

dotenv.config();

export interface NotarizationResult {
    digest: string;
    objectId: string;
    offchainUrl: string;
}

export class NotarizationService {
    private readOnlyClient: NotarizationClientReadOnly | null = null;

    private async getReadOnlyClient() {
        if (this.readOnlyClient) return this.readOnlyClient;

        const packageId = process.env.NOTARIZATION_PACKAGE_ID;
        if (!packageId) {
            throw new Error('NOTARIZATION_PACKAGE_ID not set in environment');
        }

        const iotaClient = IotaService.getClient();
        this.readOnlyClient = await NotarizationClientReadOnly.createWithPkgId(iotaClient as any, packageId);
        return this.readOnlyClient;
    }

    private getSigner(): Ed25519Keypair {
        const privateKeyB64 = process.env.PRIVATE_KEY;
        if (!privateKeyB64) {
            throw new Error('PRIVATE_KEY not set in environment (required for backend signing)');
        }
        return Ed25519Keypair.fromSecretKey(privateKeyB64);
    }

    /**
     * Executes the full notarization flow: hashing, off-chain storage, and on-chain record creation.
     */
    async createOnChainNotarization(fileBuffer: Buffer, fileName: string, metadata: any): Promise<NotarizationResult> {
        console.log(`[NotarizationService] Starting flow for: ${fileName}`);

        // 1. Calculate file hash
        const fileHashHex = HashUtil.sha256(fileBuffer);
        const fileHashUint8 = new Uint8Array(Buffer.from(fileHashHex, 'hex'));

        // 2. Store off-chain
        const offchainUrl = await StorageService.storeFile(fileBuffer, fileName);
        console.log(`[NotarizationService] Stored off-chain: ${offchainUrl}`);

        // 3. Prepare Metadata
        const metadataString = JSON.stringify({
            name: fileName,
            user: metadata.userDid,
            uploader: metadata.uploaderDid,
            activity: metadata.activityDid,
            expires: metadata.expirationDate,
            offchainUrl: offchainUrl,
            localName: metadata.localName
        });


        // 4. Initialize Notarization Client with Signer
        const readOnly = await this.getReadOnlyClient();
        const keypair = this.getSigner();

        // Implement the TransactionSigner interface expected by the WASM layer
        const signerWrapper = {
            sign: async (txData: Uint8Array) => {
                const { signature } = await keypair.signTransaction(txData);
                return signature;
            },
            publicKey: async () => keypair.getPublicKey(),
            iotaPublicKeyBytes: async () => keypair.getPublicKey().toIotaBytes(),
            keyId: () => keypair.toIotaAddress(),
        };


        const client = await NotarizationClient.create(readOnly, signerWrapper as any);

        // 5. Build Transaction
        const expirationTs = Math.floor(new Date(metadata.expirationDate).getTime() / 1000);
        const txBuilder = client
            .createLocked()
            .withBytesState(fileHashUint8, metadataString)
            .withDeleteLock(TimeLock.withUnlockAt(expirationTs))
            .finish()
            .withSender(keypair.toIotaAddress());


        const [txBytes] = await txBuilder.build(client);
        const tx = Transaction.from(txBytes);

        // 6. Sign and Execute
        const result = await IotaService.getClient().signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: {
                showEffects: true,
                showObjectChanges: true
            }
        });

        if (result.effects?.status.status !== 'success') {
            throw new Error(`On-chain transaction failed: ${result.effects?.status.error}`);
        }

        // 7. Extract created Object ID (the notarization record)
        const objectId = (result.objectChanges as any[] | undefined)?.find((c: any) => c.type === 'created')?.objectId;
        if (!objectId) {
            throw new Error('Failed to extract created objectId from transaction effects');
        }

        console.log(`[NotarizationService] Success! Digest: ${result.digest}, ObjectID: ${objectId}`);

        // 8. Auto-Index in our records database
        IdentityService.saveRecord(objectId, {
            name: metadata.fileName,
            fileName,
            expirationDate: metadata.expirationDate,
            activityDid: metadata.activityDid,
            uploaderDid: metadata.uploaderDid,
            offchainUrl,
            localName: metadata.localName
        });

        return {
            digest: result.digest,
            objectId,
            offchainUrl
        };
    }

    async getNotarization(objectId: string) {
        const client = await this.getReadOnlyClient();
        return await client.getNotarizationById(objectId);
    }

    async getNotarizationState(objectId: string) {
        const client = await this.getReadOnlyClient();
        return await client.state(objectId);
    }
}

