import * as dotenv from 'dotenv';
import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';

dotenv.config();

export class IotaService {
    private static instance: IotaClient;

    static getClient(): IotaClient {
        if (!this.instance) {
            const url = process.env.IOTA_NODE_URL ?? getFullnodeUrl('localnet');
            this.instance = new IotaClient({ url });
        }
        return this.instance;
    }

}