export interface BlastHitDescription {
    accession?: string;
    id?: string;
    sciname?: string;
    taxid?: number;
    title?: string;
}
export interface BlastHsp {
    align_len?: number;
    bit_score?: number;
    evalue?: number;
    gaps?: number;
    hseq?: string;
    identity?: number;
    midline?: string;
    num?: number;
    positive?: number;
    qseq?: string;
    query_from?: number;
    query_to?: number;
    score?: number;
    hit_from?: number;
    hit_to?: number;
}
export interface BlastHit {
    description: BlastHitDescription[];
    hsps: BlastHsp[];
    len?: number;
    num?: number;
}
export interface BlastResults {
    BlastOutput2: {
        report: {
            results: {
                search: {
                    hits: BlastHit[];
                    query_id?: string;
                    query_len?: number;
                    query_title?: string;
                };
            };
        };
    }[];
}
