import express from 'express';
import multer from 'multer';
import { NotarizationController } from '../controllers/notarization.controller.js';
import { IdentityService } from '../services/identity.service.js';
import { NotarizationService } from '../services/notarization.service.js';
import { IotaService } from '../services/iota.service.js';
import { verifyPersonalMessageSignature } from '@iota/iota-sdk/verify';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const controller = new NotarizationController();
const notarizationService = new NotarizationService();

// --- Standard Routes ---
router.post('/v1/notarize/upload', upload.single('file'), controller.notarizeUpload.bind(controller));
router.post('/v1/verify', upload.single('file'), controller.verifyDocument.bind(controller));
router.get('/v1/records/:did', controller.getRecordsByDid.bind(controller));
router.post('/v1/identity/save-id', controller.finalizeNotarization.bind(controller));



export default router;