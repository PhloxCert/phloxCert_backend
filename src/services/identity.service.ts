import { Resolver, CoreDocument } from '@iota/identity-wasm/node';
import { IotaClient } from '@iota/iota-sdk/client';
import { BcsReader } from '@iota/bcs';
import { StorageService } from './storage.service.js';
import { IotaService } from './iota.service.js';
import { Transaction } from '@iota/iota-sdk/transactions';
import type { NotarizationService } from './notarization.service.js';

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
    
    private static PACKAGE_ID = process.env.PACKAGE_ID;
    private static REGISTRY_ID = process.env.REGISTRY_ID;

    constructor(private client: IotaClient) {}

    private static readMoveString(reader: BcsReader): string {
        const length = reader.readULEB();
        const bytes = reader.readBytes(length);
        return new TextDecoder().decode(bytes);
    }

    /**
     * Retrieves user data directly from the blockchain (LocalRegistry).
     */
    static async getContractUser(userAddress: string) {
        try {
            if (!this.PACKAGE_ID || !this.REGISTRY_ID) {
                throw new Error("Missing PACKAGE_ID or REGISTRY_ID in environment");
            }

            const client = IotaService.getClient();
            const txb = new Transaction();
            txb.moveCall({
                target: `${this.PACKAGE_ID}::LocalRegistry::get_user_data`,
                arguments: [
                    txb.object(this.REGISTRY_ID!),
                    txb.pure.address(userAddress),
                ],
            });

            const result = await client.devInspectTransactionBlock({
                sender: userAddress,
                transactionBlock: txb,
            });

            if (result.results?.[0]?.returnValues?.[0]) {
                const bytes = Uint8Array.from(result.results[0].returnValues[0][0]);
                const reader = new BcsReader(bytes);

                const role = reader.read8();
                const name = this.readMoveString(reader);

                let business_info = null;
                let technician_info = null;

                // Index 1: Business data (Option<BusinessData>)
                const hasBusiness = reader.read8() === 1;
                if (hasBusiness) {
                    business_info = {
                        address: this.readMoveString(reader),
                        vat_number: this.readMoveString(reader),
                    };
                }

                // Index 2: Technician data (Option<TechnicianData>)
                const hasTechnician = reader.read8() === 1;
                if (hasTechnician) {
                    technician_info = {
                        license_number: this.readMoveString(reader),
                        specialization: this.readMoveString(reader),
                    };
                }

                return {
                    registered: true,
                    role,
                    name,
                    business_info,
                    technician_info
                };
            }

            return { registered: false, role: 0 };
        } catch (e) {
            console.error("[IdentityService] Blockchain lookup error:", e);
            return { registered: false, role: 0 };
        }
    }

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
        return results.filter((r: any) => r !== null);
    }

    static async certifyRecord(
        objectId: string,
        technicianDid: string,
        vcObjectId: string
    ): Promise<void> {
        const db = await this.getRemoteDb() as any;
        if (!db._vcMap) db._vcMap = {};
        db._vcMap[objectId] = vcObjectId;  // ← only the string, nothing else
        await StorageService.storeRegistry(db);
        console.log(`[IdentityService] Linked ${vcObjectId} → ${objectId} on Pinata registry.`);
    }

}