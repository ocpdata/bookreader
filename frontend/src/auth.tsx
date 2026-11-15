import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMe, login as apiLogin, logout as apiLogout, onUnauthorized, type CurrentUser } from './api'

interface AuthState {
  /** undefined mientras se comprueba la sesión; null si no hay sesión. */
  user: CurrentUser | null | undefined
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined)

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  // Cualquier 401 posterior (sesión caducada o cerrada en otro sitio) devuelve al acceso.
  useEffect(() => {
    onUnauthorized(() => setUser((current) => (current ? null : current)))
    return () => onUnauthorized(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setUser(await apiLogin(email, password))
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
