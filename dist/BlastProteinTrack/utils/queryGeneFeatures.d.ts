import type { FromConfigFeature } from './blastTrackConfig';
import type { Feature } from '@jbrowse/core/util';
export type QueryGeneBlastStatus = 'no_hits' | 'no_report' | 'no_sequence';
export declare function queryGeneFeature({ feature, hitCount, idPrefix, reportMatchedBy, reportQueryId, reportQueryTitle, status, statusDetail, }: {
    feature: Feature;
    hitCount: number;
    idPrefix: string;
    reportMatchedBy?: string;
    reportQueryId?: string;
    reportQueryTitle?: string;
    status: QueryGeneBlastStatus;
    statusDetail?: string;
}): FromConfigFeature;
