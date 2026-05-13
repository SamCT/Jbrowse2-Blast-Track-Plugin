import type { BlastQueryReport } from './ncbiBlast';
import type { BlastHit } from './types';
declare const precomputedTableKind = "precomputedBlastpTable";
export interface LocalBlastDatabase {
    id: string;
    indexUrl?: string;
    kind: typeof precomputedTableKind;
    name: string;
    title?: string;
    type: 'protein';
    url: string;
}
export declare function setPluginPrecomputedBlastTables(pluginManager: {
    runtimePluginDefinitions?: unknown[];
}): void;
export declare function localBlastDatabaseValue(database: LocalBlastDatabase): string;
export declare function localBlastDatabaseId(value: string): string | undefined;
export declare function isLocalBlastDatabaseValue(value: string): boolean;
export declare function selectedLocalBlastDatabase({ databases, value, }: {
    databases: LocalBlastDatabase[];
    value: string;
}): LocalBlastDatabase | undefined;
export declare function isPrecomputedBlastDatabase(database?: LocalBlastDatabase): boolean;
export declare function fetchLocalBlastDatabases({ program, onProgress, }: {
    program: 'blastp' | 'blastn';
    onProgress?: (message: string) => void;
}): Promise<LocalBlastDatabase[]>;
export declare function queryLocalBlast({ allHits, query, queryIds, blastDatabase, hitLimit, onProgress, }: {
    allHits?: boolean;
    blastDatabase: LocalBlastDatabase;
    blastProgram: 'blastp' | 'blastn';
    hspLimit: number;
    hitLimit: number;
    onProgress: (message: string) => void;
    query: string;
    queryIds?: string[];
}): Promise<{
    rid: string;
    hits: BlastHit[];
}>;
export declare function queryLocalBlastReports({ allHits, query, queryIds, blastDatabase, hitLimit, onProgress, }: {
    allHits?: boolean;
    blastDatabase: LocalBlastDatabase;
    blastProgram?: 'blastp' | 'blastn';
    hspLimit?: number;
    hitLimit: number;
    onProgress: (message: string) => void;
    query: string;
    queryIds?: string[];
}): Promise<{
    rid: string;
    reports: BlastQueryReport[];
}>;
export {};
