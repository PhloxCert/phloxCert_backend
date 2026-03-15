import { Resolver, CoreDocument } from '@iota/identity-wasm/node';
import { IotaClient } from '@iota/iota-sdk/client';
import fs from 'fs';
import path from 'path';

export interface NotarizationRecord {
    objectId: string;
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
}
