import type { BlastHit } from './types';
export interface BlastQueryReport {
    hits: BlastHit[];
    queryId?: string;
    queryLength?: number;
    queryTitle?: string;
}
export declare function queryBlast({ query, blastDatabase, blastProgram, contactEmail, hitLimit, baseUrl, onProgress, }: {
    query: string;
    blastDatabase: string;
    blastProgram: string;
    contactEmail?: string;
    hitLimit: number;
    baseUrl: string;
    onProgress: (arg: string) => void;
}): Promise<{
    rid: string;
    hits: BlastHit[];
}>;
export declare function queryBlastReports({ query, blastDatabase, blastProgram, contactEmail, hitLimit, baseUrl, onProgress, }: {
    query: string;
    blastDatabase: string;
    blastProgram: string;
    contactEmail?: string;
    hitLimit: number;
    baseUrl: string;
    onProgress: (arg: string) => void;
}): Promise<{
    rid: string;
    reports: BlastQueryReport[];
}>;
