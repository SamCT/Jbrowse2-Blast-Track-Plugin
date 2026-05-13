# Local BLASTP Database Setup

BlastTrack can run BLASTP against protein databases that are present on the
same server hosting the JBrowse instance. The browser does not receive raw HPC
filesystem paths. Instead, the server scans a database directory and exposes
safe database IDs through `/api/blast/dbs?program=blastp`.

## JBrowse config.json

The JBrowse `config.json` only needs to load the plugin. Individual BLAST
database files do not need to be listed in `config.json`.

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

After the plugin loads, use **Load local BLAST DBs** in the BLASTP dialog. If
the server finds databases, they appear as entries such as:

```text
arabidopsis_tair10/arabidopsis_tair10_protein
hazelnut/proteins_v1
```

Those names are relative database IDs under the configured BLAST database
directory.

## Default database location

For the bundled local test server, the default scan directory is:

```text
data/blastDB
```

relative to the hosted JBrowse directory. For example:

```text
jbrowse-local/
  config.json
  data/
    blastDB/
      arabidopsis_tair10/
        arabidopsis_tair10_protein.pin
        arabidopsis_tair10_protein.psq
        arabidopsis_tair10_protein.phr
```

The database ID shown in the UI is:

```text
arabidopsis_tair10/arabidopsis_tair10_protein
```

## makeblastdb command

Create a protein database with BLAST+:

```bash
mkdir -p data/blastDB/arabidopsis_tair10

makeblastdb \
  -in arabidopsis_proteins.faa \
  -dbtype prot \
  -parse_seqids \
  -out data/blastDB/arabidopsis_tair10/arabidopsis_tair10_protein
```

BlastTrack currently supports local BLASTP databases only. Use `-dbtype prot`
for local databases used by the plugin.

## Custom server path

If the BLAST databases live outside the hosted JBrowse directory, configure the
server process with `BLASTDB_DIR`:

```bash
BLASTDB_DIR=/data/blastDB \
BLAST_BIN_DIR=/path/to/ncbi-blast+/bin \
npm run serve:jbrowse
```

With this setup, `config.json` still does not list the filesystem path. The
path stays server-side, and the browser only sees safe IDs returned by the API.

## Local API

The plugin calls these same-origin endpoints:

```text
GET  /api/blast/dbs?program=blastp
POST /api/blast/search
```

That means the local BLASTP feature requires a JBrowse host that provides these
endpoints. A static file host can load the plugin and run NCBI BLAST, but it
cannot run local BLAST databases unless an API server is added.
