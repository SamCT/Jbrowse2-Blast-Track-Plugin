import React from 'react'

import { Box, Typography } from '@mui/material'

export default function ProgressDots({ message }: { message: string }) {
  return (
    <Box
      aria-live="polite"
      sx={{
        '@keyframes blastTrackDotPulse': {
          '0%, 80%, 100%': { opacity: 0.25, transform: 'translateY(0)' },
          '40%': { opacity: 1, transform: 'translateY(-2px)' },
        },
        alignItems: 'center',
        display: 'flex',
        gap: 1.25,
        mt: 2,
      }}
    >
      <Box sx={{ display: 'flex', gap: 0.6 }}>
        {[0, 1, 2].map(index => (
          <Box
            component="span"
            key={index}
            sx={{
              animation: 'blastTrackDotPulse 1.8s ease-in-out infinite',
              animationDelay: `${index * 0.24}s`,
              bgcolor: 'text.secondary',
              borderRadius: '50%',
              height: 7,
              width: 7,
            }}
          />
        ))}
      </Box>
      <Typography color="text.secondary" variant="body2">
        {message}
      </Typography>
    </Box>
  )
}
