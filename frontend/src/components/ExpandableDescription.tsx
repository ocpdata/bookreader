import { useEffect, useId, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

interface Props {
  description: string
  title: string
}

export default function ExpandableDescription({ description, title }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  const textId = useId()

  useEffect(() => {
    const text = textRef.current
    if (!text || expanded) return

    let active = true
    const measure = () => {
      if (active) setTruncated(text.scrollHeight > text.clientHeight)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(text)
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    measure()

    return () => {
      active = false
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [description, expanded])

  return (
    <>
      <Typography
        ref={textRef}
        id={textId}
        variant="body2"
        color="text.secondary"
        sx={{
          mt: 1,
          whiteSpace: 'pre-line',
          overflowWrap: 'anywhere',
          ...(!expanded && { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
        }}
      >
        {description}
      </Typography>
      {(truncated || expanded) && (
        <Button
          size="small"
          aria-expanded={expanded}
          aria-controls={textId}
          aria-label={`${expanded ? 'Ver menos' : 'Ver más'} de la descripción de ${title}`}
          onClick={() => setExpanded((value) => !value)}
          sx={{ px: 0, minWidth: 0 }}
        >
          {expanded ? 'Ver menos' : 'Ver más'}
        </Button>
      )}
    </>
  )
}
