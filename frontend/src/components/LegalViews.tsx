import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'

// Cambiar el correo de contacto aquí; es el canal para ejercer derechos sobre los datos y para reclamaciones.
const CONTACT = 'ocarrillo@accessq.com.mx'

function Section({ title, children }: { title: string; children: string }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>
      <Typography sx={{ whiteSpace: 'pre-line' }}>{children}</Typography>
    </Box>
  )
}

const DRAFT = 'Borrador pendiente de revisión legal. El texto definitivo puede cambiar; si cambia de forma relevante se te pedirá aceptarlo de nuevo.'

export function TermsView() {
  return (
    <Container maxWidth="sm" sx={{ py: 2 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Términos de uso
      </Typography>
      <Alert severity="warning" sx={{ mb: 3 }}>
        {DRAFT}
      </Alert>
      <Section title="Qué es BookBrief">
        {'BookBrief es un servicio para guardar tus propios audios de resúmenes de libros y escucharlos desde la web o desde aplicaciones compatibles con Audiobookshelf. Tu biblioteca es privada: solo tú la ves.'}
      </Section>
      <Section title="Tu cuenta">
        {'Debes dar un correo propio y mantener segura tu contraseña. Eres responsable de lo que ocurra en tu cuenta. Puedes eliminarla en cualquier momento desde tu cuenta, o pidiéndolo a ' + CONTACT + '.'}
      </Section>
      <Section title="Tu contenido">
        {'Solo debes subir audios que tengas derecho a guardar y reproducir (propios, con licencia o con permiso de su titular). No subas contenido ilegal ni que infrinja derechos de terceros. Tú conservas todos los derechos sobre tu contenido; nos das permiso únicamente para almacenarlo y reproducírtelo a ti.'}
      </Section>
      <Section title="Retiro de contenido">
        {'Si eres titular de derechos y crees que un contenido los infringe, escribe a ' + CONTACT + ' indicando qué contenido es, que eres el titular o su representante y cómo contactarte. Retiraremos el contenido que infrinja y podremos suspender las cuentas reincidentes.'}
      </Section>
      <Section title="Límites de uso">
        {'Cada cuenta tiene un espacio de almacenamiento limitado y un tamaño máximo por archivo (200 MB, MP3 o M4A). Podemos limitar o suspender cuentas que abusen del servicio, intenten vulnerarlo o lo usen para distribuir contenido a terceros.'}
      </Section>
      <Section title="Disponibilidad y responsabilidad">
        {'Hacemos copias de seguridad y cuidamos tus datos, pero el servicio se ofrece tal cual, sin garantía de disponibilidad continua. Conserva copia de tus archivos originales.'}
      </Section>
      <Section title="Cambios">
        {'Podemos actualizar estos términos. Los cambios relevantes se avisarán y se te pedirá aceptarlos de nuevo.'}
      </Section>
    </Container>
  )
}

export function PrivacyView() {
  return (
    <Container maxWidth="sm" sx={{ py: 2 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Aviso de privacidad
      </Typography>
      <Alert severity="warning" sx={{ mb: 3 }}>
        {DRAFT}
      </Alert>
      <Section title="Responsable">
        {'El responsable del tratamiento de tus datos es el operador de BookBrief. Contacto: ' + CONTACT + '.'}
      </Section>
      <Section title="Qué datos guardamos">
        {'• Cuenta: nombre, correo y contraseña (solo en forma cifrada irreversible).\n• Tu contenido: los audios que subes, su título, autor, etiquetas, carpetas, portadas, marcadores, progreso e historial de tiempo de escucha.\n• Seguridad: fechas de acceso, aplicaciones vinculadas y, en los registros del servidor, direcciones IP, durante un tiempo limitado.'}
      </Section>
      <Section title="Para qué los usamos">
        {'Para darte el servicio (iniciar sesión, guardar y reproducir tu biblioteca), mostrar estadísticas personales y administrativas de uso, enviarte correos necesarios (verificación y recuperación de contraseña) y proteger la cuenta y el servicio frente a abusos. Los administradores pueden consultar tus estadísticas y los títulos escuchados. No vendemos tus datos ni los usamos para publicidad.'}
      </Section>
      <Section title="Con quién se comparten">
        {'Usamos Amazon Web Services para alojar el servicio, guardar tus archivos y enviar correos. Si eliges buscar información en Open Library, tu navegador enviará el título y autor indicados y tu dirección IP a ese servicio. Si eliges importar desde Google Drive, Google interviene en la autorización y selección, y BookBrief lee los archivos seleccionados para copiarlos a AWS. El acceso de Google es temporal y no guardamos sus tokens. Puedes revocar el permiso desde tu cuenta de Google. No compartimos tus datos con otros terceros, salvo por obligación legal.'}
      </Section>
      <Section title="Cookies">
        {'Solo usamos una cookie de sesión necesaria para mantenerte conectado. No usamos cookies de seguimiento ni publicidad.'}
      </Section>
      <Section title="Tus derechos">
        {'Puedes acceder, rectificar, cancelar u oponerte al tratamiento de tus datos. Puedes eliminar tu cuenta y todo tu contenido desde tu cuenta, o pedirlo a ' + CONTACT + '.'}
      </Section>
      <Section title="Conservación">
        {'Conservamos tus datos y tu historial de escucha mientras tengas la cuenta. Al eliminar definitivamente un audio se elimina también su historial. Lo que borras pasa a la papelera 30 días y después se elimina definitivamente (las copias de seguridad técnicas pueden tardar hasta 14 días más en desaparecer).'}
      </Section>
    </Container>
  )
}
