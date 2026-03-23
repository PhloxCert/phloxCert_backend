import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

export class StorageService {
    private static storageDir = path.join(process.cwd(), 'uploads');


    static async storeFile(fileBuffer: Buffer, fileName: string): Promise<string> {
        // Ensure directory exists
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }

        // Use the provided fileName which should already include the extension
        const filePath = path.join(this.storageDir, fileName);
        fs.writeFileSync(filePath, fileBuffer);

        // Return a local URL
        // Using encodeURIComponent to handle spaces and special characters in filenames
        return `${BASE_URL}/uploads/${encodeURIComponent(fileName)}`;
    }

}