# Milestones

## Milestone 001: Local BLAST Table Import

Goal: let users load BLAST results produced outside BlastTrack, such as local BLAST+ searches, HPC cluster jobs, or searches against `makeblastdb` databases, and render them as same-view BlastTrack result tracks without submitting sequence to NCBI or requiring BlastTrack to run the server-side job.

### User Workflow

Status: planned.

1. User opens a BlastTrack action from the top-level menu or plugin panel: **Add BLAST file from local**.
2. Dialog explains the supported BLAST tabular format and shows a copyable example command.
3. User chooses a local `.tsv`, `.tab`, or `.blast6` file from disk.
4. User selects how query IDs should be resolved:
   - Match `qseqid` to feature IDs/names in a selected annotation track.
   - Match `qseqid` to query markers from an existing BlastTrack run.
   - Later extension: upload a query-coordinate mapping file, such as BED/GFF/TSV.
5. Plugin parses the BLAST table, groups rows by `qseqid` and `sseqid`, limits hits/HSPs with the same defaults as NCBI runs, and adds a same-view `FeatureTrack`.
6. Unmatched query IDs are reported in the dialog and optionally rendered as distinct "unmapped query" markers.

### HPC Precomputed Database Workflow

Status: planned.

- User or admin creates BLAST databases on the HPC with `makeblastdb`.
- User runs `blastp`, `blastn`, `tblastn`, or later `tblastx` outside JBrowse using scheduler/HPC resources.
- The completed BLAST table is made available to JBrowse through an HTTPS-accessible URL or selected as a local file.
- BlastTrack parses and renders the completed table only; it does not need to submit the job, poll a queue, or access raw BLAST database files.
- Future config can predefine named completed-result tables, but arbitrary server filesystem paths should not be exposed to the browser.

### Recommended BLAST+ Output

For local protein searches that should resemble the current NCBI `blastp` track, users should run BLAST+ with explicit tabular columns:

```bash
blastp \
  -query query_proteins.fa \
  -db local_protein_db \
  -evalue 1e-5 \
  -max_target_seqs 5 \
  -max_hsps 3 \
  -outfmt "6 qseqid sseqid pident length mismatch gapopen gaps qstart qend sstart send evalue bitscore qlen slen qcovhsp qcovs nident positive ppos staxids sscinames stitle qseq sseq" \
  -out blasttrack_hits.tsv
```

For nucleotide searches:

```bash
blastn \
  -query query_regions.fa \
  -db local_nucleotide_db \
  -evalue 1e-10 \
  -max_target_seqs 5 \
  -max_hsps 3 \
  -outfmt "6 qseqid sseqid pident length mismatch gapopen gaps qstart qend sstart send evalue bitscore qlen slen qcovhsp qcovs nident staxids sscinames stitle qseq sseq" \
  -out blasttrack_hits.tsv
```

Minimum supported columns should be:

```text
qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore
```

Preferred columns should add:

```text
gaps qlen slen qcovhsp qcovs nident positive ppos staxids sscinames stitle qseq sseq
```

Notes:

- The default BLAST+ `-outfmt 6` columns are the 12-column minimum above. Extra fields are needed for richer feature details, query coverage, subject description text, positives, and optional mismatch/gap ticks.
- `qseq` and `sseq` are only required if BlastTrack should reconstruct per-position mismatch/gap ticks from the local table.
- `stitle` should become the feature `description` so JBrowse displays the blue description text beside the hit label.
- `qseqid` must be stable and should match gene/transcript/CDS IDs from JBrowse or IDs produced by a BlastTrack-exported query FASTA.

### Parsing And Rendering Requirements

- Add a parser for BLAST tabular files with configurable column presets:
  - `std`: the 12-column default BLAST+ format.
  - `blasttrack`: the recommended extended format above.
  - `custom`: user supplies the column list matching their file.
- Group multiple rows with the same `qseqid` and `sseqid` as HSPs under one parent hit.
- Sort hits by best E-value, then highest bit score, matching the current NCBI path.
- Apply the same defaults:
  - 3 hits per query for local `blastp` imports.
  - 5 hits for local `blastn` region imports.
  - 3 HSPs per hit.
- Reuse existing feature-detail fields where possible: accession/ID, description, percent identity, positives, mismatches, gaps, query coverage, E-value, bit score, subject range, and HSP count.
- Render local `blastp` HSPs over query CDS coordinates when `qseqid` maps to a gene/transcript/CDS feature.
- Render local `blastn` HSPs over the query region when `qseqid` maps to a selected region/query marker.
- Keep imported tracks session-only by default, with a later option to save them into the JBrowse session/config.

### UI Notes

- Add a button labeled **Add BLAST file from local**.
- Put it in a place users naturally look for data import:
  - preferred: top-level JBrowse **Add** or **Tools** menu contribution from BlastTrack;
  - fallback: a BlastTrack dialog action near the existing BLAST launch controls.
- The dialog should preview the first 5 parsed rows, show detected column names/order, and warn about missing preferred columns.
- The dialog should not upload the file anywhere; parsing stays in the browser.

### Acceptance Criteria

- User can run the example `blastp` command, select `blasttrack_hits.tsv`, and load hits over matching query gene/CDS loci in the current linear genome view.
- User can load a default 12-column BLAST `-outfmt 6` file and still see parent hit/HSP blocks with core statistics.
- Rows with the same query and subject become one parent hit with multiple HSP children.
- Missing `stitle`, `qseq`, or `sseq` degrade gracefully: no blue description or no mismatch ticks, but the track still loads.
- Unmatched query IDs are reported clearly and do not break the whole import.
- Local imports never call NCBI and are not rate-limited by the NCBI queue.

## Milestone: Region And CDS BLAST Workflows

Goal: extend the plugin beyond right-click gene `blastp` so users can BLAST selected nucleotide regions and coding-derived sequences without leaving the linear genome view.

### Workflow 1: BLASTN From Selected Region

Status: implemented in the rubberband menu as **BLASTN selected region**.

- Fetches the selected reference sequence for a single dragged region.
- Submits the nucleotide sequence to NCBI with `PROGRAM=blastn`.
- Keeps the default max-hit limit at 5 and default rendered HSP limit at 3, with the same 1-100 clamp used by the protein workflow.
- Uses a 50,000 bp default max-region guard, which can be raised in the dialog.
- Loads results as a same-view temporary `FeatureTrack`.
- Renders each hit over the query region, with HSP child blocks showing local match quality.
- Stores parent hit details: accession, NCBI ID, description, species, taxid, percent identity, mismatches, gaps, E-value, bit score, query coverage, subject range, and HSP count.
- Stores child HSP details: percent identity, mismatches, gaps, E-value, bit score, query coordinates, and subject coordinates.

Acceptance criteria:

- Drag-select a single continuous region, open the context menu, run `blastn`, and see a new BLAST track in the same linear genome view.
- The browser label shows hit accession/ID plus blue description text.
- Clicking a parent hit shows summary BLAST statistics in the feature details panel.
- Clicking an HSP block shows local/per-block statistics.
- Large result sets are limited by the max-hit setting before rendering.

### Workflow 1B: BLASTP Genes From Selected Region

Status: implemented in the rubberband menu as **BLASTP genes in selection**.

- Finds overlapping `gene`, `mRNA`, and `transcript` features from non-BLAST feature tracks.
- Derives protein sequence from CDS subfeatures and the reference sequence.
- Submits selected genes as one multi-FASTA NCBI protein BLAST request.
- Defaults to 10 genes, 3 hits per gene, and 3 rendered HSPs per hit.
- Renders each hit over the corresponding query gene CDS in the same linear genome view.
- Adds a query marker for every selected gene within the max-gene limit. Confirmed no-hit, unmatched-report, and no-sequence states use distinct single-box markers.
- Reuses the BLASTP parent/HSP metadata and blue HSP/red mismatch display from the single-gene workflow.

### Workflow 2: TBLASTX From Coding Sequence

- Add a feature context menu item for gene/transcript/CDS features: **TBLASTX coding sequence**.
- Extract coding nucleotide sequence from the selected feature.
- If the selected feature is a gene or transcript, prefer CDS subfeatures in transcript order.
- Preserve strand-aware sequence extraction and reverse-complement negative-strand CDS.
- Submit the coding nucleotide sequence to NCBI with `PROGRAM=tblastx`.
- Load results as a same-view temporary `FeatureTrack` over the query coding locus.
- Render each translated hit as a gene-like parent feature with HSP child blocks.
- Include translated-frame metadata when NCBI returns it, including query frame and subject frame.
- Reuse the same max-hit defaults, parent stats, child stats, color-by-identity scheme, and blue description labels.

Acceptance criteria:

- Right-click a gene/transcript/CDS, run `tblastx`, and see a new BLAST track in the same linear genome view.
- CDS-derived sequence is correct for multi-exon and negative-strand features.
- Parent and HSP details include the same summary/local fields as the `blastp` track, plus frames when available.
- The workflow does not open the MSA view or any separate phylogeny/tree window.

### Implementation Notes

- Add a shared `BlastProgram` model/config layer so `blastp`, `blastn`, and `tblastx` use one dialog shell and one NCBI polling client.
- Split query extraction into dedicated utilities:
  - `extractProteinSequence`
  - `extractReferenceRegionSequence`
  - `extractCodingSequence`
- Keep BLAST result mapping program-aware. Protein-space and nucleotide-space query coordinates need separate projection functions.
- Consider adding a sequence-preview field before submission so users can confirm the extracted query.
- Keep all generated tracks session-only by default.
