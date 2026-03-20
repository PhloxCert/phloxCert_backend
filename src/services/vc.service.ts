// src/services/vc.service.ts

export class VcService {

    /**
     * Issues a VC on behalf of the technician.
     * The technician has already authenticated via wallet signature,
     * so the backend issues the VC with the approval data.
     */
    static async issueCertificationVc(params: {
        technicianDid: string;
        objectId: string;       // objectId of the notarization record
        documentHash: string;
        documentName: string;
        uploaderDid: string;
    }): Promise<string> {
        
        // Build the VC payload following the W3C Verifiable Credentials standard
        const vcPayload = {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            type: ["VerifiableCredential", "DocumentCertification"],
            issuer: params.technicianDid,
            issuanceDate: new Date().toISOString(),
            credentialSubject: {
                id: `iota:object:${params.objectId}`,
                type: "CertifiedDocument",
                notarizationObjectId: params.objectId,
                documentName: params.documentName,
                uploaderDid: params.uploaderDid,
                certifiedBy: params.technicianDid,
                certificationStatus: "approved"
            }
        };

        // Serialized as base64 for now (no cryptographic signature yet)
        // TODO: have the technician sign the VC from the frontend with their wallet
        const vcJwt = Buffer.from(JSON.stringify(vcPayload)).toString('base64');
        console.log(`[VcService] VC issued for objectId: ${params.objectId} by ${params.technicianDid}`);
        return vcJwt;
    }

    // Decodes a base64-encoded VC back to its JSON payload
    static decodeVc(vcJwt: string) {
        try {
            return JSON.parse(Buffer.from(vcJwt, 'base64').toString('utf8'));
        } catch {
            return null;
        }
    }
}