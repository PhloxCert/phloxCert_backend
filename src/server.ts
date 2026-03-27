import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import * as dotenv from 'dotenv';
import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';
import { verifyPersonalMessageSignature } from '@iota/iota-sdk/verify';
import { Transaction } from '@iota/iota-sdk/transactions';
import { IdentityService } from './services/identity.service.js';
import apiRoutes from './routes/api.routes.js';


// Load configuration from .env (not committed to source control)
dotenv.config();

const PACKAGE_ID = process.env.PACKAGE_ID;
const REGISTRY_ID = process.env.REGISTRY_ID;
const IOTA_NODE_URL = process.env.IOTA_NODE_URL ?? getFullnodeUrl('localnet');
const PORT = Number(process.env.PORT ?? 8080);

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

if (!PACKAGE_ID || !REGISTRY_ID) {
    throw new Error('Missing PACKAGE_ID or REGISTRY_ID in environment. Please set them in .env (see .env.example).');
}

const app = express();

app.use(cors({
  origin: [
    'https://phloxcert-frontend.pages.dev',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API Routes
app.use('/api', apiRoutes);

const client = new IotaClient({ url: IOTA_NODE_URL });
const nonceStorage = new Map<string, string>();

// --- ENDPOINT 1: Generate Authentication Challenge (Nonce) ---
app.post('/auth/nonce', (req: Request, res: Response) => {
    const { address } = req.body;
    console.log(`Nonce generated for`);
    if (!address) return res.status(400).json({ error: "Address missing" });

    // Generate a random string that the user must sign
    const nonce = `LOGIN_CHALLENGE_${Math.random().toString(36).substring(7)}`;

    // Save the nonce temporarily associated with the user's address
    nonceStorage.set(address, nonce);

    console.log(`Nonce generated for ${address}: ${nonce}`);
    res.json({ nonce });
});

app.get('/api/v1/business/profile/:did', async (req: Request, res: Response) => {
    try {
        const { did } = req.params;
        const didStr = Array.isArray(did) ? did[0] : did;
        const cleanAddress = didStr.includes(':') ? didStr.split(':').pop() : didStr;

        const contractData = await IdentityService.getContractUser(cleanAddress!);

        if (!contractData.registered) {
            return res.status(404).json({ error: "User not registered on-chain" });
        }

        // 3. Return the unified profile
        return res.json({
            success: true,
            venue: {
                name: contractData.name,
                role: contractData.role,

                ...(contractData.business_info && { 
                    address: contractData.business_info.address, 
                    vat: contractData.business_info.vat_number 
                }),
                ...(contractData.technician_info && { 
                    license: contractData.technician_info.license_number,
                    specialization: contractData.technician_info.specialization 
                })
            },
        });

    } catch (error) {
        console.error("Profile Fetch Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post('/auth/verify', async (req: Request, res: Response) => {
    const { address, signature } = req.body;
    const savedNonce = nonceStorage.get(address);

    if (!savedNonce) return res.status(400).json({ error: "Nonce expired or invalid" });

    try {
        const messageBytes = new TextEncoder().encode(savedNonce);
        
        const publicKey = await verifyPersonalMessageSignature(messageBytes, signature);
        const recoveredAddress = publicKey.toIotaAddress();

        if (recoveredAddress !== address) {
            return res.status(401).json({ error: "Signature mismatch" });
        }

        nonceStorage.delete(address);

        const contractData = await IdentityService.getContractUser(address);

        return res.json({
            success: true,
            registered: contractData.registered,
            role: contractData.role,
            name: contractData.name || "IOTA User",
            address: address,
            // Pass info objects only if they exist
            business_info: contractData.business_info || null, 
            technician_info: contractData.technician_info || null,
            message: "Login successful"
        });

    } catch (error) {
        console.error("Verify Error:", error);
        return res.status(401).json({ error: "Invalid signature format" });
    }
});


app.get('/api/objects/:address', async (req: Request, res: Response) => {
    const { address } = req.params;

    if (!address || address === 'undefined') {
        return res.status(400).json({ error: "Invalid or missing wallet address" });
    }

    try {
        const objects = await client.getOwnedObjects({
            owner: address as string,
            limit: 50,
            options: {
                showContent: true,
                showDisplay: true,
                showType: true
            }
        });

        console.log(`Objects found for ${address}:`, objects.data.length);
        res.json(objects.data);
    } catch (error: any) {
        console.error("IOTA SDK error:", error.message);
        res.status(500).json({
            error: "Error retrieving objects from the Ledger",
            details: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`TypeScript backend active on ${BASE_URL}:${PORT}`);
});