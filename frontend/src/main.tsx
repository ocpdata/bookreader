import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import CssBaseline from '@mui/material/CssBaseline'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import App from './App.tsx'
import { AuthProvider } from './auth.tsx'

const theme = createTheme({
  palette: {
    primary: { main: '#147D85', dark: '#0E6269', contrastText: '#fff' },
    background: { default: '#F7F8FA', paper: '#fff' },
    text: { primary: '#172033', secondary: '#596579' },
    divider: '#E4E7EC',
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h5: { fontWeight: 700, letterSpacing: '-0.03em' },
    h6: { fontWeight: 700, letterSpacing: '-0.02em' },
    button: { fontWeight: 650, textTransform: 'none' },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 10 } } },
    MuiCard: { styleOverrides: { root: { borderColor: '#E4E7EC', boxShadow: '0 4px 20px rgba(23, 32, 51, 0.035)' } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: '#fff' } } },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
