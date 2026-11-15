const MAX_SIDE = 800
// El servidor (y Nginx) aceptan hasta 1 MB; se reduce aquí para no subir fotos de varios MB.
const MAX_BYTES = 900_000

/** Reduce una imagen JPEG, PNG o WebP a un JPEG de hasta 800 px por lado, listo para subir. */
export async function prepareCover(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('La portada debe ser una imagen JPEG, PNG o WebP')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se pudo leer la imagen')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo procesar la imagen')
  // Fondo blanco: los PNG con transparencia no deben quedar negros al pasar a JPEG.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= MAX_BYTES) return blob
  }
  throw new Error('La imagen sigue siendo demasiado grande; usa una más pequeña')
}
