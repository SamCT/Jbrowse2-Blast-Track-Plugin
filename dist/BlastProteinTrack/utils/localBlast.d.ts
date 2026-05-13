import type { BlastQueryReport } from './ncbiBlast';
import type { BlastHit } from './types';
export interface LocalBlastDatabase {
    id: string;
    name: string;
    title?: string;
    type: 'protein' | 'nucleotide';
}
export declare function localBlastDatabaseValue(database: LocalBlastDatabase): string;
export declare function localBlastDatabaseId(value: string): string | undefined;
export declare function isLocalBlastDatabaseValue(value: string): boolean;
export declare function selectedLocalBlastDatabase({ databases, value, }: {
    databases: LocalBlastDatabase[];
    value: string;
}): LocalBlastDatabase | undefined;
export declare function fetchLocalBlastDatabases({ program, onProgress, }: {
    program: 'blastp' | 'blastn';
    onProgress?: (message: string) => void;
}): Promise<LocalBlastDatabase[]>;
export declare function queryLocalBlast({ allHits, query, blastDatabase, blastProgram, hitLimit, hspLimit, onProgress, }: {
    allHits?: boolean;
    query: string;
    blastDatabase: string;
    blastProgram: 'blastp' | 'blastn';
    hitLimit: number;
    hspLimit: number;
    onProgress: (message: string) => void;
}): Promise<{
    rid: string;
    hits: BlastHit[];
}>;
export declare function queryLocalBlastReports({ allHits, query, blastDatabase, blastProgram, hitLimit, hspLimit, onProgress, }: {
    allHits?: boolean;
    query: string;
    blastDatabase: string;
    blastProgram: 'blastp' | 'blastn';
    hitLimit: number;
    hspLimit: number;
    onProgress: (message: string) => void;
}): Promise<{
    rid: string;
    reports: BlastQueryReport[];
}>;
