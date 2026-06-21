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

-- Gallery
CREATE TABLE IF NOT EXISTS gallery_foto (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  anno       INTEGER,
  titolo     TEXT NOT NULL,
  mime_type  TEXT,
  file_path  TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gallery_video (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  anno       INTEGER,
  titolo     TEXT NOT NULL,
  mime_type  TEXT,
  file_path  TEXT,
  durata     TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Note admin per anno
CREATE TABLE IF NOT EXISTS admin_note (
  anno  INTEGER PRIMARY KEY,
  testo TEXT DEFAULT ''
);
`);

// Migrate vecchie tabelle se esistono ancora
try { db.exec(`ALTER TABLE gallery_foto ADD COLUMN anno INTEGER`); } catch(e){}
try { db.exec(`ALTER TABLE gallery_video ADD COLUMN anno INTEGER`); } catch(e){}

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

// ── GALLERY ──────────────────────────────────────────────────────────
app.get('/api/gallery/:type', (req,res) => {
  const t = req.params.type==='video'?'gallery_video':'gallery_foto';
  const anno = req.query.anno;
  try {
    const q = anno ? `SELECT * FROM ${t} WHERE anno=? ORDER BY created_at DESC` : `SELECT * FROM ${t} ORDER BY created_at DESC`;
    res.json(anno ? db.prepare(q).all(anno) : db.prepare(q).all());
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/gallery/:type', upload.single('file'), (req,res) => {
  const type = req.params.type==='video'?'video':'foto';
  const table = type==='foto'?'gallery_foto':'gallery_video';
  const file_path = '/uploads/'+type+'/'+req.file.filename;
  const anno = req.body.anno ? parseInt(req.body.anno) : new Date().getFullYear();
  try {
    if (type==='foto') {
      const r = db.prepare('INSERT INTO gallery_foto(anno,titolo,mime_type,file_path) VALUES(?,?,?,?)').run(anno,req.body.titolo||req.file.originalname,req.file.mimetype,file_path);
      res.json(db.prepare('SELECT * FROM gallery_foto WHERE id=?').get(r.lastInsertRowid));
    } else {
      const r = db.prepare('INSERT INTO gallery_video(anno,titolo,mime_type,file_path,durata) VALUES(?,?,?,?,?)').run(anno,req.body.titolo||req.file.originalname,req.file.mimetype,file_path,req.body.durata||'—');
      res.json(db.prepare('SELECT * FROM gallery_video WHERE id=?').get(r.lastInsertRowid));
    }
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.delete('/api/gallery/:type/:id', (req,res) => {
  const t = req.params.type==='video'?'gallery_video':'gallery_foto';
  try {
    const row = db.prepare(`SELECT file_path FROM ${t} WHERE id=?`).get(req.params.id);
    if (row?.file_path) { const f=path.join(UPLOAD_DIR,row.file_path.replace('/uploads/','')); if(fs.existsSync(f))fs.unlinkSync(f); }
    db.prepare(`DELETE FROM ${t} WHERE id=?`).run(req.params.id);
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
