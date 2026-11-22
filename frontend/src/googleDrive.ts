const scope = 'https://www.googleapis.com/auth/drive.file'
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
const apiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY
const appId = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER

export const driveConfigured = Boolean(clientId && apiKey && appId)

interface TokenResponse {
  access_token?: string
  error?: string
  scope?: string
}

interface PickerDocument {
  id: string
  resourceKey?: string
}

interface PickerResponse {
  action: string
  docs?: PickerDocument[]
}

interface PickerBuilder {
  addView(view: string): PickerBuilder
  enableFeature(feature: string): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setOrigin(origin: string): PickerBuilder
  setCallback(callback: (response: PickerResponse) => void): PickerBuilder
  build(): { setVisible(visible: boolean): void; dispose(): void }
}

interface GoogleApi {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string
        scope: string
        callback: (response: TokenResponse) => void
        error_callback: () => void
      }): { requestAccessToken(config: { prompt: string }): void }
      hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean
      revoke(token: string, callback: (response: { successful?: boolean; error?: string }) => void): void
    }
  }
  picker: {
    PickerBuilder: new () => PickerBuilder
    ViewId: { DOCS: string }
    Feature: { MULTISELECT_ENABLED: string }
  }
}

declare global {
  interface Window {
    google?: GoogleApi
    gapi?: { load(name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void }
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => {
      script.remove()
      reject(new Error('Los servicios de Google tardaron demasiado en responder.'))
    }, 15_000)
    script.src = src
    script.async = true
    script.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    script.onerror = () => {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('No se pudieron cargar los servicios de Google. Comprueba tu conexión.'))
    }
    document.head.appendChild(script)
  })
}

let ready: Promise<void> | undefined

export function prepareDrive() {
  if (!driveConfigured) return Promise.reject(new Error('Google Drive no está configurado en este servidor.'))
  if (!ready) {
    ready = Promise.all([
      window.gapi ? Promise.resolve() : loadScript('https://apis.google.com/js/api.js'),
      window.google?.accounts ? Promise.resolve() : loadScript('https://accounts.google.com/gsi/client'),
    ]).then(() => new Promise<void>((resolve, reject) => {
      if (!window.gapi || !window.google?.accounts) return reject(new Error('No se pudieron iniciar los servicios de Google.'))
      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('No se pudo iniciar el selector de Google Drive.')),
        timeout: 15_000,
        ontimeout: () => reject(new Error('El selector de Google Drive tardó demasiado en responder.')),
      })
    })).catch((error: unknown) => {
      ready = undefined
      throw error
    })
  }
  return ready
}

export function selectDriveFiles(): Promise<{ token: string; files: PickerDocument[] }> {
  const google = window.google
  if (!google?.accounts || !google.picker) return Promise.reject(new Error('Google Drive no está preparado.'))
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      error_callback: () => reject(new Error('Se cerró o bloqueó la autorización de Google.')),
      callback: (response) => {
        if (response.error || !response.access_token || !google.accounts.oauth2.hasGrantedAllScopes(response, scope)) {
          reject(new Error('No se autorizó el acceso a los archivos seleccionados de Google Drive.'))
          return
        }
        const token = response.access_token
        try {
          const picker = new google.picker.PickerBuilder()
            .addView(google.picker.ViewId.DOCS)
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .setOAuthToken(token)
            .setDeveloperKey(apiKey)
            .setAppId(appId)
            .setOrigin(window.location.origin)
            .setCallback((result) => {
              if (result.action === 'picked') {
                picker.dispose()
                resolve({ token, files: result.docs ?? [] })
              } else if (result.action === 'cancel') {
                picker.dispose()
                resolve({ token, files: [] })
              } else if (result.action === 'error') {
                picker.dispose()
                reject(new Error('El selector de Google Drive informó un error.'))
              }
            })
            .build()
          picker.setVisible(true)
        } catch {
          reject(new Error('No se pudo abrir el selector de Google Drive.'))
        }
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

export function revokeDrive(token: string): Promise<void> {
  const google = window.google
  if (!google?.accounts) return Promise.reject(new Error('No se pudo desconectar Google Drive.'))
  return new Promise((resolve, reject) => {
    google.accounts.oauth2.revoke(token, (response) => {
      if (response.successful) resolve()
      else reject(new Error('No se pudo revocar el acceso de Google Drive. Puedes hacerlo desde tu cuenta de Google.'))
    })
  })
}
