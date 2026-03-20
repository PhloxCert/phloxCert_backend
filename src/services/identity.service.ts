import { Resolver, CoreDocument } from '@iota/identity-wasm/node';
import { IotaClient } from '@iota/iota-sdk/client';
import fs from 'fs';
import path from 'path';

export interface NotarizationRecord {
    objectId: string;
    status: 'pending' | 'certified' | 'rejected'; 
    vcJwt?: string;                                
    certifiedBy?: string;                          
    certifiedAt?: string;  
    metadata: {
        name: string;
        fileName: string;
        expirationDate: string;
        activityDid: string;
        uploaderDid: string;
        offchainUrl: string;
        localName?: string;
    };
    createdAt: string;
}

export class IdentityService {
    private resolver: Resolver<CoreDocument> | null = null;
    private static dbPath = path.join(process.cwd(), 'uploads', 'records.json');

    private static ensureDb() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.dbPath)) {
            fs.writeFileSync(this.dbPath, JSON.stringify({}));
        }
    }

    private static readDb(): Record<string, NotarizationRecord[]> {
        this.ensureDb();
        try {
            const data = fs.readFileSync(this.dbPath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('[IdentityService] DB read error:', e);
            return {};
        }
    }

    private static writeDb(data: Record<string, NotarizationRecord[]>) {
        this.ensureDb();
        fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    }

    constructor(private client: IotaClient) { }

    getResolver(): Resolver<CoreDocument> {
        if (!this.resolver) {
            this.resolver = new Resolver({} as any);
        }
        return this.resolver;
    }

    async resolveDid(did: string) {
        const resolver = this.getResolver();
        return await resolver.resolve(did);
    }

    /**
     * Centralized indexing for notarization records.
     * Records are indexed for both uploader and activity DIDs.
     */
    static saveRecord(objectId: string, metadata: NotarizationRecord['metadata']) {
        const record: NotarizationRecord = {
            objectId,
            status: 'pending',
            metadata,
            createdAt: new Date().toISOString(),
        };

        const db = this.readDb();
        
        // Index under activity
        const activityDid = metadata.activityDid;
        const activityRecords = db[activityDid] ?? [];
        if (!activityRecords.find(r => r.objectId === objectId)) {
            db[activityDid] = [...activityRecords, record];
        }

        // Index under uploader (if different)
        const uploaderDid = metadata.uploaderDid;
        if (uploaderDid && uploaderDid !== activityDid) {
            const uploaderRecords = db[uploaderDid] ?? [];
            if (!uploaderRecords.find(r => r.objectId === objectId)) {
                db[uploaderDid] = [...uploaderRecords, record];
            }
        }

        this.writeDb(db);
        console.log(`[IdentityService] Indexed record ${objectId} for Activity: ${activityDid}, Uploader: ${uploaderDid}`);
    }

    static getRecords(did: string): NotarizationRecord[] {
        const db = this.readDb();
        return db[did] ?? [];
    }
    // Aggiorna status e VC di un record esistente
    static certifyRecord(objectId: string, technicianDid: string, vcJwt: string) {
        const db = this.readDb();
        
        // Aggiorna in tutti gli indici dove compare questo objectId
        for (const key of Object.keys(db)) {
            db[key] = db[key].map(r => {
                if (r.objectId === objectId) {
                    return {
                        ...r,
                        status: 'certified',
                        vcJwt,
                        certifiedBy: technicianDid,
                        certifiedAt: new Date().toISOString()
                    };
                }
                return r;
            });
        }
        
        this.writeDb(db);
        }

    // Recupera tutti i record pending (per la dashboard technician)
    static getPendingRecords(): NotarizationRecord[] {
        const db = this.readDb();
        const seen = new Set<string>();
        const pending: NotarizationRecord[] = [];
        
        for (const records of Object.values(db)) {
            for (const r of records) {
                if (r.status === 'pending' && !seen.has(r.objectId)) {
                    seen.add(r.objectId);
                    pending.push(r);
                }
            }
        }
        return pending;
    }

    // Recupera un singolo record per objectId
    static getRecordById(objectId: string): NotarizationRecord | null {
        const db = this.readDb();
        for (const records of Object.values(db)) {
            const found = records.find(r => r.objectId === objectId);
            if (found) return found;
        }
        return null;
    }
}
