# JBrowse BLAST Track Plugin

Prototype JBrowse 2 plugin for launching NCBI BLAST queries from JBrowse and loading the resulting hits as temporary gene-like tracks in the same linear genome view.

## Install In JBrowse

After the package is published to npm, add the plugin to a JBrowse 2 config with:

```json
{
  "plugins": [
    {
      "name": "BlastTrack",
      "url": "https://unpkg.com/jbrowse-plugin-blast-track/dist/jbrowse-plugin-blast-track.umd.production.min.js"
    }
  ]
}
```

For testing directly from the GitHub repository before npm publishing, use:

```json
{
  "plugins": [
    {
      "name": "BlastTrack",
      "url": "https://cdn.jsdelivr.net/gh/SamCT/Jbrowse2-Blast-Track-Plugin@main/dist/jbrowse-plugin-blast-track.umd.production.min.js"
    }
  ]
}
```

## Public Release Checklist

1. Create a public GitHub repository for this source tree, for example `jbrowse-plugin-blast-track`.
2. Add the final repository metadata to `package.json`, especially `repository`, `homepage`, `bugs`, and `author`.
3. Publish the package to npm with `npm publish --access public`.
4. Test the published plugin URL in a clean JBrowse session:

```text
https://unpkg.com/jbrowse-plugin-blast-track/dist/jbrowse-plugin-blast-track.umd.production.min.js
```

5. Open a pull request to `GMOD/jbrowse-plugin-list` adding an entry like:

```json
{
  "name": "BlastTrack",
  "authors": ["Your name"],
  "description": "Run NCBI BLAST from JBrowse feature and region selections and render hits as same-view tracks.",
  "location": "https://github.com/SamCT/Jbrowse2-Blast-Track-Plugin",
  "url": "https://unpkg.com/jbrowse-plugin-blast-track/dist/jbrowse-plugin-blast-track.umd.production.min.js",
  "license": "GPL-3.0-only"
}
```

## Workflow

1. Right-click a `gene`, `mRNA`, or `transcript` feature in a linear genome view.
2. Choose **BLAST protein and load track**.
3. Select the BLAST database/program, keep or adjust the max-hit limit, and submit. The default program is `quick-blastp` for faster interactive testing.
4. The plugin submits the protein sequence to NCBI BLAST with `HITLIST_SIZE` set from the max-hit limit, polls the RID, fetches `JSON2_S` alignment results, and adds a same-view `FeatureTrack` backed by `FromConfigAdapter`.

Region selection also adds two rubberband menu actions:

- **BLASTP genes in selection** finds overlapping `gene`, `mRNA`, and `transcript` features, derives protein sequence from CDS, submits one multi-FASTA protein BLAST request, and renders the best hits over each query gene CDS.
- **BLASTN selected region** fetches the selected reference sequence, submits it to NCBI `blastn`, and renders HSP blocks over the selected genomic span.

## Coordinate Model

NCBI `blastp` hits are protein-space alignments, not genomic placements on the subject assemblies. This plugin renders each BLAST hit over the original query gene locus, but projects HSP query amino-acid coordinates onto CDS exon segments rather than stretching them across the whole gene span. HSPs become blue CDS-like child blocks under a gene-like parent feature. Mismatch and gap positions from the aligned BLAST `qseq`/`hseq` are shown as red codon-width markers. The parent label uses the hit accession/ID, and the BLAST title is stored as `description`/`note` so JBrowse can show it as blue description text. Feature metadata also includes E-value, bit score, identity, mismatches, positives, gaps, query coverage, and subject coordinates.

This intentionally does not launch the MSA plugin's MSA/tree view. It borrows the NCBI BLAST submission pattern, but the output is just another track in the active JBrowse linear genome view.

## Result Defaults

- Right-click gene BLASTP default max hits: 3, with up to 3 HSPs rendered per hit.
- Region BLASTN default max hits: 5, with up to 3 HSPs rendered per hit and a 50,000 bp default max-region guard.
- Region gene BLASTP defaults to 10 genes, 3 hits per gene, and up to 3 HSPs rendered per hit.
- The dialog allows changing the limit from 1 to 100.
- NCBI Common URL API supports `HITLIST_SIZE` for the number of database sequences to keep. The HSP limit is applied while building the JBrowse track from returned alignments.
- Batch BLASTP tracks include a query marker for every selected gene that was inside the max-gene limit. Gray query markers have hits rendered elsewhere in the track, orange single-box markers mean NCBI returned a report for that query with no hits, purple single-box markers mean the returned NCBI report could not be confidently matched to the query, and dark gray single-box markers mean no CDS/protein sequence was available to submit.
- Submitted BLAST features store the NCBI RID as `blastRid` and the result page as `blastResultUrl`. Right-click a BLAST hit, HSP, or submitted query marker and choose **Open NCBI BLAST result** to open the original NCBI results page while the RID remains available.
- Returned hits are sorted by best E-value, then best bit score, before track features are created.
- Parent hit features carry summary fields for accession, NCBI ID, description, species, taxid, percent identity, percent positives, mismatches, gaps, query coverage, total aligned amino acids, best HSP stats, subject range, and HSP count.
- HSP child blocks carry per-block identity, positives, mismatches, gaps, E-value, bit score, query coordinates, subject coordinates, and amino-acid alignment length. HSP blocks are blue. Red mismatch/gap tick marks can be enabled in the BLAST dialog, but they are hidden by default to keep dense tracks readable.

## NCBI Usage Behavior

- BLAST submissions include `tool=BlastTrack`.
- The dialogs include an optional contact email field, stored in browser local storage, and sent as NCBI's `email` parameter when provided.
- BLAST submissions are queued in the browser runtime so separate NCBI submissions start at least 10 seconds apart.
- RID status polling happens once per minute.
- Region gene BLASTP uses one multi-FASTA request for the selected genes instead of one request per gene.
- BlastTrack warns when a selected-region BLASTP job submits 10 or more genes.

## Notes

- The protein-sequence extractor first looks for common feature attributes such as `protein_sequence`, `proteinSequence`, `translation`, or `seq`, then falls back to translating CDS subfeatures from the reference sequence.
- This scaffold mirrors the launch pattern from `jbrowse-plugin-msaview`, but creates a session track instead of opening an MSA view.
- Planned follow-up work for coding-sequence `tblastx` is captured in `MILESTONES.md`.
