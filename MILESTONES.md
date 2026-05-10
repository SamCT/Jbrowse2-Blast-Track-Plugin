# Milestones

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
