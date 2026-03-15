import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import * as dotenv from 'dotenv';
import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';
import { verifyPersonalMessageSignature } from '@iota/iota-sdk/verify';
import { Transaction } from '@iota/iota-sdk/transactions';
import apiRoutes from './routes/api.routes.js';

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
    if (!address) return res.status(400).json({ error: "Address missing" });

    // Generate a random string that the user must sign
    const nonce = `LOGIN_CHALLENGE_${Math.random().toString(36).substring(7)}`;

    // Save the nonce temporarily associated with the user's address
    nonceStorage.set(address, nonce);

    console.log(`Nonce generated for ${address}: ${nonce}`);
    res.json({ nonce });
});

async function getContractUser(userAddress: string) {
    try {
        const txb = new Transaction();

        // 1. Objects (like the Registry) must be passed as 'object'
        // 2. Simple values or vectors must be passed as 'pure'
        txb.moveCall({
            target: `${PACKAGE_ID}::LocalRegistry::get_user`,
            arguments: [
                txb.object(REGISTRY_ID), // Correct: objects use .object()
                txb.pure.string(userAddress), // Correct: shortcut for the address
            ],
        });

        const result = await client.devInspectTransactionBlock({
            sender: userAddress,
            transactionBlock: txb,
        });

        if (result.results?.[0]?.returnValues?.[0]) {
            const bytes = Uint8Array.from(result.results[0].returnValues[0][0]);

            // The first byte indicates if the Option is Some (1) or None (0)
            const isRegistered = bytes[0] === 1;

            if (isRegistered) {
                // If registered, the next byte is the 'role' (u8)
                const role = bytes[1];
                // The subsequent bytes are the 'name' (vector<u8> with length prefix)
                console.log(`User found! Role: ${role}`);
                return { registered: true, role: role };
            }
        }

        console.log("User not found.");
        return { registered: false };
    } catch (e) {
        console.error("Error reading contract:", e);
        return { registered: false, role: null };
    }
}

// --- ENDPOINT 2: Verifica la firma ---
app.post('/auth/verify', async (req: Request, res: Response) => {
    const { address, signature } = req.body;
    const savedNonce = nonceStorage.get(address);

    if (!savedNonce) return res.status(400).json({ error: "Nonce expired" });

    try {
        const messageBytes = new TextEncoder().encode(savedNonce);
        const publicKey = await verifyPersonalMessageSignature(messageBytes, signature);
        const recoveredAddress = publicKey.toIotaAddress();

        if (recoveredAddress === address) {
            nonceStorage.delete(address);

            // --- NEW LOGIC: Blockchain Check ---
            const contractData = await getContractUser(address);

            console.log(`User ${address} - Registered: ${contractData.registered}`);

            return res.json({
                success: true,
                registered: contractData.registered,
                role: contractData.role,
                address: address,
                message: contractData.registered ? "Welcome back!" : "User not registered in the system",
                // If not registered, the frontend will know to show the registration form
            });
        } else {
            return res.status(401).json({ error: "Signature does not match" });
        }
    } catch (error) {
        return res.status(401).json({ error: "Invalid signature" });
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