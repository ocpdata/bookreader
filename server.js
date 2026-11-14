const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_FILE = path.join(DATA_DIR, 'summaries.json');
const ALLOWED_EXT = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.aac', '.flac']);

fs.mkdirSync(AUDIO_DIR, { recursive: true });

const readDb = () =>
  fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : [];
const writeDb = (items) => fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2));

const upload = multer({
  storage: multer.diskStorage({
    destination: AUDIO_DIR,
    filename: (_req, file, cb) =>
      cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  fileFilter: (_req, file, cb) =>
    cb(null, ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())),
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/audio', express.static(AUDIO_DIR)); // soporta Range para adelantar/retroceder

app.get('/api/summaries', (_req, res) => res.json(readDb()));

app.post('/api/summaries', upload.single('audio'), (req, res) => {
  const { title, author, notes } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Archivo de audio inválido' });
  if (!title || !title.trim()) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'El título es obligatorio' });
  }
  const item = {
    id: crypto.randomUUID(),
    title: title.trim(),
    author: (author || '').trim(),
    notes: (notes || '').trim(),
    file: req.file.filename,
    createdAt: new Date().toISOString(),
  };
  writeDb([item, ...readDb()]);
  res.status(201).json(item);
});

app.delete('/api/summaries/:id', (req, res) => {
  const items = readDb();
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  fs.rmSync(path.join(AUDIO_DIR, item.file), { force: true });
  writeDb(items.filter((i) => i.id !== item.id));
  res.status(204).end();
});

app.listen(PORT, () => console.log(`BookReader en http://localhost:${PORT}`));
