# Precomputed BLASTP Tables

BlastTrack can read static BLASTP result tables that were generated outside
JBrowse. This is the preferred local/HPC workflow: JBrowse does not run BLAST,
does not need a BLAST API server, and only fetches rows for the clicked query
gene/protein from a bgzip/tabix-indexed table.

## BLASTP command

Use a lean `outfmt 6` table that does not assume NCBI-style FASTA headers:

```bash
blastp \
  -query Microvine_H2_Final_prots.aa \
  -db PN40024_5.1_protein \
  -evalue 1e-3 \
  -max_target_seqs 100 \
  -max_hsps 5 \
  -outfmt "6 qseqid sseqid pident length nident mismatch positive gapopen gaps qstart qend sstart send evalue bitscore qlen slen qcovhsp qcovs ppos" \
  -out H2Microvine_vs_T2T_v51_db.protein.blasttrack.raw.tsv \
  -num_threads 32
```

## Prepare the indexed table

Tabix needs the first columns to be the lookup sequence and interval. For this
workflow, the lookup sequence is `qseqid`, and the interval is the normalized
protein query range.

```bash
awk 'BEGIN{OFS="\t"} {
  qs=$10
  qe=$11
  if (qs > qe) {
    tmp=qs
    qs=qe
    qe=tmp
  }
  print $1, qs, qe, $0
}' H2Microvine_vs_T2T_v51_db.protein.blasttrack.raw.tsv \
| LC_ALL=C sort -k1,1 -k2,2n -k3,3n \
> H2Microvine_vs_T2T_v51_db.protein.blasttrack.tsv

bgzip -f H2Microvine_vs_T2T_v51_db.protein.blasttrack.tsv

tabix -f \
  -s 1 \
  -b 2 \
  -e 3 \
  H2Microvine_vs_T2T_v51_db.protein.blasttrack.tsv.gz
```

The files hosted for JBrowse are:

```text
H2Microvine_vs_T2T_v51_db.protein.blasttrack.tsv.gz
H2Microvine_vs_T2T_v51_db.protein.blasttrack.tsv.gz.tbi
```

## JBrowse config.json

Add the precomputed table to the BlastTrack plugin entry:

```json
{
  "plugins": [
    {
      "name": "BlastTrack",
      "url": "https://cdn.jsdelivr.net/gh/SamCT/Jbrowse2-Blast-Track-Plugin@COMMIT/dist/jbrowse-plugin-blast-track.umd.production.min.js",
      "precomputedBlastpTables": [
        {
          "id": "H2_vs_PN40024_v51",
          "name": "H2 Microvine vs PN40024 v5.1 proteins",
          "url": "data/blastDB/H2Microvine_vs_T2T_v51_db.protein.blasttrack.tsv.gz"
        }
      ]
    }
  ]
}
```

If the index is not at `url + ".tbi"`, add `indexUrl`.

The clicked gene supplies the query genomic/CDS coordinates. The indexed table
only supplies BLASTP rows by `qseqid`, so the plugin can project `qstart/qend`
onto the clicked gene model in the same viewer.
