import { getFeatureName } from './featureSequence';
import { getBestCdsSet } from './proteinFromCds';
export function featuresFromBlastHits({ blastProgram = 'blastp', hspLimit, hits, idPrefix, queryFeature, queryProteinLength, hitLimit, showMismatchMarkers, source = 'NCBI BLASTP', }) {
    const refName = queryFeature.get('refName');
    const queryStart = queryFeature.get('start');
    const queryEnd = queryFeature.get('end');
    const queryStrand = queryFeature.get('strand') ?? 1;
    const queryLength = Math.max(1, queryEnd - queryStart);
    const codingSegments = getCodingSegments(queryFeature);
    return bestHits(hits, hitLimit, queryProteinLength).flatMap((hit, hitIndex) => {
        const descriptions = hit.description ?? [];
        const description = displayDescription(descriptions);
        const allHsps = hit.hsps.filter(hasQueryRange);
        const hsps = limitHsps(allHsps, hspLimit);
        if (!hsps.length) {
            return [];
        }
        const rankingStats = hitRankingStats(hit, queryProteinLength);
        const blastCandidateClass = candidateClass(rankingStats);
        const hspBlocks = hsps.flatMap((hsp, hspIndex) => hspToCdsBlocks({
            blastCandidateClass,
            description,
            hitIndex,
            hsp,
            hspIndex,
            idPrefix,
            refName,
            queryEnd,
            queryLength,
            queryProteinLength,
            queryStart,
            queryStrand,
            source,
            codingSegments,
            subjectToQueryLengthRatio: rankingStats.subjectToQueryLengthRatio,
        }));
        const mismatchMarkers = showMismatchMarkers
            ? hsps.flatMap((hsp, hspIndex) => hspMismatchMarkers({
                description,
                hitIndex,
                hsp,
                hspIndex,
                idPrefix,
                refName,
                queryEnd,
                queryLength,
                queryProteinLength,
                queryStart,
                queryStrand,
                source,
                codingSegments,
            }))
            : [];
        const blocks = [...hspBlocks, ...mismatchMarkers];
        if (!hspBlocks.length) {
            return [];
        }
        const start = Math.min(...hspBlocks.map(block => block.start));
        const end = Math.max(...hspBlocks.map(block => block.end));
        const label = hitLabel(description, hitIndex);
        const title = description.title?.trim();
        const totalAlignLength = sum(hsps, 'align_len');
        const totalIdentical = sum(hsps, 'identity');
        const totalPositive = sum(hsps, 'positive');
        const identity = weightedPercent(hsps, 'identity');
        const positives = weightedPercent(hsps, 'positive');
        const mismatches = totalMismatches(hsps);
        const gaps = sum(hsps, 'gaps');
        const evalue = bestEvalue(hsps);
        const bitScore = bestBitScore(hsps);
        const queryCoverage = queryCoveragePct(hsps, queryProteinLength);
        const bestHsp = [...hsps].sort(compareHsps)[0];
        const subjectRange = hspSubjectRange(hsps);
        const subjectFullLength = subjectProteinLength(hit, hsps);
        const queryCoveredLengthAa = queryCoveredLength(hsps);
        const subjectCoveredLength = subjectCoveredLengthAa(hsps);
        const subjectRangeLength = subjectRange
            ? subjectRange.to - subjectRange.from + 1
            : undefined;
        return [
            {
                uniqueId: hitId(description, hitIndex, idPrefix),
                refName,
                start,
                end,
                type: 'gene',
                name: label,
                totalQueryLengthAa: queryProteinLength,
                totalSubjectLengthAa: subjectFullLength,
                totalPercentIdentity: identity,
                queryAlignedLengthAa: queryCoveredLengthAa,
                subjectAlignedLengthAa: subjectCoveredLength,
                totalSubjectAlignedLengthAa: subjectCoveredLength,
                hitRank: hitIndex + 1,
                identity,
                percentIdentity: identity,
                queryCoverage,
                evalue,
                bitScore,
                positives,
                percentPositives: positives,
                mismatches,
                gaps,
                hspCount: hsps.length,
                candidateClass: blastCandidateClass,
                blastCandidateClass,
                subjectToQueryLengthRatio: rankingStats.subjectToQueryLengthRatio,
                strand: queryStrand,
                score: bitScore,
                source,
                blastProgram,
                coordinateProjection: codingSegments.length
                    ? 'Protein HSP query coordinates projected onto CDS exons'
                    : 'Protein HSP query coordinates projected over feature span; no CDS subfeatures found',
                id: label,
                gene_id: label,
                length: subjectFullLength,
                lengthUnits: 'amino acids',
                queryFeature: getFeatureName(queryFeature),
                queryProteinLengthAa: queryProteinLength,
                subjectRangeLengthAa: subjectRangeLength,
                accession: description.accession,
                ncbiId: description.id,
                description: title,
                note: title,
                scientificName: description.sciname,
                taxid: description.taxid,
                totalAlignedAminoAcids: totalAlignLength,
                identicalAminoAcids: totalIdentical,
                positiveAminoAcids: totalPositive,
                bestHspIdentity: bestHsp ? hspStats(bestHsp).identity : undefined,
                bestHspEvalue: bestHsp?.evalue,
                bestHspBitScore: bestHsp?.bit_score,
                bestHspQueryRange: bestHsp
                    ? `${bestHsp.query_from}-${bestHsp.query_to}`
                    : undefined,
                subjectFrom: subjectRange?.from,
                subjectTo: subjectRange?.to,
                subjectLengthAa: subjectFullLength,
                subjectProteinLengthAa: subjectFullLength,
                hitLengthAa: subjectFullLength,
                descriptionMemberCount: descriptions.length,
                allAccessions: joinedDescriptionField(descriptions, 'accession'),
                allDescriptions: joinedDescriptionField(descriptions, 'title'),
                deduplicatedProductKey: rankingStats.productKey,
                deduplicatedSubjectGeneKey: rankingStats.subjectGeneKey,
                rankingScore: rankingStats.rankingScore,
                maxHspsPerHit: hspLimit,
                availableHspCount: allHsps.length,
                mismatchMarkersShown: showMismatchMarkers,
                subfeatures: blocks,
            },
        ];
    });
}
function hasQueryRange(hsp) {
    return hsp.query_from !== undefined && hsp.query_to !== undefined;
}
function proteinPositionToGenomeOffset({ proteinPosition, queryProteinLength, queryLength, }) {
    return Math.round(((proteinPosition - 1) / queryProteinLength) * queryLength);
}
function getCodingSegments(feature) {
    const json = feature.toJSON();
    const strand = json.strand ?? 1;
    const cds = getBestCdsSet(json);
    const orderedCds = [...cds].sort((a, b) => strand === -1 ? b.start - a.start : a.start - b.start);
    let offset = 0;
    return orderedCds.map(sub => {
        const length = sub.end - sub.start;
        const segment = {
            start: sub.start,
            end: sub.end,
            codingStart: offset,
            codingEnd: offset + length,
            strand,
        };
        offset += length;
        return segment;
    });
}
function hspToCdsBlocks({ blastCandidateClass, description, hitIndex, hsp, hspIndex, idPrefix, refName, queryEnd, queryLength, queryProteinLength, queryStart, queryStrand, source, codingSegments, subjectToQueryLengthRatio, }) {
    const codingStart = (Math.min(hsp.query_from, hsp.query_to) - 1) * 3;
    const codingEnd = Math.max(hsp.query_from, hsp.query_to) * 3;
    const stats = hspStats(hsp);
    const ranges = codingSegments.length
        ? codingIntervalToGenomeRanges(codingStart, codingEnd, codingSegments)
        : wholeFeatureProteinRanges({
            codingStart,
            codingEnd,
            queryEnd,
            queryLength,
            queryProteinLength,
            queryStart,
            queryStrand,
        });
    return ranges.map((range, partIndex) => ({
        uniqueId: `${hitId(description, hitIndex, idPrefix)}_hsp_${hspIndex + 1}_part_${partIndex + 1}`,
        refName,
        type: 'CDS',
        start: range.start,
        end: range.end,
        name: ranges.length === 1
            ? `HSP ${hspIndex + 1}`
            : `HSP ${hspIndex + 1}.${partIndex + 1}`,
        strand: queryStrand,
        source,
        length: hsp.align_len,
        lengthUnits: 'amino acids',
        blastCandidateClass,
        candidateClass: blastCandidateClass,
        subjectToQueryLengthRatio,
        hspNumber: hspIndex + 1,
        hspPart: partIndex + 1,
        queryAaRange: `${Math.min(hsp.query_from, hsp.query_to)}-${Math.max(hsp.query_from, hsp.query_to)}`,
        coordinateProjection: codingSegments.length ? 'CDS exon segment' : 'feature span',
        ...stats,
    }));
}
function codingIntervalToGenomeRanges(codingStart, codingEnd, codingSegments) {
    return codingSegments.flatMap(segment => {
        const overlapStart = Math.max(codingStart, segment.codingStart);
        const overlapEnd = Math.min(codingEnd, segment.codingEnd);
        if (overlapStart >= overlapEnd) {
            return [];
        }
        const localStart = overlapStart - segment.codingStart;
        const localEnd = overlapEnd - segment.codingStart;
        return [
            segment.strand === -1
                ? {
                    start: segment.end - localEnd,
                    end: segment.end - localStart,
                }
                : {
                    start: segment.start + localStart,
                    end: segment.start + localEnd,
                },
        ];
    });
}
function wholeFeatureProteinRanges({ codingStart, codingEnd, queryEnd, queryLength, queryProteinLength, queryStart, queryStrand, }) {
    const start = proteinPositionToGenomeOffset({
        proteinPosition: codingStart / 3 + 1,
        queryProteinLength,
        queryLength,
    });
    const end = proteinPositionToGenomeOffset({
        proteinPosition: codingEnd / 3 + 1,
        queryProteinLength,
        queryLength,
    });
    return [
        queryStrand >= 0
            ? { start: queryStart + start, end: queryStart + end }
            : { start: queryEnd - end, end: queryEnd - start },
    ];
}
function hspMismatchMarkers(args) {
    const { hsp, codingSegments } = args;
    const mismatches = hspMismatchPositions(hsp);
    if (!mismatches.length || !codingSegments.length) {
        return [];
    }
    return mismatches.flatMap((mismatch, mismatchIndex) => {
        const codingStart = (mismatch.queryAa - 1) * 3;
        const codingEnd = mismatch.queryAa * 3;
        const ranges = codingIntervalToGenomeRanges(codingStart, codingEnd, codingSegments);
        return ranges.map((range, partIndex) => ({
            uniqueId: `${hitId(args.description, args.hitIndex, args.idPrefix)}_hsp_${args.hspIndex + 1}_mismatch_${mismatchIndex + 1}_${partIndex + 1}`,
            refName: args.refName,
            type: mismatch.kind,
            start: range.start,
            end: range.end,
            name: mismatch.kind === 'gap'
                ? `Gap Q${mismatch.queryAa}`
                : `Mismatch Q${mismatch.queryAa}`,
            strand: args.queryStrand,
            source: args.source,
            hspNumber: args.hspIndex + 1,
            queryAa: mismatch.queryAa,
            queryResidue: mismatch.queryResidue,
            subjectResidue: mismatch.subjectResidue,
            description: mismatch.kind === 'gap'
                ? `gap at query amino acid ${mismatch.queryAa}`
                : `${mismatch.queryResidue}->${mismatch.subjectResidue} at query amino acid ${mismatch.queryAa}`,
        }));
    });
}
function hspMismatchPositions(hsp) {
    const { qseq, hseq } = hsp;
    if (!qseq || !hseq) {
        return [];
    }
    const direction = hsp.query_to >= hsp.query_from ? 1 : -1;
    let queryPos = hsp.query_from;
    const mismatches = [];
    for (let i = 0; i < qseq.length; i++) {
        const queryResidue = qseq[i];
        const subjectResidue = hseq[i];
        if (queryResidue === '-') {
            continue;
        }
        if (subjectResidue === '-') {
            mismatches.push({
                kind: 'gap',
                queryAa: queryPos,
                queryResidue,
                subjectResidue,
            });
        }
        else if (queryResidue &&
            subjectResidue &&
            queryResidue.toUpperCase() !== subjectResidue.toUpperCase()) {
            mismatches.push({
                kind: 'mismatch',
                queryAa: queryPos,
                queryResidue,
                subjectResidue,
            });
        }
        queryPos += direction;
    }
    return mismatches;
}
function hitId(description, index, prefix) {
    const id = (description.accession ??
        description.id ??
        `blast_hit_${index + 1}`).replaceAll(/[^A-Za-z0-9_.-]/g, '_');
    return prefix ? `${prefix}_${id}` : id;
}
function hitLabel(description, index) {
    return description.accession ?? description.id ?? `BLAST hit ${index + 1}`;
}
function hspStats(hsp) {
    const identity = percent(hsp.identity, hsp.align_len);
    const positives = percent(hsp.positive, hsp.align_len);
    return {
        evalue: hsp.evalue,
        bitScore: hsp.bit_score,
        score: hsp.score,
        identity,
        percentIdentity: identity,
        positives,
        percentPositives: positives,
        mismatches: hsp.align_len === undefined || hsp.identity === undefined
            ? undefined
            : hsp.align_len - hsp.identity - (hsp.gaps ?? 0),
        gaps: hsp.gaps,
        identicalAminoAcids: hsp.identity,
        positiveAminoAcids: hsp.positive,
        alignmentLengthAa: hsp.align_len,
        alignLengthAa: hsp.align_len,
        queryFrom: hsp.query_from,
        queryTo: hsp.query_to,
        subjectFrom: hsp.hit_from,
        subjectTo: hsp.hit_to,
        mismatchQueryPositions: hsp.query_from
            ? hspMismatchPositions(hsp)
                .map(pos => pos.queryAa)
                .join(', ')
            : undefined,
        description: `identity ${identity}%, e-value ${hsp.evalue ?? 'n/a'}`,
    };
}
function bestHits(hits, hitLimit, queryProteinLength) {
    const rankedHits = [...hits]
        .filter(hit => hit.hsps.some(hasQueryRange))
        .map(hit => ({
        hit,
        stats: hitRankingStats(hit, queryProteinLength),
    }))
        .sort(compareRankedHits);
    return selectDisplayedHits(rankedHits, hitLimit).map(({ hit }) => hit);
}
function selectDisplayedHits(rankedHits, hitLimit) {
    if (!Number.isFinite(hitLimit)) {
        return rankedHits;
    }
    const selected = [];
    const selectedHits = new Set();
    const selectedProductKeys = new Set();
    const selectedSubjectGeneKeys = new Set();
    function add(hit, allowDuplicateProduct = false) {
        if (!hit ||
            selectedHits.has(hit.hit) ||
            selectedSubjectGeneKeys.has(hit.stats.subjectGeneKey) ||
            (!allowDuplicateProduct && selectedProductKeys.has(hit.stats.productKey)) ||
            selected.length >= hitLimit) {
            return;
        }
        selectedHits.add(hit.hit);
        selectedProductKeys.add(hit.stats.productKey);
        selectedSubjectGeneKeys.add(hit.stats.subjectGeneKey);
        selected.push(hit);
    }
    for (const rankedHit of rankedHits) {
        add(rankedHit);
    }
    for (const rankedHit of rankedHits) {
        add(rankedHit, true);
    }
    return selected;
}
function limitHsps(hsps, hspLimit) {
    return [...hsps].sort(compareHsps).slice(0, hspLimit);
}
function compareRankedHits(a, b) {
    const aStats = a.stats;
    const bStats = b.stats;
    const rankingScoreDiff = bStats.rankingScore - aStats.rankingScore;
    if (rankingScoreDiff) {
        return rankingScoreDiff;
    }
    const coverageDiff = bStats.queryCoverage - aStats.queryCoverage;
    if (Math.abs(coverageDiff) >= 5) {
        return coverageDiff;
    }
    const bitScoreDiff = bStats.bitScore - aStats.bitScore;
    if (bitScoreDiff) {
        return bitScoreDiff;
    }
    const alignedLengthDiff = bStats.alignedLength - aStats.alignedLength;
    if (alignedLengthDiff) {
        return alignedLengthDiff;
    }
    const informativeDescriptionDiff = Number(bStats.hasInformativeDescription) -
        Number(aStats.hasInformativeDescription);
    if (informativeDescriptionDiff) {
        return informativeDescriptionDiff;
    }
    const evalueDiff = aStats.evalue - bStats.evalue;
    if (evalueDiff) {
        return evalueDiff;
    }
    const identityDiff = bStats.identity - aStats.identity;
    if (identityDiff) {
        return identityDiff;
    }
    return bStats.subjectLength - aStats.subjectLength;
}
function compareHsps(a, b) {
    const bitScoreDiff = (b.bit_score ?? 0) - (a.bit_score ?? 0);
    if (bitScoreDiff) {
        return bitScoreDiff;
    }
    const alignedLengthDiff = (b.align_len ?? 0) - (a.align_len ?? 0);
    if (alignedLengthDiff) {
        return alignedLengthDiff;
    }
    return ((a.evalue ?? Number.POSITIVE_INFINITY) -
        (b.evalue ?? Number.POSITIVE_INFINITY));
}
function bestEvalue(hsps) {
    return Math.min(...hsps.map(hsp => hsp.evalue ?? Number.POSITIVE_INFINITY));
}
function bestBitScore(hsps) {
    return Math.max(...hsps.map(hsp => hsp.bit_score ?? 0));
}
function hitRankingStats(hit, queryProteinLength) {
    const hsps = hit.hsps.filter(hasQueryRange);
    const subjectLength = subjectProteinLength(hit, hsps) ?? 0;
    const queryCoverage = queryCoveragePct(hsps, queryProteinLength);
    const identity = weightedPercent(hsps, 'identity');
    const evalue = bestEvalue(hsps);
    const bitScore = bestBitScore(hsps);
    const hasInformativeDescription = hit.description?.some(isInformativeDescription) ?? false;
    const subjectToQueryLengthRatio = queryProteinLength
        ? Number((subjectLength / queryProteinLength).toFixed(2))
        : 0;
    const isLikelyCompleteAnnotatedMatch = hasInformativeDescription &&
        subjectToQueryLengthRatio >= 1.2 &&
        queryCoverage >= 50 &&
        identity >= 30 &&
        evalue <= 1e-5;
    const isStrongQueryLengthMatch = queryCoverage >= 98 &&
        identity >= 90 &&
        subjectToQueryLengthRatio <= 1.25;
    const isLongerSubjectMatch = queryProteinLength > 0 && subjectLength > queryProteinLength;
    const isHighConfidenceLongerSubjectMatch = isLongerSubjectMatch &&
        queryCoverage >= 50 &&
        identity >= 30 &&
        evalue <= 1e-5;
    return {
        alignedLength: queryCoveredLength(hsps),
        bitScore,
        evalue,
        hasInformativeDescription,
        identity,
        isHighConfidenceLongerSubjectMatch,
        isLongerSubjectMatch,
        isLikelyCompleteAnnotatedMatch,
        isStrongQueryLengthMatch,
        queryCoverage,
        rankingScore: hitRankingScore({
            bitScore,
            evalue,
            hasInformativeDescription,
            identity,
            isHighConfidenceLongerSubjectMatch,
            isLikelyCompleteAnnotatedMatch,
            isStrongQueryLengthMatch,
            queryCoverage,
            subjectToQueryLengthRatio,
        }),
        productKey: productKeyForHit(hit),
        subjectGeneKey: subjectGeneKeyForHit(hit),
        subjectLength,
        subjectToQueryLengthRatio,
    };
}
function hitRankingScore({ bitScore, evalue, hasInformativeDescription, identity, isHighConfidenceLongerSubjectMatch, isLikelyCompleteAnnotatedMatch, isStrongQueryLengthMatch, queryCoverage, subjectToQueryLengthRatio, }) {
    return (bitScore * 10 +
        evalueRankScore(evalue) +
        queryCoverage * 5 +
        identity * 2 +
        (isLikelyCompleteAnnotatedMatch ? 1_500 : 0) +
        (isHighConfidenceLongerSubjectMatch ? 1_000 : 0) +
        (isStrongQueryLengthMatch ? 500 : 0) +
        (hasInformativeDescription ? 300 : -100) +
        Math.min(subjectToQueryLengthRatio, 5) * 50);
}
function evalueRankScore(evalue) {
    if (evalue <= 0) {
        return 600;
    }
    if (!Number.isFinite(evalue)) {
        return 0;
    }
    return Math.min(600, Math.max(0, -Math.log10(evalue) * 20));
}
function candidateClass(stats) {
    if (stats.isLongerSubjectMatch) {
        return 'longer subject match';
    }
    if (stats.isLikelyCompleteAnnotatedMatch) {
        return 'likely complete annotated homolog';
    }
    if (stats.isStrongQueryLengthMatch) {
        return 'query-length match';
    }
    return 'alignment match';
}
function weightedPercent(hsps, field) {
    const numerator = sum(hsps, field);
    const denominator = sum(hsps, 'align_len');
    return percent(numerator, denominator);
}
function queryCoveragePct(hsps, queryProteinLength) {
    return percent(queryCoveredLength(hsps), queryProteinLength);
}
function queryCoveredLength(hsps) {
    const covered = new Set();
    for (const hsp of hsps) {
        if (hsp.query_from === undefined || hsp.query_to === undefined) {
            continue;
        }
        const start = Math.min(hsp.query_from, hsp.query_to);
        const end = Math.max(hsp.query_from, hsp.query_to);
        for (let i = start; i <= end; i++) {
            covered.add(i);
        }
    }
    return covered.size;
}
function hspSubjectRange(hsps) {
    const coords = hsps.flatMap(hsp => hsp.hit_from === undefined || hsp.hit_to === undefined
        ? []
        : [hsp.hit_from, hsp.hit_to]);
    return coords.length
        ? { from: Math.min(...coords), to: Math.max(...coords) }
        : undefined;
}
function subjectProteinLength(hit, hsps) {
    return positiveLength(hit.len) ?? hspSubjectRangeLength(hsps);
}
function hspSubjectRangeLength(hsps) {
    const range = hspSubjectRange(hsps);
    return range ? range.to - range.from + 1 : undefined;
}
function subjectCoveredLengthAa(hsps) {
    const covered = new Set();
    let hasSubjectCoordinates = false;
    for (const hsp of hsps) {
        if (hsp.hit_from === undefined || hsp.hit_to === undefined) {
            continue;
        }
        hasSubjectCoordinates = true;
        const start = Math.min(hsp.hit_from, hsp.hit_to);
        const end = Math.max(hsp.hit_from, hsp.hit_to);
        for (let i = start; i <= end; i++) {
            covered.add(i);
        }
    }
    return hasSubjectCoordinates ? covered.size : undefined;
}
function positiveLength(value) {
    return typeof value === 'number' && value > 0 ? value : undefined;
}
function totalMismatches(hsps) {
    return hsps.reduce((total, hsp) => {
        if (hsp.align_len === undefined || hsp.identity === undefined) {
            return total;
        }
        return total + hsp.align_len - hsp.identity - (hsp.gaps ?? 0);
    }, 0);
}
function sum(hsps, field) {
    return hsps.reduce((total, hsp) => {
        const value = hsp[field];
        return typeof value === 'number' ? total + value : total;
    }, 0);
}
function percent(numerator = 0, denominator = 0) {
    return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}
function displayDescription(descriptions) {
    return descriptions.find(isInformativeDescription) ?? descriptions[0] ?? {};
}
function isInformativeDescription(description) {
    const title = description.title?.trim();
    return Boolean(title && !isGenericProteinTitle(title));
}
function isGenericProteinTitle(title) {
    return /\b(hypothetical|uncharacteri[sz]ed|unnamed protein product|predicted protein|unknown function)\b/i.test(title);
}
function productKeyForHit(hit) {
    const descriptions = hit.description ?? [];
    const description = displayDescription(descriptions);
    const title = stripOrganismSuffix(description.title ?? '').trim();
    if (!title) {
        return `accession:${description.accession ?? description.id ?? hit.num ?? 'unknown'}`;
    }
    if (isGenericProteinTitle(title)) {
        return genericProductKey(title);
    }
    return `product:${normalizeProductTitle(title)}`;
}
function subjectGeneKeyForHit(hit) {
    const descriptions = hit.description ?? [];
    const description = displayDescription(descriptions);
    const title = normalizeProductTitle(description.title ?? '');
    const organism = normalizeSubjectOrganism(description);
    const accessionStem = normalizeAccessionStem(description.accession ?? description.id);
    if (title && organism) {
        return `title-organism:${title}:${organism}`;
    }
    if (title && accessionStem) {
        return `title-accession:${title}:${accessionStem}`;
    }
    return `accession:${description.accession ?? description.id ?? hit.num ?? 'unknown'}`;
}
function normalizeSubjectOrganism(description) {
    if (description.taxid !== undefined) {
        return String(description.taxid);
    }
    if (description.sciname) {
        return description.sciname.trim().toLowerCase();
    }
    const organismMatch = /\[([^\]]+)\]\s*$/.exec(description.title ?? '');
    return organismMatch?.[1]?.trim().toLowerCase();
}
function normalizeAccessionStem(accession) {
    return accession?.replace(/\.\d+$/, '').trim().toLowerCase();
}
function genericProductKey(title) {
    if (/\bhypothetical\b/i.test(title)) {
        return 'generic:hypothetical protein';
    }
    if (/\bunnamed\b/i.test(title)) {
        return 'generic:unnamed protein product';
    }
    if (/\buncharacteri[sz]ed\b/i.test(title)) {
        return 'generic:uncharacterized protein';
    }
    if (/\bpredicted\b/i.test(title)) {
        return 'generic:predicted protein';
    }
    return `generic:${normalizeProductTitle(title)}`;
}
function stripOrganismSuffix(title) {
    return title.replace(/\s+\[[^\]]+\]\s*$/, '');
}
function normalizeProductTitle(title) {
    return stripOrganismSuffix(title)
        .replace(/\b(partial|isoform\s+\S+|LOW QUALITY PROTEIN:|PREDICTED:)\b/gi, ' ')
        .replaceAll(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
}
function joinedDescriptionField(descriptions, field) {
    const values = descriptions
        .map(description => description[field]?.trim())
        .filter((value) => Boolean(value));
    return values.length ? values.join(' | ') : undefined;
}
