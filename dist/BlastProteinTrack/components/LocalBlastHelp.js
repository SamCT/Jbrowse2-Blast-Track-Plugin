import { jsx as _jsx } from "react/jsx-runtime";
import { Box, Tooltip } from '@mui/material';
const localBlastHelpText = 'Local BLASTP expects a makeblastdb protein database. Example: makeblastdb -in proteins.faa -dbtype prot -parse_seqids -out data/blastDB/my_species/proteins. The database is discovered by the server; config.json only needs the BlastTrack plugin entry.';
export default function LocalBlastHelp() {
    return (_jsx(Tooltip, { arrow: true, title: localBlastHelpText, children: _jsx(Box, { "aria-label": "Local BLAST database help", component: "span", role: "img", sx: {
                color: 'warning.main',
                cursor: 'help',
                display: 'inline-flex',
                fontWeight: 700,
                ml: 0.75,
                verticalAlign: 'middle',
            }, children: "(!)" }) }));
}
