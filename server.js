const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PATHS ────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'ctr.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');

[DATA_DIR, UPLOAD_DIR, path.join(UPLOAD_DIR,'foto'), path.join(UPLOAD_DIR,'video')]
  .forEach(d => { try { fs.mkdirSync(d, {recursive:true}); } catch(e){} });

console.log('DB:', DB_PATH);

// ── DATABASE ─────────────────────────────────────────────────────────
let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch(e) { console.error('ERRORE DB:', e.message); process.exit(1); }

// ── SCHEMA ───────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS soci (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  cognome    TEXT NOT NULL,
  tessera    TEXT UNIQUE,
  email      TEXT,
  tel        TEXT,
  nascita    TEXT,
  cf         TEXT,
  indirizzo  TEXT,
  citta      TEXT,
  cap        TEXT,
  ruolo      TEXT DEFAULT 'Socio',
  stato      TEXT DEFAULT 'Attivo',
  note       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Quote sociali per anno (PRIMARY KEY composta: socio + anno)
CREATE TABLE IF NOT EXISTS quote (
  socio_id   INTEGER REFERENCES soci(id) ON DELETE CASCADE,
  anno       INTEGER NOT NULL,
  importo    REAL DEFAULT 0,
  data_pag   TEXT,
  metodo     TEXT,
  note       TEXT,
  pagato     INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (socio_id, anno)
);

-- Uscite per anno
CREATE TABLE IF NOT EXISTS uscite (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  anno        INTEGER NOT NULL,
  giorno      TEXT,
  mese        TEXT,
  data_uscita TEXT,
  titolo      TEXT NOT NULL,
  km          REAL DEFAULT 0,
  dislivello  INTEGER DEFAULT 0,
  difficolta  TEXT DEFAULT 'M',
  ora         TEXT DEFAULT '08:00',
  max_posti   INTEGER DEFAULT 30,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Iscrizioni uscite
CREATE TABLE IF NOT EXISTS iscrizioni_uscita (
  uscita_id  INTEGER REFERENCES uscite(id) ON DELETE CASCADE,
  socio_id   INTEGER REFERENCES soci(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (uscita_id, socio_id)
);

-- Spese per anno
CREATE TABLE IF NOT EXISTS spese (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  anno        INTEGER NOT NULL,
  data_spesa  TEXT,
  descrizione TEXT NOT NULL,
  categoria   TEXT DEFAULT 'Uscita',
  importo     REAL DEFAULT 0,
  incassato   REAL DEFAULT 0,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Trasferte per anno
CREATE TABLE IF NOT EXISTS trasferte (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  anno        INTEGER NOT NULL,
  nome        TEXT NOT NULL,
  data_inizio TEXT,
  data_fine   TEXT,
  luogo       TEXT,
  km          REAL DEFAULT 0,
  dislivello  INTEGER DEFAULT 0,
  quota       REAL DEFAULT 0,
  max_posti   INTEGER DEFAULT 20,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Iscrizioni trasferte
CREATE TABLE IF NOT EXISTS iscrizioni_trasferta (
  trasferta_id INTEGER REFERENCES trasferte(id) ON DELETE CASCADE,
  socio_id     INTEGER REFERENCES soci(id) ON DELETE CASCADE,
  acconto      REAL DEFAULT 0,
  saldo        REAL DEFAULT 0,
  data_iscr    TEXT,
  metodo       TEXT,
  camera       TEXT,
  note         TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (trasferta_id, socio_id)
);

-- Album gallery
CREATE TABLE IF NOT EXISTS album (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  anno        INTEGER NOT NULL,
  nome        TEXT NOT NULL,
  descrizione TEXT,
  copertina   TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Foto (legate a album)
CREATE TABLE IF NOT EXISTS gallery_foto (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id   INTEGER REFERENCES album(id) ON DELETE CASCADE,
  anno       INTEGER,
  titolo     TEXT NOT NULL,
  mime_type  TEXT,
  file_path  TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Video (legati a album)
CREATE TABLE IF NOT EXISTS gallery_video (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id   INTEGER REFERENCES album(id) ON DELETE CASCADE,
  anno       INTEGER,
  titolo     TEXT NOT NULL,
  mime_type  TEXT,
  file_path  TEXT,
  durata     TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- News
CREATE TABLE IF NOT EXISTS news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  titolo     TEXT NOT NULL,
  testo      TEXT,
  tag        TEXT DEFAULT 'Comunicazione',
  emoji      TEXT DEFAULT '📋',
  data_pub   TEXT DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Documenti
CREATE TABLE IF NOT EXISTS documenti (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  titolo      TEXT NOT NULL,
  descrizione TEXT,
  categoria   TEXT DEFAULT 'Generale',
  file_path   TEXT NOT NULL,
  mime_type   TEXT,
  size_kb     INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Note admin per anno
CREATE TABLE IF NOT EXISTS admin_note (
  anno  INTEGER PRIMARY KEY,
  testo TEXT DEFAULT ''
);
`);

// Migrate: aggiungi colonne se mancano in DB esistenti
['ALTER TABLE gallery_foto ADD COLUMN anno INTEGER',
 'ALTER TABLE gallery_foto ADD COLUMN album_id INTEGER',
 'ALTER TABLE gallery_video ADD COLUMN anno INTEGER',
 'ALTER TABLE gallery_video ADD COLUMN album_id INTEGER',
 'ALTER TABLE soci ADD COLUMN foto_profilo TEXT',
].forEach(sql => { try { db.exec(sql); } catch(e){} });

// Crea cartella profili
fs.mkdirSync(path.join(UPLOAD_DIR, 'profili'), {recursive:true});

// Seed news di default se tabella vuota
if (db.prepare('SELECT COUNT(*) as n FROM news').get().n === 0) {
  const insNews = db.prepare('INSERT INTO news(titolo,testo,tag,emoji,data_pub) VALUES(?,?,?,?,?)');
  [
    ['Benvenuti nel nuovo sito CTR La Röda!','Il nuovo portale del club è online. Trovi tutte le informazioni su uscite, soci e gallery.','Comunicazione','🎉','2026-01-01'],
    ['Rinnovo Tessere 2026','Il rinnovo tessere 2026 è aperto. Contattare la segreteria per la quota annuale.','Comunicazione','📋','2026-01-15'],
    ['Trasferta Diano Marina — 5 giorni in Liguria','Dal 13 al 17 maggio 2026 la grande trasferta a Diano Marina. Iscriviti tramite il pannello admin!','Evento','🌊','2026-02-01'],
  ].forEach(r => insNews.run(...r));
}

// ── SOCI 2026 ────────────────────────────────────────────────────────
const SOCI_2026 = [
  ['Stefano','Angelella','CTR-001','stefano.angelella@gmail.com','079 824 15 53','Residenza al Noce','Quartino','6572'],
  ['Hans-Rudolf','Bluntschli','CTR-002','hadu55@bluewin.ch','076 429 29 33','Via San Gottardo 59b','Bellinzona','6500'],
  ['Roberto','Borner','CTR-003','rborner@cce.ch','079 421 81 76','Via degli orti 2','Losone','6616'],
  ['Monica','Borner','CTR-004','mborner@cce.ch','078 624 05 30','Via degli orti 2','Losone','6616'],
  ['Marco','Bricola','CTR-005','briccm@bluewin.ch','076 505 84 45','','Pregassona','6963'],
  ['Otto','Bruseghini','CTR-006','8bruse51@gmail.com','079 821 10 50','Via Arbostra 20','Pregassona','6963'],
  ['Enrico','Burkhard','CTR-007','enrico.burkhard@bluewin.ch','078 621 10 01','Via Golino 18','Golino','6656'],
  ['Livio','Bui','CTR-008','livio.bui@bluewin.ch','079 413 83 21','Via D. Bacilieri 9c','Muralto','6600'],
  ['Vito','Buzzini','CTR-009','vito.buzzini@yahoo.it','078 705 43 79','','Losone','6616'],
  ['Massimo','Capponi','CTR-010','massimo.capponi@gmail.com','079 405 45 18','','Cugnasco','6516'],
  ['Paolo','Colombi','CTR-011','paolocolombi@bluewin.ch','079 423 67 24','Via Reslina 14','Losone','6616'],
  ['Raffaele','Covelli','CTR-012','r.covelli@gmail.com','079 409 91 92','Cadepezzo 18','Quartino','6572'],
  ['Moreno','Dal Mas','CTR-013','dalmas54@bluewin.ch','079 678 04 25','','',''],
  ['Leonardo','Di Mase','CTR-014','','078 785 75 21','','Quartino','6572'],
  ['Renzo','Dolfini','CTR-015','renzo.dolfini@sbb.ch','079 252 03 52','Via al Ramello 31','Contone','6594'],
  ['Mauro','Doniselli','CTR-016','','076 561 90 38','','Minusio','6648'],
  ['Peter','Filipek','CTR-017','feipeter@bluewin.ch','077 403 59 37','Via trisnera 35','Losone','6616'],
  ['Javier','Gallardo','CTR-018','javier.gallardo@bluewin.ch','079 949 71 45','Al Guast 35','Camorino','6528'],
  ['Paolo','Gazza','CTR-019','paolo.gazza@bluemail.ch','079 512 94 78','Via Sociale','Muralto','6600'],
  ['Gianni','Gilardi','CTR-020','giannigil@bluewin.ch','079 616 95 78','Via la Monda 67','Contone','6594'],
  ['Sandro','Ghisla','CTR-021','sandro.ghisla@uni-konstanz.de','079 5695649','','',''],
  ['Andreas','Haertel','CTR-022','a.rivega@gmx.ch','076 4406520','Via al Trodo 8','Quartino','6572'],
  ['Ivo','Imperatori','CTR-023','ivo.imperatori@sunrise.ch','079 223 31 47','Via Riarena 15','Cugnasco','6516'],
  ['Andreas','Jäggin','CTR-024','info@drjaeggin.ch','079 440 31 74','Via Vignole 16','Orselina','6644'],
  ['Stephan','Kempf','CTR-025','galerie.kempf@bluewin.ch','079 665 33 26','Via Collina 14','Riazzino','6595'],
  ['Claudio','Luppi','CTR-026','lupodeluppi@yahoo.com','079 250 27 08','Gaggini da Bissone 9','Lugano','6900'],
  ['Samuel','Lüscher','CTR-027','sa.luescher@bluewin.ch','079 223 91 11','Contrada Maggiore','Losone','6616'],
  ['Aurelio','Mokedo','CTR-028','Aurelio.mokedo@gmail.com','076 456 74 58','','',''],
  ['Moreno','Moioli','CTR-029','102905@bluewin.ch','079 620 97 17','Via Lanaccio 9','Cadro','6965'],
  ['Heinz','Nebel','CTR-030','heinz.nebel@bluewin.ch','079 239 09 62','Via Bustelli 14','Locarno','6600'],
  ['Tiziano','Orru','CTR-031','tizianoorru@bluewin.ch','079717 47 13','Via Lusciago 17 A','Losone','6616'],
  ['Massimo','Pacciorini','CTR-032','galerie.kempf@bluewin.ch','079 621 37 38','Via Collina 14','Riazzino','6595'],
  ['Gianni','Pasinelli','CTR-033','serares@bluewin.ch','079 621 24 52','Via Mezzana 15','Losone','6616'],
  ['Franco','Polito','CTR-034','serpent2000@hotmail.it','079 653 65 44','Via Loco 8','Pregassona','6963'],
  ['Francesco','Prados','CTR-035','francesco.prados@zurich.ch','078 623 85 27','Via Muraccio 5','Ascona','6612'],
  ['Sebastiano','Privitello','CTR-036','sebastianop@bluewin.ch','079 452 25 11','In Paes 74','Quartino','6572'],
  ['Luigi','Radaelli','CTR-037','galerie.kempf@bluewin.ch','078 625 04 12','Via Collina 14','Riazzino','6595'],
  ['Illija','Rasic','CTR-038','irasic@icloud.com','079 621 8624','','',''],
  ['Francesco','Riva','CTR-039','francesco.riva@sbb.ch','079 223 18 83','via Francesca 93','Gordola','6596'],
  ['Sebastiano','Robbiani','CTR-040','s-robbiani@hotmail.com','076 471 01 10','','',''],
  ['Milo','Sala Veni','CTR-041','milo.salaveni@gemarship.ch','076 363 48 51','Via Sentiero Trona 12','Ruvigliana','6977'],
  ['Giuseppe','Sangermano','CTR-042','gsange911@gmail.com','076 559 35 44','via Campagna 11','Bellinzona',''],
  ['Calogero','Santamaria','CTR-043','caloge57@gmail.com','393240567946','','',''],
  ['Marco','Sartori','CTR-044','marcobaiaf@bluewin.ch','076 679 79 49','','Muralto','6600'],
  ['Freddy','Schnoz','CTR-045','a.schnoz@autoag.ch','079 412 42 36','','',''],
  ['Martin','Schär','CTR-046','schaerm@yahoo.com','079 372 44 19','Via Federica Spitzer 14','Breganzona','6932'],
  ['Davis','Sciacca','CTR-047','','079 888 18 28','','Locarno',''],
  ['Luca','Silini','CTR-048','','079 429 64 18','','',''],
  ['Josef','Simmen','CTR-049','joe.simmen@bluewin.ch','078 926 42 46','Via delle Vigne 7','Tenero','6598'],
  ['Muslija','Sonic','CTR-050','mukisonic@gmail.com','076 369 18 96','Via Bastoria 5','Solduno','6600'],
  ['Franco','Vezzoli','CTR-051','franco.v@bluewin.ch','079 5124020','','Quartino',''],
  ['Flavio','Ulleri','CTR-052','','079 3006575','','',''],
  ['Richard','Vallejos','CTR-053','','079 1385218','','',''],
  ['Daniela','Mozzettini','CTR-054','','079 6288583','','',''],
  ['Giovanni','Cividini','CTR-055','','','','',''],
];

if (process.env.RESET_DB === 'true') {
  console.log('RESET_DB: svuoto tabelle...');
  ['iscrizioni_trasferta','iscrizioni_uscita','trasferte','uscite','spese','quote','soci']
    .forEach(t => db.prepare(`DELETE FROM ${t}`).run());
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('soci','uscite','spese','trasferte')").run();
}

if (db.prepare('SELECT COUNT(*) as n FROM soci').get().n === 0) {
  const ins = db.prepare(`INSERT INTO soci (nome,cognome,tessera,email,tel,indirizzo,citta,cap,ruolo,stato)
    VALUES (?,?,?,?,?,?,?,?,'Socio','Attivo')`);
  db.transaction(rows => rows.forEach(r => ins.run(...r)))(SOCI_2026.map(r => r.slice(0,8)));
  console.log(`Inseriti ${SOCI_2026.length} soci`);
}

// ── MIDDLEWARE ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req,file,cb) => {
      const d = path.join(UPLOAD_DIR, req.params.type==='video'?'video':'foto');
      fs.mkdirSync(d,{recursive:true}); cb(null,d);
    },
    filename: (req,file,cb) => cb(null, Date.now()+path.extname(file.originalname))
  }),
  limits: {fileSize: 100*1024*1024}
});

// ── HEALTH ───────────────────────────────────────────────────────────
app.get('/api/health', (req,res) => res.json({ok:true, db:DB_PATH}));

// ── ANNI disponibili ─────────────────────────────────────────────────
app.get('/api/anni', (req,res) => {
  try {
    const anni = new Set();
    ['quote','uscite','spese','trasferte','gallery_foto','gallery_video'].forEach(t => {
      try { db.prepare(`SELECT DISTINCT anno FROM ${t} WHERE anno IS NOT NULL`).all().forEach(r=>anni.add(r.anno)); } catch(e){}
    });
    const current = new Date().getFullYear();
    anni.add(current);
    res.json([...anni].sort((a,b)=>b-a));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── SOCI ─────────────────────────────────────────────────────────────
app.get('/api/soci', (req,res) => {
  try { res.json(db.prepare('SELECT * FROM soci ORDER BY cognome').all()); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/soci', (req,res) => {
  const b = req.body;
  try {
    const maxRow = db.prepare("SELECT tessera FROM soci WHERE tessera LIKE 'CTR-%' ORDER BY tessera DESC").get();
    const maxNum = maxRow ? parseInt(maxRow.tessera.replace('CTR-',''))||0 : 0;
    const tessera = 'CTR-'+String(maxNum+1).padStart(3,'0');
    const r = db.prepare(`INSERT INTO soci (nome,cognome,tessera,email,tel,nascita,cf,indirizzo,citta,cap,ruolo,stato,note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.nome,b.cognome,tessera,b.email||'',b.tel||'',b.nascita||null,b.cf||'',
      b.indirizzo||'',b.citta||'',b.cap||'',b.ruolo||'Socio',b.stato||'Attivo',b.note||''
    );
    res.json(db.prepare('SELECT * FROM soci WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/soci/:id', (req,res) => {
  const b = req.body;
  try {
    db.prepare(`UPDATE soci SET nome=?,cognome=?,email=?,tel=?,nascita=?,cf=?,indirizzo=?,citta=?,cap=?,ruolo=?,stato=?,note=? WHERE id=?`).run(
      b.nome,b.cognome,b.email||'',b.tel||'',b.nascita||null,b.cf||'',
      b.indirizzo||'',b.citta||'',b.cap||'',b.ruolo||'Socio',b.stato||'Attivo',b.note||'',req.params.id
    );
    res.json(db.prepare('SELECT * FROM soci WHERE id=?').get(req.params.id));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/soci/:id/stato', (req,res) => {
  try { db.prepare('UPDATE soci SET stato=? WHERE id=?').run(req.body.stato,req.params.id); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/soci/:id', (req,res) => {
  try { db.prepare('DELETE FROM soci WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

// ── QUOTE ────────────────────────────────────────────────────────────
app.get('/api/quote/:anno', (req,res) => {
  try { res.json(db.prepare('SELECT * FROM quote WHERE anno=?').all(req.params.anno)); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/quote', (req,res) => {
  const b = req.body;
  try {
    db.prepare(`INSERT INTO quote(socio_id,anno,importo,data_pag,metodo,note,pagato) VALUES(?,?,?,?,?,?,1)
      ON CONFLICT(socio_id,anno) DO UPDATE SET importo=excluded.importo,data_pag=excluded.data_pag,
      metodo=excluded.metodo,note=excluded.note,pagato=1`).run(b.socio_id,b.anno,b.importo,b.data_pag,b.metodo,b.note||'');
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/quote/:anno/:socio_id', (req,res) => {
  try { db.prepare('DELETE FROM quote WHERE anno=? AND socio_id=?').run(req.params.anno,req.params.socio_id); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

// ── USCITE ───────────────────────────────────────────────────────────
app.get('/api/uscite/:anno', (req,res) => {
  try {
    const uscite = db.prepare('SELECT * FROM uscite WHERE anno=? ORDER BY data_uscita').all(req.params.anno);
    uscite.forEach(u => {
      u.iscritti = db.prepare('SELECT COUNT(*) as n FROM iscrizioni_uscita WHERE uscita_id=?').get(u.id).n;
    });
    res.json(uscite);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/uscite', (req,res) => {
  const b = req.body;
  try {
    const r = db.prepare(`INSERT INTO uscite(anno,giorno,mese,data_uscita,titolo,km,dislivello,difficolta,ora,max_posti,note)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(b.anno,b.giorno||'',b.mese||'',b.data_uscita||null,b.titolo,
      b.km||0,b.dislivello||0,b.difficolta||'M',b.ora||'08:00',b.max_posti||30,b.note||'');
    res.json(db.prepare('SELECT * FROM uscite WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/uscite/:id', (req,res) => {
  const b = req.body;
  try {
    db.prepare(`UPDATE uscite SET titolo=?,data_uscita=?,giorno=?,mese=?,km=?,dislivello=?,difficolta=?,ora=?,max_posti=?,note=? WHERE id=?`).run(
      b.titolo,b.data_uscita||null,b.giorno||'',b.mese||'',b.km||0,b.dislivello||0,
      b.difficolta||'M',b.ora||'08:00',b.max_posti||30,b.note||'',req.params.id
    );
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/uscite/:id', (req,res) => {
  try { db.prepare('DELETE FROM uscite WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

// ── ISCRIZIONI USCITE ────────────────────────────────────────────────
app.get('/api/uscite/:id/iscrizioni', (req,res) => {
  try {
    const rows = db.prepare(`
      SELECT s.id, s.nome, s.cognome, s.tessera, s.tel, s.email, s.foto_profilo,
             i.created_at as data_iscr
      FROM iscrizioni_uscita i
      JOIN soci s ON s.id = i.socio_id
      WHERE i.uscita_id = ?
      ORDER BY s.cognome`).all(req.params.id);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/uscite/:id/iscrizioni', (req,res) => {
  const { socio_id } = req.body;
  if (!socio_id) return res.status(400).json({error:'socio_id mancante'});
  try {
    // Controlla posti disponibili
    const uscita = db.prepare('SELECT max_posti FROM uscite WHERE id=?').get(req.params.id);
    const count  = db.prepare('SELECT COUNT(*) as n FROM iscrizioni_uscita WHERE uscita_id=?').get(req.params.id).n;
    if (uscita && count >= uscita.max_posti)
      return res.status(400).json({error:'Uscita al completo'});
    // Verifica già iscritto
    const exists = db.prepare('SELECT 1 FROM iscrizioni_uscita WHERE uscita_id=? AND socio_id=?').get(req.params.id, socio_id);
    if (exists) return res.status(400).json({error:'Già iscritto a questa uscita'});
    db.prepare('INSERT INTO iscrizioni_uscita(uscita_id,socio_id) VALUES(?,?)').run(req.params.id, socio_id);
    // Aggiorna contatore iscritti nell'uscita
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/uscite/:id/iscrizioni/:socio_id', (req,res) => {
  try {
    db.prepare('DELETE FROM iscrizioni_uscita WHERE uscita_id=? AND socio_id=?').run(req.params.id, req.params.socio_id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// Socio aggiorna i propri dati di contatto (via tessera auth)
app.patch('/api/tessera/:socio_id/profilo', (req,res) => {
  const b = req.body;
  try {
    db.prepare(`UPDATE soci SET
      email=?, tel=?, indirizzo=?, citta=?, cap=?, nascita=?, cf=?, note=?
      WHERE id=?`).run(
      b.email||'', b.tel||'', b.indirizzo||'', b.citta||'', b.cap||'',
      b.nascita||null, (b.cf||'').toUpperCase(), b.note||'', req.params.socio_id
    );
    res.json(db.prepare('SELECT * FROM soci WHERE id=?').get(req.params.socio_id));
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── FOTO PROFILO ─────────────────────────────────────────────────────
const uploadProfilo = multer({
  storage: multer.diskStorage({
    destination: (req,file,cb) => cb(null, path.join(UPLOAD_DIR,'profili')),
    filename: (req,file,cb) => cb(null, 'profilo_' + req.params.socio_id + path.extname(file.originalname))
  }),
  limits: { fileSize: 5*1024*1024 },
  fileFilter: (req,file,cb) => {
    if (file.mimetype.startsWith('image/')) cb(null,true);
    else cb(new Error('Solo immagini'));
  }
});

app.post('/api/soci/:socio_id/foto-profilo', uploadProfilo.single('foto'), (req,res) => {
  try {
    const file_path = '/uploads/profili/' + req.file.filename;
    db.prepare('UPDATE soci SET foto_profilo=? WHERE id=?').run(file_path, req.params.socio_id);
    res.json({ok:true, foto_profilo: file_path});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/soci/:socio_id/foto-profilo', (req,res) => {
  try {
    const s = db.prepare('SELECT foto_profilo FROM soci WHERE id=?').get(req.params.socio_id);
    if (s?.foto_profilo) {
      const f = path.join(UPLOAD_DIR, s.foto_profilo.replace('/uploads/',''));
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    db.prepare('UPDATE soci SET foto_profilo=NULL WHERE id=?').run(req.params.socio_id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── TESSERA SOCIO ────────────────────────────────────────────────────
// Autenticazione socio: tessera + cognome → restituisce dati socio
app.post('/api/tessera/auth', (req,res) => {
  const { tessera, cognome } = req.body;
  if (!tessera || !cognome) return res.status(400).json({error:'Tessera e cognome richiesti'});
  try {
    const s = db.prepare(
      "SELECT * FROM soci WHERE UPPER(tessera)=UPPER(?) AND UPPER(cognome)=UPPER(?)"
    ).get(tessera.trim(), cognome.trim());
    if (!s) return res.status(404).json({error:'Socio non trovato. Verifica numero tessera e cognome.'});
    res.json(s);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Tessera HTML (renderizzata server-side, aperta in nuova tab)
app.get('/api/tessera/:socio_id', (req,res) => {
  try {
    const s = db.prepare('SELECT * FROM soci WHERE id=?').get(req.params.socio_id);
    if (!s) return res.status(404).json({error:'Socio non trovato'});
    const anno = new Date().getFullYear();
    // Dati QR: JSON compatto con dati essenziali
    const qrData = JSON.stringify({id:s.id, tessera:s.tessera, nome:s.nome, cognome:s.cognome, anno});
    const qrUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}&bgcolor=1a1a1a&color=8dc63f&qzone=2`;
    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tessera — ${s.nome} ${s.cognome}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'DM Sans',sans-serif;padding:2rem}
  .card{width:340px;background:linear-gradient(135deg,#1a2e08 0%,#0d1a06 60%,#1a2008 100%);border:2px solid #8dc63f;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 0 1px rgba(141,198,63,.1)}
  .card-header{background:linear-gradient(135deg,#5a8a1a,#3d6010);padding:1.4rem 1.6rem 1rem;position:relative;overflow:hidden}
  .card-header::after{content:'';position:absolute;top:-20px;right:-20px;width:120px;height:120px;border-radius:50%;background:rgba(141,198,63,.08)}
  .club-name{font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:.25em;color:rgba(255,255,255,.6);text-transform:uppercase}
  .card-title{font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#8dc63f;letter-spacing:.05em;line-height:1;margin-top:.2rem}
  .valid-year{position:absolute;top:1.2rem;right:1.4rem;font-family:'DM Mono',monospace;font-size:.65rem;color:#f5c400;background:rgba(245,196,0,.15);border:1px solid rgba(245,196,0,.3);padding:.25rem .6rem;border-radius:3px}
  .card-body{padding:1.4rem 1.6rem}
  .socio-name{font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:#fff;letter-spacing:.04em;line-height:1;margin-bottom:.4rem}
  .socio-role{font-family:'DM Mono',monospace;font-size:.65rem;text-transform:uppercase;letter-spacing:.15em;color:#8dc63f;margin-bottom:1.2rem}
  .tessera-num{font-family:'DM Mono',monospace;font-size:1.5rem;color:#f5c400;letter-spacing:.2em;background:rgba(245,196,0,.08);border:1px solid rgba(245,196,0,.2);padding:.5rem 1rem;border-radius:6px;display:inline-block;margin-bottom:1.2rem}
  .socio-details{display:flex;flex-direction:column;gap:.3rem;margin-bottom:1.2rem}
  .detail-row{font-size:.78rem;color:rgba(255,255,255,.6);display:flex;gap:.5rem}
  .detail-label{font-family:'DM Mono',monospace;font-size:.6rem;text-transform:uppercase;color:#5a8a1a;min-width:60px}
  .qr-section{display:flex;align-items:center;gap:1.2rem;background:rgba(0,0,0,.3);border-radius:8px;padding:1rem;border:1px solid rgba(141,198,63,.15)}
  .qr-wrap{background:#1a1a1a;border-radius:6px;padding:4px;border:1px solid #8dc63f;flex-shrink:0}
  .qr-wrap img{display:block;border-radius:4px}
  .qr-info{flex:1}
  .qr-info-title{font-family:'DM Mono',monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.12em;color:#8dc63f;margin-bottom:.3rem}
  .qr-info-text{font-size:.72rem;color:rgba(255,255,255,.5);line-height:1.5}
  .card-footer{background:rgba(0,0,0,.3);padding:.8rem 1.6rem;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(141,198,63,.15)}
  .footer-text{font-family:'DM Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.3)}
  .stripe{height:4px;background:linear-gradient(90deg,#5a8a1a,#8dc63f,#f5c400,#8dc63f,#5a8a1a)}
  @media print{body{background:#fff;padding:0}  .card{box-shadow:none;border:2px solid #5a8a1a} .no-print{display:none}}
</style>
</head>
<body>
<div>
  <div class="stripe"></div>
  <div class="card">
    <div class="card-header">
      <div class="club-name">Club Ciclistico Amatoriale</div>
      <div class="card-title">Ciclo Team<br>La Röda</div>
      <div class="valid-year">✓ ${anno}</div>
    </div>
    <div class="card-body">
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
        ${s.foto_profilo
          ? `<img src="${s.foto_profilo}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid #8dc63f;flex-shrink:0">`
          : `<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#5a8a1a,#3d6010);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:1.8rem;color:#fff;border:2px solid #8dc63f;flex-shrink:0">${s.nome[0]}${s.cognome[0]}</div>`}
        <div>
          <div class="socio-name" style="font-size:1.7rem">${s.nome}<br>${s.cognome}</div>
          <div class="socio-role">${s.ruolo||'Socio'}</div>
        </div>
      </div>
      <div class="tessera-num">${s.tessera||'—'}</div>
      <div class="socio-details">
        ${s.citta?`<div class="detail-row"><span class="detail-label">Città</span><span>${s.citta}${s.cap?' '+s.cap:''}</span></div>`:''}
        ${s.tel?`<div class="detail-row"><span class="detail-label">Tel</span><span>${s.tel}</span></div>`:''}
        ${s.email?`<div class="detail-row"><span class="detail-label">Email</span><span>${s.email}</span></div>`:''}
      </div>
      <div class="qr-section">
        <div class="qr-wrap">
          <img src="${qrUrl}" width="90" height="90" alt="QR Code">
        </div>
        <div class="qr-info">
          <div class="qr-info-title">Scansiona per verificare</div>
          <div class="qr-info-text">QR code contiene i dati del socio per identificazione rapida alle uscite</div>
        </div>
      </div>
    </div>
    <div class="card-footer">
      <span class="footer-text">CTR La Röda — ${anno}</span>
      <span class="footer-text">Tesserato regolare</span>
    </div>
  </div>
  <div class="stripe"></div>
  <div class="no-print" style="text-align:center;margin-top:1.5rem;display:flex;gap:1rem;justify-content:center">
    <button onclick="window.print()" style="background:#5a8a1a;color:#fff;border:none;padding:.7rem 1.8rem;border-radius:6px;font-family:'DM Mono',monospace;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">🖨 Stampa / Salva PDF</button>
    <button onclick="window.close()" style="background:none;color:#666;border:1px solid #333;padding:.7rem 1.8rem;border-radius:6px;font-family:'DM Mono',monospace;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">Chiudi</button>
  </div>
</div>
</body>
</html>`;
    res.send(html);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── SPESE ────────────────────────────────────────────────────────────
app.get('/api/spese/:anno', (req,res) => {
  try { res.json(db.prepare('SELECT * FROM spese WHERE anno=? ORDER BY data_spesa').all(req.params.anno)); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/spese', (req,res) => {
  const b = req.body;
  try {
    const r = db.prepare(`INSERT INTO spese(anno,data_spesa,descrizione,categoria,importo,incassato,note)
      VALUES(?,?,?,?,?,?,?)`).run(b.anno,b.data_spesa||null,b.descrizione,b.categoria||'Uscita',b.importo||0,b.incassato||0,b.note||'');
    res.json(db.prepare('SELECT * FROM spese WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/spese/:id', (req,res) => {
  const b = req.body;
  try {
    db.prepare(`UPDATE spese SET data_spesa=?,descrizione=?,categoria=?,importo=?,incassato=?,note=? WHERE id=?`).run(
      b.data_spesa||null,b.descrizione,b.categoria||'Uscita',b.importo||0,b.incassato||0,b.note||'',req.params.id
    );
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/spese/:id', (req,res) => {
  try { db.prepare('DELETE FROM spese WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

// ── TRASFERTE ────────────────────────────────────────────────────────
app.get('/api/trasferte/:anno', (req,res) => {
  try {
    const list = db.prepare('SELECT * FROM trasferte WHERE anno=? ORDER BY data_inizio').all(req.params.anno);
    list.forEach(t => {
      t.iscrizioni = db.prepare('SELECT * FROM iscrizioni_trasferta WHERE trasferta_id=?').all(t.id);
    });
    res.json(list);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/trasferte', (req,res) => {
  const b = req.body;
  try {
    const r = db.prepare(`INSERT INTO trasferte(anno,nome,data_inizio,data_fine,luogo,km,dislivello,quota,max_posti,note)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(b.anno,b.nome,b.data_inizio||null,b.data_fine||null,b.luogo||'',
      b.km||0,b.dislivello||0,b.quota||0,b.max_posti||20,b.note||'');
    res.json(db.prepare('SELECT * FROM trasferte WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/trasferte/:id', (req,res) => {
  const b = req.body;
  try {
    db.prepare(`UPDATE trasferte SET nome=?,data_inizio=?,data_fine=?,luogo=?,km=?,dislivello=?,quota=?,max_posti=?,note=? WHERE id=?`).run(
      b.nome,b.data_inizio||null,b.data_fine||null,b.luogo||'',b.km||0,b.dislivello||0,b.quota||0,b.max_posti||20,b.note||'',req.params.id
    );
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/trasferte/:id', (req,res) => {
  try { db.prepare('DELETE FROM trasferte WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

// Iscrizioni trasferta
app.post('/api/trasferte/:id/iscrizioni', (req,res) => {
  const b = req.body;
  try {
    db.prepare(`INSERT INTO iscrizioni_trasferta(trasferta_id,socio_id,acconto,saldo,data_iscr,metodo,camera,note)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(trasferta_id,socio_id) DO UPDATE SET acconto=excluded.acconto,saldo=excluded.saldo,
      data_iscr=excluded.data_iscr,metodo=excluded.metodo,camera=excluded.camera,note=excluded.note`).run(
      req.params.id,b.socio_id,b.acconto||0,b.saldo||0,b.data_iscr||null,b.metodo||'',b.camera||'',b.note||''
    );
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/trasferte/:id/iscrizioni/:socio_id', (req,res) => {
  try {
    db.prepare('DELETE FROM iscrizioni_trasferta WHERE trasferta_id=? AND socio_id=?').run(req.params.id,req.params.socio_id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── ALBUM ────────────────────────────────────────────────────────────
app.get('/api/album', (req,res) => {
  const anno = req.query.anno;
  try {
    const rows = anno
      ? db.prepare('SELECT * FROM album WHERE anno=? ORDER BY created_at DESC').all(anno)
      : db.prepare('SELECT * FROM album ORDER BY anno DESC, created_at DESC').all();
    rows.forEach(a => {
      a.n_foto  = db.prepare('SELECT COUNT(*) as n FROM gallery_foto  WHERE album_id=?').get(a.id).n;
      a.n_video = db.prepare('SELECT COUNT(*) as n FROM gallery_video WHERE album_id=?').get(a.id).n;
    });
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/album', (req,res) => {
  const b = req.body;
  try {
    const r = db.prepare('INSERT INTO album(anno,nome,descrizione) VALUES(?,?,?)').run(
      b.anno||new Date().getFullYear(), b.nome, b.descrizione||''
    );
    res.json(db.prepare('SELECT * FROM album WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/album/:id', (req,res) => {
  const b = req.body;
  try {
    db.prepare('UPDATE album SET nome=?,descrizione=? WHERE id=?').run(b.nome, b.descrizione||'', req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/album/:id', (req,res) => {
  try {
    // Elimina file fisici delle foto/video nell'album
    const foto  = db.prepare('SELECT file_path FROM gallery_foto  WHERE album_id=?').all(req.params.id);
    const video = db.prepare('SELECT file_path FROM gallery_video WHERE album_id=?').all(req.params.id);
    [...foto, ...video].forEach(r => {
      if (r.file_path) {
        const f = path.join(UPLOAD_DIR, r.file_path.replace('/uploads/',''));
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    });
    db.prepare('DELETE FROM album WHERE id=?').run(req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── GALLERY FOTO (con album) ─────────────────────────────────────────
app.get('/api/gallery/foto', (req,res) => {
  try {
    const {anno, album_id} = req.query;
    let q = 'SELECT * FROM gallery_foto WHERE 1=1';
    const params = [];
    if (anno)     { q += ' AND anno=?';     params.push(anno); }
    if (album_id) { q += ' AND album_id=?'; params.push(album_id); }
    q += ' ORDER BY created_at ASC';
    res.json(db.prepare(q).all(...params));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/gallery/foto', upload.single('file'), (req,res) => {
  const file_path = '/uploads/foto/' + req.file.filename;
  const anno = parseInt(req.body.anno) || new Date().getFullYear();
  const album_id = req.body.album_id ? parseInt(req.body.album_id) : null;
  try {
    const r = db.prepare('INSERT INTO gallery_foto(anno,album_id,titolo,mime_type,file_path) VALUES(?,?,?,?,?)').run(
      anno, album_id, req.body.titolo||req.file.originalname, req.file.mimetype, file_path
    );
    // Imposta come copertina album se primo elemento
    if (album_id) {
      const alb = db.prepare('SELECT copertina FROM album WHERE id=?').get(album_id);
      if (!alb?.copertina) db.prepare('UPDATE album SET copertina=? WHERE id=?').run(file_path, album_id);
    }
    res.json(db.prepare('SELECT * FROM gallery_foto WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/gallery/foto/:id', (req,res) => {
  try {
    db.prepare('UPDATE gallery_foto SET titolo=? WHERE id=?').run(req.body.titolo, req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/gallery/foto/:id', (req,res) => {
  try {
    const row = db.prepare('SELECT file_path FROM gallery_foto WHERE id=?').get(req.params.id);
    if (row?.file_path) { const f=path.join(UPLOAD_DIR,row.file_path.replace('/uploads/','')); if(fs.existsSync(f))fs.unlinkSync(f); }
    db.prepare('DELETE FROM gallery_foto WHERE id=?').run(req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── GALLERY VIDEO (con album) ────────────────────────────────────────
app.get('/api/gallery/video', (req,res) => {
  try {
    const {anno, album_id} = req.query;
    let q = 'SELECT * FROM gallery_video WHERE 1=1';
    const params = [];
    if (anno)     { q += ' AND anno=?';     params.push(anno); }
    if (album_id) { q += ' AND album_id=?'; params.push(album_id); }
    q += ' ORDER BY created_at ASC';
    res.json(db.prepare(q).all(...params));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/gallery/video', upload.single('file'), (req,res) => {
  const file_path = '/uploads/video/' + req.file.filename;
  const anno = parseInt(req.body.anno) || new Date().getFullYear();
  const album_id = req.body.album_id ? parseInt(req.body.album_id) : null;
  try {
    const r = db.prepare('INSERT INTO gallery_video(anno,album_id,titolo,mime_type,file_path,durata) VALUES(?,?,?,?,?,?)').run(
      anno, album_id, req.body.titolo||req.file.originalname, req.file.mimetype, file_path, req.body.durata||'—'
    );
    res.json(db.prepare('SELECT * FROM gallery_video WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/gallery/video/:id', (req,res) => {
  try {
    const b = req.body;
    db.prepare('UPDATE gallery_video SET titolo=?,durata=? WHERE id=?').run(b.titolo, b.durata||'—', req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/gallery/video/:id', (req,res) => {
  try {
    const row = db.prepare('SELECT file_path FROM gallery_video WHERE id=?').get(req.params.id);
    if (row?.file_path) { const f=path.join(UPLOAD_DIR,row.file_path.replace('/uploads/','')); if(fs.existsSync(f))fs.unlinkSync(f); }
    db.prepare('DELETE FROM gallery_video WHERE id=?').run(req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── NEWS ─────────────────────────────────────────────────────────────
app.get('/api/news', (req,res) => {
  try { res.json(db.prepare('SELECT * FROM news ORDER BY data_pub DESC').all()); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/news', (req,res) => {
  const b = req.body;
  try {
    const r = db.prepare('INSERT INTO news(titolo,testo,tag,emoji,data_pub) VALUES(?,?,?,?,?)').run(
      b.titolo, b.testo||'', b.tag||'Comunicazione', b.emoji||'📋', b.data_pub||new Date().toISOString().split('T')[0]
    );
    res.json(db.prepare('SELECT * FROM news WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/news/:id', (req,res) => {
  const b = req.body;
  try {
    db.prepare('UPDATE news SET titolo=?,testo=?,tag=?,emoji=?,data_pub=? WHERE id=?').run(
      b.titolo, b.testo||'', b.tag||'Comunicazione', b.emoji||'📋', b.data_pub, req.params.id
    );
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/news/:id', (req,res) => {
  try { db.prepare('DELETE FROM news WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

// ── DOCUMENTI ────────────────────────────────────────────────────────
const uploadDocs = multer({
  storage: multer.diskStorage({
    destination: (req,file,cb) => {
      const d = path.join(UPLOAD_DIR, 'documenti');
      fs.mkdirSync(d, {recursive:true}); cb(null,d);
    },
    filename: (req,file,cb) => {
      // Mantieni nome originale ma aggiungi timestamp per evitare conflitti
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g,'_');
      cb(null, base + '_' + Date.now() + ext);
    }
  }),
  limits: { fileSize: 50*1024*1024 },
  fileFilter: (req,file,cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) cb(null,true);
    else cb(new Error('Solo PDF e immagini'));
  }
});

app.get('/api/documenti', (req,res) => {
  try { res.json(db.prepare('SELECT * FROM documenti ORDER BY categoria, titolo').all()); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/documenti', uploadDocs.single('file'), (req,res) => {
  if (!req.file) return res.status(400).json({error:'File mancante'});
  const file_path = '/uploads/documenti/' + req.file.filename;
  const size_kb = Math.round(req.file.size / 1024);
  try {
    const r = db.prepare('INSERT INTO documenti(titolo,descrizione,categoria,file_path,mime_type,size_kb) VALUES(?,?,?,?,?,?)').run(
      req.body.titolo||req.file.originalname, req.body.descrizione||'',
      req.body.categoria||'Generale', file_path, req.file.mimetype, size_kb
    );
    res.json(db.prepare('SELECT * FROM documenti WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.patch('/api/documenti/:id', (req,res) => {
  const b = req.body;
  try {
    db.prepare('UPDATE documenti SET titolo=?,descrizione=?,categoria=? WHERE id=?').run(
      b.titolo, b.descrizione||'', b.categoria||'Generale', req.params.id
    );
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/documenti/:id', (req,res) => {
  try {
    const row = db.prepare('SELECT file_path FROM documenti WHERE id=?').get(req.params.id);
    if (row?.file_path) { const f=path.join(UPLOAD_DIR,row.file_path.replace('/uploads/','')); if(fs.existsSync(f))fs.unlinkSync(f); }
    db.prepare('DELETE FROM documenti WHERE id=?').run(req.params.id);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── NOTE ADMIN ───────────────────────────────────────────────────────
app.get('/api/admin/note/:anno', (req,res) => {
  try {
    const row = db.prepare('SELECT testo FROM admin_note WHERE anno=?').get(req.params.anno);
    res.json({testo: row?.testo||''});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/note', (req,res) => {
  try {
    db.prepare('INSERT INTO admin_note(anno,testo) VALUES(?,?) ON CONFLICT(anno) DO UPDATE SET testo=excluded.testo').run(req.body.anno,req.body.testo||'');
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});

// ── FALLBACK ─────────────────────────────────────────────────────────
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`CTR La Röda → http://localhost:${PORT}`));
