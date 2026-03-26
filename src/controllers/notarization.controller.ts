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

    async notarizeUpload(req: Request, res: Response) {
        try {
            const file = (req as any).file;
            const { fileName, expirationDate, activityDid, issuedBy, technicianAddress, publicKey } = req.body;

            if (!file || !technicianAddress) {
                return res.status(400).json({ error: 'File and technicianAddress are required' });
            }

            const result = await this.notarizationService.prepareNotarizationTransaction(
                file.buffer,
                fileName,
                {
                    fileName,
                    expirationDate,
                    activityDid,
                    issuedBy,
                    technicianAddress,
                    publicKey
                }
            );

            // Restituiamo i bytes al frontend
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async getRecordsByDid(req: Request, res: Response) {
        try {
            const did = req.params.did;
            
            const ids = await IdentityService.getObjectIdsByDid(did);

            if (!ids || ids.length === 0) return res.json([]);

            const records = await Promise.all(
                ids.map(id => this.notarizationService.getNotarization(id))
            );

            res.json(records.filter(r => r !== null));
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch records" });
        }
    }

    /**
     * Verifica l'integrità di un file rispetto a un objectId on-chain.
     */
    async verifyDocument(req: Request, res: Response) {
        try {
            const file = (req as any).file;
            const { objectId } = req.body;

            if (!file || !objectId) {
                return res.status(400).json({ error: 'Missing file or objectId' });
            }

            const inputHash = HashUtil.sha256(file.buffer);
            const iotaClient = IotaService.getClient();
            
            const response = await iotaClient.getObject({
                id: objectId,
                options: { showContent: true },
            });

            if (!response.data) {
                return res.status(404).json({ error: 'Object not found' });
            }

            const fields = (response.data.content as any).fields;
            // Estrazione hash dal campo 'value' o 'state' (dipende dal tuo Move contract)
            const storedData = fields.value || fields.state?.fields?.data;
            
            if (!storedData) {
                return res.status(500).json({ error: 'Hash data not found on object' });
            }

            const storedHash = Buffer.from(storedData).toString('hex');
            const verified = inputHash === storedHash;

            res.json({ verified });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
    async finalizeNotarization(req: Request, res: Response) {
    try {
        const { objectId, activityDid } = req.body;

        if (!objectId || !activityDid) {
            return res.status(400).json({ error: 'Missing objectId or activityDid' });
        }


        await IdentityService.saveRecord(objectId, activityDid);

        console.log(`[Controller] Record ${objectId} successfully linked to ${activityDid}`);
        
        res.status(200).json({ success: true, message: 'Record indexed on Pinata' });
    } catch (error: any) {
        console.error('[Controller] Finalize error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
}