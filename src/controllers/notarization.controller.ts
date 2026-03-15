import { NotarizationService } from '../services/notarization.service.js';
import { IdentityService } from '../services/identity.service.js';
import { HashUtil } from '../utils/hash.util.js';
import { IotaService } from '../services/iota.service.js';
import type { Request, Response } from 'express';

export class NotarizationController {
    private notarizationService: NotarizationService;

    constructor() {
        this.notarizationService = new NotarizationService();
    }

    /**
     * Handles the full notarization flow on the backend.
     */
    async notarizeUpload(req: Request, res: Response) {
        try {
            const file = (req as any).file;
            const { fileName, expirationDate, activityDid, userDid, uploaderDid, localName } = req.body;
 
             if (!file || !fileName || !expirationDate || !activityDid || !userDid) {
                 return res.status(400).json({ error: 'Missing required fields' });
             }
 
             // Centralized service call handles hashing, storage, on-chain execution, and automatic indexing.
             // We use file.originalname for storage to preserve the extension as requested by user.
             const result = await this.notarizationService.createOnChainNotarization(
                 file.buffer,
                 file.originalname,
                 { fileName, expirationDate, activityDid, userDid, uploaderDid: uploaderDid || userDid, localName }
             );

            res.status(200).json(result);
        } catch (error: any) {
            console.error('[NotarizationController] Error during notarization:', error);
            res.status(500).json({ error: error.message || 'Internal Server Error' });
        }
    }

    /**
     * Legacy endpoint - now indexing is automatic in notarizeUpload.
     * Kept for compatibility if needed, but redirects to IdentityService.
     */
    async saveRecord(req: Request, res: Response) {
        try {
            const { objectId, metadata } = req.body;
            if (!objectId || !metadata) return res.status(400).json({ error: 'Missing fields' });

            IdentityService.saveRecord(objectId, metadata);
            res.status(201).json({ message: 'Record indexed successfully' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async verifyDocument(req: Request, res: Response) {
        try {
            const file = (req as any).file;
            const { objectId } = req.body;

            console.log(`[NotarizationController] Verifying document for objectId: ${objectId}`);

            if (!file || !objectId) {
                return res.status(400).json({ error: 'Missing file or objectId' });
            }

            const inputHash = HashUtil.sha256(file.buffer);
            console.log(`[NotarizationController] Input hash: ${inputHash}`);

            // Direct IOTA SDK call to avoid unstable WASM bindings for read operations
            const iotaClient = IotaService.getClient();
            const response = await iotaClient.getObject({
                id: objectId,
                options: {
                    showContent: true,
                    showOwner: true
                }
            });

            if (response.error) {
                console.error(`[NotarizationController] Iota error for ${objectId}:`, response.error);
                return res.status(404).json({ error: 'Notarization object not found on-chain' });
            }

            const content = response.data?.content;
            if (!content || content.dataType !== 'moveObject') {
                return res.status(400).json({ error: 'Object is not a valid Move object' });
            }

            const fields = (content as any).fields;
            console.log(`[NotarizationController] Fetched fields:`, JSON.stringify(fields, null, 2));

            // Extract the hash from state.data
            // Structure: fields.state.fields.data (vector<u8> becomes decimal array in JSON)
            const stateFields = fields.state?.fields;
            if (!stateFields || !stateFields.data) {
                return res.status(500).json({ error: 'Could not extract state data from on-chain object' });
            }

            const storedBytes = stateFields.data;
            const storedHash = Buffer.from(storedBytes).toString('hex');
            console.log(`[NotarizationController] Stored hash: ${storedHash}`);

            const verified = inputHash === storedHash;

            // Extract metadata from immutable_metadata.description
            let metadata = null;
            const immMeta = fields.immutable_metadata?.fields;
            if (immMeta && immMeta.description) {
                try {
                    metadata = JSON.parse(immMeta.description);
                } catch (e) {
                    metadata = { description: immMeta.description };
                }
            }

            res.json({
                verified,
                metadata
            });
        } catch (error: any) {
            console.error('[NotarizationController] Verify error:', error);
            res.status(500).json({ error: error.message || 'Internal Server Error' });
        }
    }



    async getRecordsByDid(req: Request, res: Response) {
        try {
            const did = req.params.did as string;
            const records = IdentityService.getRecords(did);
            res.json(records);
        } catch (error: any) {
            console.error('[NotarizationController] GetRecords error:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

