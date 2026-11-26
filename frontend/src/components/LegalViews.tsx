import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'

// Cambiar el correo de contacto aquí; es el canal para ejercer derechos sobre los datos y para reclamaciones.
const CONTACT = 'soporte@digitalvs.com'

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

export function TermsView() {
  return (
    <Container maxWidth="sm" sx={{ py: 2 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Términos de uso
      </Typography>
      <Section title="Qué es BookBrief">
        {'BookBrief es un servicio para guardar tus propios audios de resúmenes de libros y escucharlos desde la web o desde aplicaciones compatibles con Audiobookshelf. Tu biblioteca es privada salvo el contenido que decidas compartir con otros usuarios.'}
      </Section>
      <Section title="Tu cuenta">
        {'Debes dar un correo propio y mantener segura tu contraseña. Eres responsable de lo que ocurra en tu cuenta. Puedes eliminarla en cualquier momento desde tu cuenta, o pidiéndolo a ' + CONTACT + '.'}
      </Section>
      <Section title="Tu contenido">
        {'Solo debes subir audios que tengas derecho a guardar y reproducir, y compartir únicamente los que tengas derecho a compartir (propios, con licencia o con permiso de su titular). No subas contenido ilegal ni que infrinja derechos de terceros. Tú conservas los derechos sobre tu contenido y nos das permiso para almacenarlo y reproducirlo para ti y para las personas que autorices.'}
      </Section>
      <Section title="Retiro de contenido">
        {'Si eres titular de derechos y crees que un contenido los infringe, escribe a ' + CONTACT + ' indicando qué contenido es, que eres el titular o su representante y cómo contactarte. Retiraremos el contenido que infrinja y podremos suspender las cuentas reincidentes.'}
      </Section>
      <Section title="Límites de uso">
        {'Cada cuenta tiene un espacio de almacenamiento limitado y un tamaño máximo por archivo (200 MB, MP3 o M4A). Podemos limitar o suspender cuentas que abusen del servicio, intenten vulnerarlo o distribuyan contenido sin autorización.'}
      </Section>
      <Section title="Contenido compartido">
        {'Puedes invitar a otras personas a escuchar toda tu biblioteca o audios seleccionados. Necesitan una cuenta verificada y deben aceptar la invitación. Puedes revocar su acceso, pero no podemos retirar copias que hayan guardado ni garantizar que una transferencia ya iniciada se interrumpa inmediatamente. Los audios compartidos están disponibles en la web, no en las aplicaciones compatibles con Audiobookshelf.'}
      </Section>
      <Section title="Prueba gratuita y planes">
        {'Puedes elegir una prueba gratuita de 30 días con 2 GB y 25 audios, una por persona (por dirección de correo; borrar la cuenta y crearla de nuevo no la reinicia), o contratar Premium directamente después de verificar tu correo. La contratación directa no activa la prueba: Premium se habilita al completar el pago en Stripe.\n\nEl plan Premium cuesta MX$69 al mes o MX$690 al año (equivale a 10 meses) e incluye 10 GB y 500 audios. Los precios están en pesos mexicanos e incluyen los impuestos aplicables; si pagas desde otro país, tu banco convierte el cargo a tu moneda y puede aplicar su propia comisión.'}
      </Section>
      <Section title="Pagos, renovación y cancelación">
        {'Los pagos los procesa Stripe; nosotros no vemos ni guardamos los datos de tu tarjeta. La suscripción se renueva automáticamente (cada mes o cada año, según tu plan) hasta que la canceles.\n\nPuedes cancelar en cualquier momento desde tu cuenta («Gestionar suscripción»): se detiene la renovación y conservas el acceso hasta el final del período ya pagado. El pago mensual no es reembolsable. El pago anual es reembolsable por completo si lo pides dentro de los 7 días siguientes al cobro, escribiendo a ' + CONTACT + '.\n\nPodemos cambiar los precios; cualquier cambio se avisará con al menos 30 días y aplicará a partir de tu siguiente renovación.'}
      </Section>
      <Section title="Si tu plan o tu prueba terminan">
        {'No borramos tu contenido. Podrás seguir entrando, escuchando tus audios y los que otros compartan contigo, y descargando y eliminando tus propios audios, pero no subir nuevos hasta que te suscribas o renueves.'}
      </Section>
      <Section title="Disponibilidad">
        {'Hacemos copias de seguridad y cuidamos tus datos, pero el servicio se ofrece «tal cual» y «según disponibilidad», sin garantía de funcionamiento continuo ni libre de errores. Podemos interrumpirlo temporalmente por mantenimiento o por causas ajenas a nosotros. Conserva siempre copia de tus archivos originales.'}
      </Section>
      <Section title="Limitación de responsabilidad">
        {'En la medida en que la ley lo permita, no somos responsables de la pérdida o alteración de archivos o datos, de las interrupciones del servicio, del contenido que subas tú u otras personas, ni de daños indirectos o consecuentes (como la pérdida de ingresos o de oportunidades).\n\nNuestra responsabilidad total frente a ti por cualquier reclamación relacionada con el servicio se limita al importe que hayas pagado por él en los 12 meses anteriores al hecho que la originó. Si solo usas la prueba gratuita, no hay importe que reclamar.\n\nNada de lo anterior limita la responsabilidad que la ley no permita limitar ni los derechos que tengas como consumidor.'}
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
      <Section title="Responsable">
        {'El responsable del tratamiento de tus datos es el operador de BookBrief. Contacto: ' + CONTACT + '.'}
      </Section>
      <Section title="Qué datos guardamos">
        {'• Cuenta: nombre, correo y contraseña (solo en forma cifrada irreversible).\n• Tu contenido: los audios que subes, su título, autor, etiquetas, carpetas, portadas, marcadores, progreso e historial de tiempo de escucha.\n• Compartición: correos de destinatarios, invitaciones, permisos y contenido compartido.\n• Plan y pagos: tu plan, su vencimiento y un identificador de cliente de Stripe; nunca los datos de tu tarjeta, que solo ve Stripe.\n• Para que la prueba gratuita sea una por persona conservamos una huella irreversible (hash) del correo que ya la usó, incluso si borras la cuenta; no permite reconstruir tu dirección.\n• Seguridad: fechas de acceso, aplicaciones vinculadas y, en los registros del servidor, direcciones IP, durante un tiempo limitado.'}
      </Section>
      <Section title="Para qué los usamos">
        {'Para darte el servicio (iniciar sesión, guardar y reproducir tu biblioteca), mostrar estadísticas personales y administrativas de uso, enviarte correos necesarios (verificación y recuperación de contraseña) y proteger la cuenta y el servicio frente a abusos. Los administradores pueden consultar tus estadísticas y los títulos escuchados. No vendemos tus datos ni los usamos para publicidad.'}
      </Section>
      <Section title="Con quién se comparten">
        {'Si compartes contenido, los destinatarios autorizados pueden ver tu nombre y los metadatos y audios que compartes. También enviamos invitaciones al correo indicado. Usamos Amazon Web Services para alojar el servicio, guardar tus archivos y enviar correos. Los pagos los procesa Stripe: recibe tu correo y los datos de pago que tú le des en su página; nosotros solo recibimos la confirmación y un identificador de cliente. Si eliges buscar información en Open Library, tu navegador enviará el título y autor indicados y tu dirección IP a ese servicio. Si eliges importar desde Google Drive, Google interviene en la autorización y selección, y BookBrief lee los archivos seleccionados para copiarlos a AWS. El acceso de Google es temporal y no guardamos sus tokens. Puedes revocar el permiso desde tu cuenta de Google. No compartimos tus datos con otros terceros, salvo por obligación legal.'}
      </Section>
      <Section title="Cookies">
        {'Solo usamos una cookie de sesión necesaria para mantenerte conectado. No usamos cookies de seguimiento ni publicidad.'}
      </Section>
      <Section title="Tus derechos">
        {'Puedes acceder, rectificar, cancelar u oponerte al tratamiento de tus datos. Puedes eliminar tu cuenta y todo tu contenido desde tu cuenta, o pedirlo a ' + CONTACT + '.'}
      </Section>
      <Section title="Seguridad de tus datos">
        {'Protegemos tu información con medidas razonables: la contraseña se guarda cifrada de forma irreversible, tus archivos están en un almacenamiento privado y se reproducen con enlaces temporales, y la conexión al servicio va cifrada.\n\nAun así, ningún sistema es completamente seguro y no podemos garantizar que nunca ocurra un acceso no autorizado o una pérdida de datos. En la medida en que la ley lo permita, nuestra responsabilidad se rige por la limitación de los Términos de uso. Si ocurre una vulneración que afecte de forma significativa tus derechos, te lo informaremos por correo para que puedas tomar medidas.\n\nTú también cuidas tu cuenta: usa una contraseña propia y no la compartas.'}
      </Section>
      <Section title="Conservación">
        {'Conservamos tus datos y tu historial de escucha mientras tengas la cuenta. Al eliminar definitivamente un audio se elimina también su historial. Lo que borras pasa a la papelera 30 días y después se elimina definitivamente (las copias de seguridad técnicas pueden tardar hasta 14 días más en desaparecer). Al eliminar la cuenta solo se conservan la huella del correo que ya usó su prueba gratuita y los registros de facturación que Stripe debe guardar por obligación legal.'}
      </Section>
    </Container>
  )
}
