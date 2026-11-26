export const cookieOptions = () => ({
  httpOnly: true,
  // En producción (HTTPS) la cookie solo viaja cifrada; en desarrollo local (http) no puede ser Secure.
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
});
