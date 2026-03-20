import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import * as dotenv from 'dotenv';
import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';
import { verifyPersonalMessageSignature } from '@iota/iota-sdk/verify';
import { Transaction } from '@iota/iota-sdk/transactions';
import apiRoutes from './routes/api.routes.js';
import { BcsReader } from '@iota/bcs';

// Load configuration from .env (not committed to source control)
dotenv.config();

const PACKAGE_ID = process.env.PACKAGE_ID;
const REGISTRY_ID = process.env.REGISTRY_ID;
const IOTA_NODE_URL = process.env.IOTA_NODE_URL ?? getFullnodeUrl('localnet');
const PORT = Number(process.env.PORT ?? 8080);

if (!PACKAGE_ID || !REGISTRY_ID) {
    throw new Error('Missing PACKAGE_ID or REGISTRY_ID in environment. Please set them in .env (see .env.example).');
}

const app = express();

// Configure CORS to allow your frontend (e.g. localhost:5173) to call the server
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API Routes
app.use('/api', apiRoutes);

const client = new IotaClient({ url: IOTA_NODE_URL });
const nonceStorage = new Map<string, string>();

// --- ENDPOINT 1: Genera la sfida (Nonce) ---
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

function readMoveString(reader: BcsReader): string {
    // Move usa ULEB128 per la lunghezza, ma per stringhe corte read8() o readULEB() funzionano
    const length = reader.readULEB(); 
    const bytes = reader.readBytes(length);
    return new TextDecoder().decode(bytes);
}

async function getContractUser(userAddress: string) {
    try {
        const txb = new Transaction();
        txb.moveCall({
            target: `${PACKAGE_ID}::LocalRegistry::get_user_data`, 
            arguments: [
                txb.object(REGISTRY_ID),
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

            // 1. Leggi il RUOLO (u8)
            const role = reader.read8();

            // 2. Leggi il NOME (String)
            const name = readMoveString(reader);

            let business_info = null;
            let technician_info = null;

            // 3. Leggi business_info (Option<BusinessData>)
            // In Move BCS, Option è: [1 byte flag] + [dati se flag == 1]
            const hasBusiness = reader.read8() === 1;
            if (hasBusiness) {
                business_info = {
                    address: readMoveString(reader),
                    vat_number: readMoveString(reader),
                };
            }

            // 4. Leggi technician_info (Option<TechnicianData>)
            const hasTechnician = reader.read8() === 1;
            if (hasTechnician) {
                technician_info = {
                    license_number: readMoveString(reader),
                    specialization: readMoveString(reader),
                };
            }

            console.log(`Dati estratti per ${name}:`, { role, business_info, technician_info });

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
        console.error("Errore lettura blockchain:", e);
        return { registered: false, role: 0 };
    }
}


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

        const contractData = await getContractUser(address);

        return res.json({
            success: true,
            registered: contractData.registered,
            role: contractData.role,
            name: contractData.name || "Utente IOTA",
            address: address,
            // Passa gli oggetti info solo se esistono
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
    console.log(`TypeScript backend active on http://localhost:${PORT}`);
});