import express from 'express';
import multer from 'multer';
import { NotarizationController } from '../controllers/notarization.controller.js';
import { IdentityService } from '../services/identity.service.js';
import { VcService } from '../services/vc.service.js'; 
import { verifyPersonalMessageSignature } from '@iota/iota-sdk/verify';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const controller = new NotarizationController();

router.post('/v1/notarize/upload', upload.single('file'), controller.notarizeUpload.bind(controller));
router.post('/v1/verify', upload.single('file'), controller.verifyDocument.bind(controller));
router.get('/v1/records/:did', controller.getRecordsByDid.bind(controller));
router.post('/v1/records', express.json(), controller.saveRecord.bind(controller));

router.get('/documents/all', (req, res) => {
    const db = IdentityService['readDb']();
    const seen = new Set<string>();
    const all: any[] = [];
    for (const records of Object.values(db)) {
        for (const r of records as any[]) {
            if (!seen.has(r.objectId)) {
                seen.add(r.objectId);
                all.push(r);
            }
        }
    }
    res.json(all);
});

router.post('/documents/:objectId/certify', express.json(), async (req, res) => {
    const { objectId } = req.params;
    const { technicianDid, vcPayload, signature } = req.body;
 
    if (!technicianDid || !vcPayload || !signature) {
        return res.status(400).json({ error: 'Missing technicianDid, vcPayload or signature' });
    }
 
    const record = IdentityService.getRecordById(objectId);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    if (record.status === 'certified') return res.status(400).json({ error: 'Already certified' });
 
    try {
        // 1. Verify the wallet signature
        // The frontend signed JSON.stringify(vcPayload) with the technician's wallet
        const payloadBytes = new TextEncoder().encode(JSON.stringify(vcPayload));
        const publicKey = await verifyPersonalMessageSignature(payloadBytes, signature);
        const recoveredAddress = publicKey.toIotaAddress();
 
        // 2. Check that the recovered address matches the claimed technicianDid
        // technicianDid is "did:iota:0x..." so we extract the address part
        const claimedAddress = technicianDid.replace('did:iota:', '');
        if (recoveredAddress !== claimedAddress) {
            return res.status(401).json({ error: 'Signature does not match technicianDid' });
        }
 
        // 3. Build the final VC JWT (payload + signature bundled as base64)
        const vcJwt = Buffer.from(JSON.stringify({
            payload: vcPayload,
            signature,
            signerAddress: recoveredAddress,
        })).toString('base64');
 
        // 4. Save to DB
        IdentityService.certifyRecord(objectId, technicianDid, vcJwt);
 
        return res.json({
            success: true,
            objectId,
            vcJwt,
            message: 'Document certified and VC issued successfully'
        });
 
    } catch (error: any) {
        console.error('[certify] Error:', error);
        return res.status(401).json({ error: 'Invalid signature: ' + error.message });
    }
});

router.get('/documents/:objectId/vc', (req, res) => {
    const record = IdentityService.getRecordById(req.params.objectId);
    if (!record?.vcJwt) return res.status(404).json({ error: 'No VC found' });
    
    res.json({
        status: record.status,
        certifiedBy: record.certifiedBy,
        certifiedAt: record.certifiedAt,
        vc: VcService.decodeVc(record.vcJwt)
    });
});

export default router;
