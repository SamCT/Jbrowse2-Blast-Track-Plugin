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

If JBrowse is hosted under a subpath and the local BLAST API is also mounted
under that subpath, add `blastApiBase` to the plugin URL:

```json
{
  "plugins": [
    {
      "name": "BlastTrack",
      "url": "https://cdn.jsdelivr.net/gh/SamCT/Jbrowse2-Blast-Track-Plugin@main/dist/jbrowse-plugin-blast-track.umd.production.min.js?blastApiBase=/private/jbrowse2/api/blast"
    }
  ]
}
```

This only changes where the browser sends local BLAST requests. The web server
still needs to provide that API route.

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

With `?blastApiBase=/private/jbrowse2/api/blast`, the same calls become:

```text
GET  /private/jbrowse2/api/blast/dbs?program=blastp
POST /private/jbrowse2/api/blast/search
```

That means the local BLASTP feature requires a JBrowse host that provides these
endpoints. A static file host can load the plugin and run NCBI BLAST, but it
cannot run local BLAST databases unless an API server is added.

## Reverse proxy example

If Apache already serves JBrowse at `/private/jbrowse2`, the local BLAST API can
be routed through the same origin by proxying only the API subpath to a backend
process:

```apache
ProxyPass        /private/jbrowse2/api/blast/ http://127.0.0.1:3000/api/blast/
ProxyPassReverse /private/jbrowse2/api/blast/ http://127.0.0.1:3000/api/blast/
```

The backend process would run on the HPC with access to BLAST+ and the database
directory:

```bash
BLASTDB_DIR=/data/blastDB \
BLAST_BIN_DIR=/path/to/ncbi-blast+/bin \
PORT=3000 \
npm run serve:jbrowse
```

The exact Apache/Nginx syntax depends on the site configuration. The important
point is that `/private/jbrowse2/api/blast/...` must return JSON from the BLAST
API rather than an HTML 404 page.
