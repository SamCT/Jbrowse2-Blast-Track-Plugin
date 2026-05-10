import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Typography } from '@mui/material';
export default function ProgressDots({ message }) {
    return (_jsxs(Box, { "aria-live": "polite", sx: {
            '@keyframes blastTrackDotPulse': {
                '0%, 80%, 100%': { opacity: 0.25, transform: 'translateY(0)' },
                '40%': { opacity: 1, transform: 'translateY(-2px)' },
            },
            alignItems: 'center',
            display: 'flex',
            gap: 1.25,
            mt: 2,
        }, children: [_jsx(Box, { sx: { display: 'flex', gap: 0.6 }, children: [0, 1, 2].map(index => (_jsx(Box, { component: "span", sx: {
                        animation: 'blastTrackDotPulse 1.8s ease-in-out infinite',
                        animationDelay: `${index * 0.24}s`,
                        bgcolor: 'text.secondary',
                        borderRadius: '50%',
                        height: 7,
                        width: 7,
                    } }, index))) }), _jsx(Typography, { color: "text.secondary", variant: "body2", children: message })] }));
}
