import React from 'react'

import { Box, Tooltip } from '@mui/material'

const localBlastHelpText =
  'Local BLASTP expects a makeblastdb protein database. Example: makeblastdb -in proteins.faa -dbtype prot -parse_seqids -out data/blastDB/my_species/proteins. The database is discovered by the server; config.json only needs the BlastTrack plugin entry.'

export default function LocalBlastHelp() {
  return (
    <Tooltip arrow title={localBlastHelpText}>
      <Box
        aria-label="Local BLAST database help"
        component="span"
        role="img"
        sx={{
          color: 'warning.main',
          cursor: 'help',
          display: 'inline-flex',
          fontWeight: 700,
          ml: 0.75,
          verticalAlign: 'middle',
        }}
      >
        (!)
      </Box>
    </Tooltip>
  )
}
