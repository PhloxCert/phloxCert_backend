import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';
import { verifyPersonalMessageSignature } from '@iota/iota-sdk/verify';
import { Transaction } from '@iota/iota-sdk/transactions';

const PACKAGE_ID = "0x9bf6b9515e995cb7cf2ee08a7a1e956454a9ab723d5b766e75a0575654df1579";
const REGISTRY_ID="0x6bace8e70cf7a7e19b60c35d51bc7a2b01a92d0c748d8cc9c9358072bc3cb56f";

const app = express();

// Configura CORS per permettere al tuo frontend (es. localhost:5173) di chiamare il server
app.use(cors());
app.use(express.json());

const client = new IotaClient({ url: getFullnodeUrl('localnet') });
const nonceStorage = new Map<string, string>();

// --- ENDPOINT 1: Genera la sfida (Nonce) ---
app.post('/auth/nonce', (req: Request, res: Response) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: "Indirizzo mancante" });

    // Generiamo una stringa casuale che il locale dovrà firmare
    const nonce = `LOGIN_CHALLENGE_${Math.random().toString(36).substring(7)}`;
    
    // Salviamo il nonce temporaneamente associato all'indirizzo del locale
    nonceStorage.set(address, nonce);
    
    console.log(`Nonce generato per ${address}: ${nonce}`);
    res.json({ nonce });
});

async function getContractUser(userAddress: string) {
    try {
        const txb = new Transaction();

        // 1. Gli oggetti (come il Registry) vanno passati come 'object'
        // 2. I valori semplici o vettori vanno passati come 'pure'
        txb.moveCall({
            target: `${PACKAGE_ID}::LocalRegistry::get_user`,
            arguments: [
                txb.object(REGISTRY_ID), // Corretto: gli oggetti usano .object()
                txb.pure.string(userAddress), // Corretto: scorciatoia per l'indirizzo
            ],
        });

        const result = await client.devInspectTransactionBlock({
            sender: userAddress,
            transactionBlock: txb,
        });

        if (result.results?.[0]?.returnValues?.[0]) {
        const bytes = Uint8Array.from(result.results[0].returnValues[0][0]);
        
        // Il primo byte indica se l'Option è Some (1) o None (0)
        const isRegistered = bytes[0] === 1;

        if (isRegistered) {
            // Se registrato, il byte successivo è il 'role' (u8)
            const role = bytes[1];
            // I byte successivi sono il 'name' (vector<u8> con prefisso lunghezza)
            console.log(`Utente trovato! Ruolo: ${role}`);
            return { registered: true, role: role };
        }
    }
    
    console.log("Utente non trovato.");
    return { registered: false };
    } catch (e) {
        console.error("Errore lettura contratto:", e);
        return { registered: false, role: null };
    }
}

// --- ENDPOINT 2: Verifica la firma ---
app.post('/auth/verify', async (req: Request, res: Response) => {
    const { address, signature } = req.body;
    const savedNonce = nonceStorage.get(address);

    if (!savedNonce) return res.status(400).json({ error: "Nonce scaduto" });

    try {
        const messageBytes = new TextEncoder().encode(savedNonce);
        const publicKey = await verifyPersonalMessageSignature(messageBytes, signature);
        const recoveredAddress = publicKey.toIotaAddress();

        if (recoveredAddress === address) {
            nonceStorage.delete(address);

            // --- NUOVA LOGICA: Controllo Blockchain ---
            const contractData = await getContractUser(address);
            
            console.log(`Utente ${address} - Registrato: ${contractData.registered}`);

            return res.json({ 
                success: true, 
                registered: contractData.registered,
                role: contractData.role,
                address: address,
                message: contractData.registered ? "Bentornato!" : "Utente non registrato nel sistema",
                // Se non è registrato, il frontend saprà di dover mostrare il form di registrazione
            });
        } else {
            return res.status(401).json({ error: "Firma non corrispondente" });
        }
    } catch (error) {
        return res.status(401).json({ error: "Firma non valida" });
    }
});


app.get('/api/objects/:address', async (req: Request, res: Response) => {
    const { address } = req.params;

    if (!address || address === 'undefined') {
        return res.status(400).json({ error: "Indirizzo wallet non valido o mancante" });
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

        console.log(`Oggetti trovati per ${address}:`, objects.data.length);
        res.json(objects.data);
    } catch (error: any) {
        console.error("Errore IOTA SDK:", error.message);
        res.status(500).json({ 
            error: "Errore durante il recupero degli oggetti dal Ledger",
            details: error.message 
        });
    }
});

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`Backend TypeScript attivo su http://localhost:${PORT}`);
});