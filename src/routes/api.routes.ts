import express from 'express';
import multer from 'multer';
import { NotarizationController } from '../controllers/notarization.controller.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const controller = new NotarizationController();

router.post('/v1/notarize/upload', upload.single('file'), controller.notarizeUpload.bind(controller));
router.post('/v1/verify', upload.single('file'), controller.verifyDocument.bind(controller));
router.get('/v1/records/:did', controller.getRecordsByDid.bind(controller));
router.post('/v1/records', express.json(), controller.saveRecord.bind(controller));

export default router;
