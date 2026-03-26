import { Resolver, CoreDocument } from '@iota/identity-wasm/node';
import { IotaClient } from '@iota/iota-sdk/client';
import { StorageService } from './storage.service.js';
import { NotarizationService } from './notarization.service.js';

export interface NotarizationRecord {
    objectId: string;
    createdAt: string;
    metadata: {
        name: string;
        offchainUrl: string;
        expirationDate: string;
        activityDid: string;
        issuedBy: string;
        uploaderDid: string;
    };
}


export class IdentityService {
    private resolver: Resolver<CoreDocument> | null = null;

    constructor(private client: IotaClient) {}

    /**
     * Lazy-initializes the DID Resolver.
     */
    getResolver(): Resolver<CoreDocument> {
        if (!this.resolver) {
            this.resolver = new Resolver({} as any);
        }
        return this.resolver;
    }

    // ─── Record management (Lightweight IPFS Registry) ────────────────────────

    /**
     * Fetches the light database from Pinata (Map of DID to Object IDs).
     */
    private static async getRemoteDb(): Promise<Record<string, string[]>> {
        const db = await StorageService.getLatestRegistry();
        return (db as unknown) as Record<string, string[]>;
    }

    /**
     * Saves ONLY the objectId associated with the DIDs.
     * This keeps the Pinata JSON small and privacy-focused.
     */
    static async saveRecord(
        objectId: string, 
        activityDid: string
    ): Promise<void> {
        const db = await this.getRemoteDb() as Record<string, string[]>;

        if (activityDid) {
            if (!db[activityDid]) db[activityDid] = [];
            
            if (!db[activityDid].includes(objectId)) {
                db[activityDid].push(objectId);
                
                await StorageService.storeRegistry(db);
                console.log(`[Registry] Linked ${objectId} to Business ${activityDid}. Technician excluded from index.`);
            }
        }
    }
    

    static async getObjectIdsByDid(did: string): Promise<string[]> {
        const db = await this.getRemoteDb();

        if (did === 'all') {
            const allIds = Object.values(db).flat();
            
            return [...new Set(allIds)];
        }

        return db[did] ?? [];
    }

    /**
     * Retrieves the IDs from Pinata, then FETCHES full data from IOTA blockchain.
     * This is the bridge between your "Light Index" and the "Source of Truth".
     */
    static async getRecords(did: string, notarizationService: NotarizationService): Promise<NotarizationRecord[]> {
        const ids = await this.getObjectIdsByDid(did);

        // Fetch the actual data for each ID from the blockchain in parallel
        const results = await Promise.all(
            ids.map(async (id) => {
                try {
                    return await notarizationService.getNotarization(id);
                } catch (e) {
                    console.error(`[IdentityService] Failed to fetch ${id} from chain:`, e);
                    return null;
                }
            })
        );

        // Filter out any objects that might have been deleted or failed to fetch
        return results.filter(r => r !== null);
    }

    static async certifyRecord(
        objectId: string,
        technicianDid: string,
        vcObjectId: string
    ): Promise<void> {
        const db = await this.getRemoteDb() as any;
        if (!db._vcMap) db._vcMap = {};
        db._vcMap[objectId] = vcObjectId;  // ← solo la stringa, nient'altro
        await StorageService.storeRegistry(db);
        console.log(`[IdentityService] Linked ${vcObjectId} → ${objectId} on Pinata registry.`);
    }

}