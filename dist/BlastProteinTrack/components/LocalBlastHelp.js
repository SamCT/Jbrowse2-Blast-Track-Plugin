import { jsx as _jsx } from "react/jsx-runtime";
import { Box, Tooltip } from '@mui/material';
const localBlastHelpText = 'Precomputed BLASTP expects a static tabix-indexed table. Run BLASTP outside JBrowse, prepend qseqid/qstart/qend lookup columns, bgzip it, tabix-index it, then list the .tsv.gz URL in precomputedBlastpTables in config.json.';
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
