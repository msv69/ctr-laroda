const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PATH RISOLUZIONE ─────────────────────────────────────────────────
// Railway monta i volumi in percorsi variabili — usa sempre path assoluti
const DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));

const DB_PATH = process.env.DB_PATH
  || path.join(DATA_DIR, 'ctr.db');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  || path.join(DATA_DIR, 'uploads');

// Crea cartelle se non esistono
[DATA_DIR, UPLOAD_DIR, path.join(UPLOAD_DIR, 'foto'), path.join(UPLOAD_DIR, 'video')]
  .forEach(d => { try { fs.mkdirSync(d, { recursive: true }); } catch(e) {} });

console.log('DB_PATH:', DB_PATH);
console.log('UPLOAD_DIR:', UPLOAD_DIR);

// ── DATABASE ─────────────────────────────────────────────────────────
let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log('SQLite connesso:', DB_PATH);
} catch(e) {
  console.error('ERRORE DB:', e.message);
  process.exit(1);
}

// ── SCHEMA ───────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS soci (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL,
  cognome   TEXT NOT NULL,
  tessera   TEXT UNIQUE,
  email     TEXT,
  tel       TEXT,
  nascita   TEXT,
  cf        TEXT,
  indirizzo TEXT,
  citta     TEXT,
  cap       TEXT,
  ruolo     TEXT DEFAULT 'Socio',
  stato     TEXT DEFAULT 'Nuovo',
  quota     INTEGER DEFAULT 0,
  iscritto  TEXT DEFAULT (date('now')),
  note      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quota2026 (
  socio_id  INTEGER PRIMARY KEY REFERENCES soci(id) ON DELETE CASCADE,
  importo   REAL,
  data_pag  TEXT,
  metodo    TEXT,
  note      TEXT,
  pagato    INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS diano2026 (
  socio_id  INTEGER PRIMARY KEY REFERENCES soci(id) ON DELETE CASCADE,
  acconto   REAL DEFAULT 0,
  saldo     REAL DEFAULT 0,
  data_iscr TEXT,
  metodo    TEXT,
  camera    TEXT,
  note      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gallery_foto (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  titolo     TEXT NOT NULL,
  mime_type  TEXT,
  file_path  TEXT,
  data_ins   TEXT DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gallery_video (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  titolo     TEXT NOT NULL,
  mime_type  TEXT,
  file_path  TEXT,
  durata     TEXT,
  data_ins   TEXT DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_note (
  id    INTEGER PRIMARY KEY DEFAULT 1,
  testo TEXT DEFAULT ''
);
`);

// Seed admin note
if (!db.prepare('SELECT id FROM admin_note WHERE id=1').get()) {
  db.prepare("INSERT INTO admin_note(id,testo) VALUES(1,?)").run(
    '- Rinnovare polizza assicurativa entro settembre\n- Contattare comune per uscita 21 settembre\n- Raccogliere quote da: Ferretti, Bassi, Romano, Conti'
  );
}

// Seed soci
if (db.prepare('SELECT COUNT(*) as n FROM soci').get().n === 0) {
  const ins = db.prepare(`INSERT INTO soci
    (nome,cognome,tessera,email,tel,nascita,cf,indirizzo,citta,cap,ruolo,stato,quota,iscritto)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  [
    ['Marco','Bernardi','CTR-001','m.bernardi@mail.it','+39 333 1234567','1975-06-12','BRNMRC75H12L682Z','Via Cairoli 4','Varese','21100','Presidente','Attivo',1,'2010-03-15'],
    ['Laura','Cattaneo','CTR-002','l.cattaneo@mail.it','+39 347 2345678','1980-03-22','CTTLRA80C62L682X','Via Manzoni 18','Varese','21100','Segretaria','Attivo',1,'2012-05-20'],
    ['Giovanni','Ferretti','CTR-007','g.ferretti@mail.it','+39 320 3456789','1968-11-05','FRRGNN68S05L682Y','Via Garibaldi 33','Gallarate','21013','Socio','Attivo',0,'2015-09-10'],
    ['Chiara','Manzoni','CTR-011','c.manzoni@mail.it','+39 340 4567890','1990-07-18','MNZCHR90L58L682W','Piazza Podesta 2','Varese','21100','Socio','Attivo',1,'2018-03-22'],
    ['Roberto','Bassi','CTR-014','r.bassi@mail.it','+39 388 5678901','1972-04-30','BSSRRT72D30L682V','Via Volta 7','Busto Arsizio','21052','Socio','Sospeso',0,'2019-01-08'],
    ['Silvia','Fumagalli','CTR-016','s.fumagalli@mail.it','+39 335 6789012','1985-09-14','FMGSLV85P54L682U','Via Como 45','Varese','21100','Socio','Attivo',1,'2020-06-14'],
    ['Andrea','Romano','CTR-019','a.romano@mail.it','+39 342 7890123','1993-02-28','RMNNDR93B28L682T','Via Marconi 12','Saronno','21047','Socio','Attivo',0,'2021-03-30'],
    ['Elena','Conti','CTR-022','e.conti@mail.it','+39 366 8901234','1997-12-01','CNTLNE97T41L682S','Viale Aguggiari 88','Varese','21100','Socio','Nuovo',0,'2022-04-01'],
    ['Luca','Brambilla','CTR-024','l.brambilla@mail.it','+39 391 9012345','1982-08-16','BRMLCU82M16L682R','Via Magenta 5','Varese','21100','Tesoriere','Attivo',1,'2023-01-15'],
    ['Federica','Sala','CTR-026','f.sala@mail.it','+39 328 0123456','1995-05-09','SLAFRC95E49L682Q','Via Dandolo 3','Gallarate','21013','Socio','Nuovo',1,'2023-09-05'],
  ].forEach(r => ins.run(...r));
  console.log('Soci demo inseriti');
}

// ── MIDDLEWARE ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve uploads dinamicamente dal DATA_DIR
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ── UPLOAD ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type === 'video' ? 'video' : 'foto';
    const dest = path.join(UPLOAD_DIR, type);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ── HEALTH CHECK ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: DB_PATH, upload: UPLOAD_DIR });
});

// ── API SOCI ─────────────────────────────────────────────────────────
app.get('/api/soci', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM soci ORDER BY cognome').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/soci', (req, res) => {
  const b = req.body;
  try {
    const maxRow = db.prepare("SELECT tessera FROM soci WHERE tessera LIKE 'CTR-%' ORDER BY tessera DESC").get();
    const maxNum = maxRow ? parseInt(maxRow.tessera.replace('CTR-', '')) || 0 : 0;
    const tessera = 'CTR-' + String(maxNum + 1).padStart(3, '0');
    const r = db.prepare(`INSERT INTO soci
      (nome,cognome,tessera,email,tel,nascita,cf,indirizzo,citta,cap,ruolo,stato,quota,note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)`).run(
      b.nome, b.cognome, tessera,
      b.email||'', b.tel||'', b.nascita||null, b.cf||'',
      b.indirizzo||'', b.citta||'', b.cap||'',
      b.ruolo||'Socio', b.stato||'Nuovo', b.note||''
    );
    res.json(db.prepare('SELECT * FROM soci WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/soci/:id', (req, res) => {
  const b = req.body;
  try {
    db.prepare(`UPDATE soci SET
      nome=?,cognome=?,email=?,tel=?,nascita=?,cf=?,
      indirizzo=?,citta=?,cap=?,ruolo=?,stato=?,note=?
      WHERE id=?`).run(
      b.nome, b.cognome, b.email||'', b.tel||'',
      b.nascita||null, b.cf||'', b.indirizzo||'', b.citta||'', b.cap||'',
      b.ruolo||'Socio', b.stato||'Attivo', b.note||'', req.params.id
    );
    res.json(db.prepare('SELECT * FROM soci WHERE id=?').get(req.params.id));
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/soci/:id/quota', (req, res) => {
  try {
    db.prepare('UPDATE soci SET quota=? WHERE id=?').run(req.body.quota ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/soci/:id/stato', (req, res) => {
  try {
    db.prepare('UPDATE soci SET stato=? WHERE id=?').run(req.body.stato, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/soci/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM soci WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── API QUOTA 2026 ───────────────────────────────────────────────────
app.get('/api/quota2026', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM quota2026').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/quota2026', (req, res) => {
  const b = req.body;
  try {
    db.prepare(`INSERT INTO quota2026(socio_id,importo,data_pag,metodo,note,pagato)
      VALUES(?,?,?,?,?,1)
      ON CONFLICT(socio_id) DO UPDATE SET
      importo=excluded.importo, data_pag=excluded.data_pag,
      metodo=excluded.metodo, note=excluded.note, pagato=1`).run(
      b.socio_id, b.importo, b.data_pag, b.metodo, b.note||''
    );
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/quota2026/:socio_id', (req, res) => {
  try {
    db.prepare('DELETE FROM quota2026 WHERE socio_id=?').run(req.params.socio_id);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── API DIANO 2026 ───────────────────────────────────────────────────
app.get('/api/diano2026', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM diano2026').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/diano2026', (req, res) => {
  const b = req.body;
  try {
    db.prepare(`INSERT INTO diano2026(socio_id,acconto,saldo,data_iscr,metodo,camera,note)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(socio_id) DO UPDATE SET
      acconto=excluded.acconto, saldo=excluded.saldo,
      data_iscr=excluded.data_iscr, metodo=excluded.metodo,
      camera=excluded.camera, note=excluded.note`).run(
      b.socio_id, b.acconto||0, b.saldo||0,
      b.data_iscr, b.metodo, b.camera||'', b.note||''
    );
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/diano2026/:socio_id', (req, res) => {
  try {
    db.prepare('DELETE FROM diano2026 WHERE socio_id=?').run(req.params.socio_id);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── API GALLERY ──────────────────────────────────────────────────────
app.get('/api/gallery/:type', (req, res) => {
  const table = req.params.type === 'video' ? 'gallery_video' : 'gallery_foto';
  try { res.json(db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC`).all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/gallery/:type', upload.single('file'), (req, res) => {
  const type = req.params.type === 'video' ? 'video' : 'foto';
  const table = type === 'foto' ? 'gallery_foto' : 'gallery_video';
  const titolo = req.body.titolo || req.file.originalname;
  const file_path = '/uploads/' + type + '/' + req.file.filename;
  try {
    if (type === 'foto') {
      const r = db.prepare('INSERT INTO gallery_foto(titolo,mime_type,file_path) VALUES(?,?,?)').run(titolo, req.file.mimetype, file_path);
      res.json(db.prepare('SELECT * FROM gallery_foto WHERE id=?').get(r.lastInsertRowid));
    } else {
      const r = db.prepare('INSERT INTO gallery_video(titolo,mime_type,file_path,durata) VALUES(?,?,?,?)').run(titolo, req.file.mimetype, file_path, req.body.durata||'—');
      res.json(db.prepare('SELECT * FROM gallery_video WHERE id=?').get(r.lastInsertRowid));
    }
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/gallery/:type/:id', (req, res) => {
  const table = req.params.type === 'video' ? 'gallery_video' : 'gallery_foto';
  try {
    const row = db.prepare(`SELECT file_path FROM ${table} WHERE id=?`).get(req.params.id);
    if (row?.file_path) {
      const full = path.join(UPLOAD_DIR, row.file_path.replace('/uploads/', ''));
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── API NOTE ADMIN ───────────────────────────────────────────────────
app.get('/api/admin/note', (req, res) => {
  try {
    const row = db.prepare('SELECT testo FROM admin_note WHERE id=1').get();
    res.json({ testo: row?.testo || '' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/note', (req, res) => {
  try {
    db.prepare('INSERT INTO admin_note(id,testo) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET testo=excluded.testo').run(req.body.testo||'');
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── SPA FALLBACK ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`CTR La Röda → http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
