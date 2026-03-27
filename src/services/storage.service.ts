import axios from 'axios';
import FormData from 'form-data';

export class StorageService {
    private static getHeaders() {
        const pinataJwt = process.env.PINATA_JWT;
        const headers: any = {};
        if (pinataJwt) {
            headers['Authorization'] = `Bearer ${pinataJwt}`;
        } else {
            headers['pinata_api_key'] = process.env.PINATA_API_KEY;
            headers['pinata_secret_api_key'] = process.env.PINATA_SECRET_API_KEY;
        }
        return headers;
    }

    /**
     * Fixes and cleans the Gateway URL from ENV
     */
    private static getCleanGateway(): string {
        let gw = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
        
        // Add protocol if missing
        if (!gw.startsWith('http')) {
            gw = `https://${gw}`;
        }
        
        // Remove trailing slashes
        return gw.replace(/\/+$/, '');
    }

    static async storeFile(fileBuffer: Buffer, fileName: string): Promise<string> {
        const formData = new FormData();
        formData.append('file', fileBuffer, { filename: fileName });
        formData.append('pinataMetadata', JSON.stringify({ name: fileName }));

        try {
            const res = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
                headers: { ...formData.getHeaders(), ...this.getHeaders() },
                maxBodyLength: Infinity
            });

            const baseGw = this.getCleanGateway();
            return `${baseGw}/ipfs/${res.data.IpfsHash}`;
        } catch (error: any) {
            console.error('[StorageService] Error pushing file:', error?.response?.data || error.message);
            throw new Error('Failed to upload file to IPFS.');
        }
    }

    static async getLatestRegistry(): Promise<Record<string, string[]>> {
        try {
            const listUrl = 'https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=record.json&pageLimit=1&sort=desc';
            const res = await axios.get(listUrl, { headers: this.getHeaders() });

            if (!res.data.rows || res.data.rows.length === 0) {
                console.log('[StorageService] No registry found.');
                return {};
            }

            const latestCid = res.data.rows[0].ipfs_pin_hash;
            const baseGw = this.getCleanGateway();

            // Try different access patterns
            const fetchUrls = [
                `${baseGw}/ipfs/${latestCid}`,
                `https://cloudflare-ipfs.com/ipfs/${latestCid}`,
                `https://ipfs.io/ipfs/${latestCid}`
            ];

            for (const url of fetchUrls) {
                try {
                    console.log(`[StorageService] Fetching registry from: ${url}`);
                    const response = await axios.get(url, { timeout: 8000 });
                    const data = response.data?.pinataContent || response.data;
                    
                    if (data && typeof data === 'object') {
                        console.log(`[StorageService] Success from ${url}`);
                        return data;
                    }
                } catch (e: any) {
                    console.warn(`[StorageService] Failed ${url}: ${e.message}`);
                }
            }

            return {};
        } catch (error: any) {
            console.error('[StorageService] Critical Fetch Error:', error.message);
            return {};
        }
    }

    static async storeRegistry(registryData: Record<string, any>): Promise<string> {
        try {
            const res = await axios.post('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
                pinataContent: registryData,
                pinataMetadata: { 
                    name: 'record.json',
                    keyvalues: { lastUpdate: Date.now().toString() }
                }
            }, {
                headers: this.getHeaders()
            });
            
            console.log(`[StorageService] Registry updated: ${res.data.IpfsHash}`);
            return res.data.IpfsHash;
        } catch (error: any) {
            console.error('[StorageService] Save error:', error?.response?.data || error.message);
            throw new Error('Failed to update registry.');
        }
    }
}