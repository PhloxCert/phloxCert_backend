import axios from 'axios';
import FormData from 'form-data';

export class StorageService {
    
    static async storeFile(fileBuffer: Buffer, fileName: string): Promise<string> {
        const pinataJwt = process.env.PINATA_JWT;
        const pinataApiKey = process.env.PINATA_API_KEY;
        const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;

        if (!pinataJwt && !(pinataApiKey && pinataSecretApiKey)) {
            throw new Error('Pinata credentials are not configured in environment variables.');
        }

        const formData = new FormData();
        formData.append('file', fileBuffer, { filename: fileName });

        const pinataMetadata = JSON.stringify({
            name: fileName
        });
        formData.append('pinataMetadata', pinataMetadata);

        const pinataOptions = JSON.stringify({
            cidVersion: 1
        });
        formData.append('pinataOptions', pinataOptions);

        const headers: any = {
            ...formData.getHeaders()
        };

        if (pinataJwt) {
            headers['Authorization'] = `Bearer ${pinataJwt}`;
        } else {
            headers['pinata_api_key'] = pinataApiKey;
            headers['pinata_secret_api_key'] = pinataSecretApiKey;
        }

        try {
            const res = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
                headers,
                maxBodyLength: Infinity
            });
            const cid = res.data.IpfsHash;
            const gatewayUrl = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
            
            // Format URL to prevent double slashes
            const cleanGateway = gatewayUrl.endsWith('/') ? gatewayUrl.slice(0, -1) : gatewayUrl;
            return `${cleanGateway}/ipfs/${cid}`;
        } catch (error: any) {
            console.error('[StorageService] Error pushing to Pinata:', error?.response?.data || error.message);
            throw new Error('Failed to upload file to IPFS via Pinata.');
        }
    }

}