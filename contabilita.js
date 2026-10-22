// ════════════════════════════════════════════════════════════════════
//  CONTABILITÀ A PARTITA DOPPIA — CTR La Röda
//  Piano dei conti, registrazioni dare/avere, bilancio e conto economico,
//  preventivo, allegati privati, export CSV/Banana, rendiconto stampabile.
//  Quote, spese e iscrizioni alle trasferte vengono registrate in automatico.
// ════════════════════════════════════════════════════════════════════
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Tipi di conto: A = attivo, P = passivo, C = costo, R = ricavo
const PIANO_INIZIALE = [
  // Attivi
  ['1000', 'Cassa', 'A', 'Liquidità'],
  ['1010', 'Conto postale (PostFinance)', 'A', 'Liquidità'],
  ['1020', 'Banca', 'A', 'Liquidità'],
  ['1030', 'TWINT', 'A', 'Liquidità'],
  ['1040', 'PayPal', 'A', 'Liquidità'],
  ['1100', 'Crediti', 'A', 'Crediti'],
  ['1300', 'Ratei e risconti attivi', 'A', 'Ratei e risconti'],
  ['1500', 'Materiale e attrezzature', 'A', 'Immobilizzi'],
  // Passivi
  ['2000', 'Debiti verso fornitori', 'P', 'Capitale di terzi'],
  ['2030', 'Anticipi ricevuti', 'P', 'Capitale di terzi'],
  ['2300', 'Ratei e risconti passivi', 'P', 'Capitale di terzi'],
  ['2800', "Capitale dell'associazione", 'P', 'Capitale proprio'],
  // Ricavi
  ['3000', 'Quote sociali', 'R', 'Ricavi associativi'],
  ['3100', 'Quote trasferte', 'R', 'Ricavi attività'],
  ['3200', 'Sponsor e donazioni', 'R', 'Ricavi associativi'],
  ['3300', 'Contributi pubblici', 'R', 'Ricavi associativi'],
  ['3400', 'Ricavi uscite e manifestazioni', 'R', 'Ricavi attività'],
  ['3900', 'Altri ricavi', 'R', 'Altri ricavi'],
  // Costi
  ['4000', 'Costi trasferte (alloggio, trasporto)', 'C', 'Costi attività'],
  ['4100', 'Costi uscite e manifestazioni', 'C', 'Costi attività'],
  ['4200', 'Abbigliamento e materiale', 'C', 'Costi attività'],
  ['4300', 'Assicurazioni', 'C', 'Costi amministrativi'],
  ['4400', 'Tasse federazione e licenze', 'C', 'Costi amministrativi'],
  ['4500', 'Spese amministrative', 'C', 'Costi amministrativi'],
  ['4600', 'Sito web e informatica', 'C', 'Costi amministrativi'],
  ['4700', 'Spese bancarie e postali', 'C', 'Costi amministrativi'],
  ['4900', 'Altri costi', 'C', 'Altri costi'],
];

// Collegamenti automatici (modificabili dal pannello Impostazioni)
const IMPOSTAZIONI_INIZIALI = {
  // Esercizio in cui inizia la contabilità: i saldi di apertura valgono da qui.
  // null = il primo anno con registrazioni.
  anno_inizio: null,
  // Le registrazioni automatiche partono da questa data (AAAA-MM-GG). Serve a non
  // duplicare movimenti già presenti in una contabilità importata. null = sempre.
  automatiche_dal: null,
  metodi: { Contanti: '1000', Bonifico: '1010', TWINT: '1030', PayPal: '1040' },
  metodo_predefinito: '1000',
  conto_quote: '3000',
  conto_trasferte: '3100',
  spese_liquidita: '1000',
  spese_categorie: {
    Uscita:    { costo: '4100', ricavo: '3400' },
    Trasferta: { costo: '4000', ricavo: '3100' },
    Materiale: { costo: '4200', ricavo: '3900' },
    Quota:     { costo: '4400', ricavo: '3000' },
    Altro:     { costo: '4900', ricavo: '3900' },
  },
};

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

module.exports = function montaContabilita(app, db, { requireAdmin, DATA_DIR, esc }) {
  // ── SCHEMA ─────────────────────────────────────────────────────────
  db.exec(`
  CREATE TABLE IF NOT EXISTS cont_conti (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    numero      TEXT NOT NULL UNIQUE,
    descrizione TEXT NOT NULL,
    tipo        TEXT NOT NULL CHECK (tipo IN ('A','P','C','R')),
    gruppo      TEXT DEFAULT '',
    attivo      INTEGER DEFAULT 1,
    apertura    REAL DEFAULT 0          -- saldo iniziale (solo attivi/passivi), importo positivo
  );
  CREATE TABLE IF NOT EXISTS cont_registrazioni (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    anno        INTEGER NOT NULL,       -- esercizio contabile
    data        TEXT NOT NULL,
    doc         TEXT DEFAULT '',
    descrizione TEXT NOT NULL,
    dare_id     INTEGER NOT NULL REFERENCES cont_conti(id),
    avere_id    INTEGER NOT NULL REFERENCES cont_conti(id),
    importo     REAL NOT NULL CHECK (importo > 0),
    origine     TEXT DEFAULT 'manuale', -- manuale | quota | spesa | trasferta
    rif         TEXT UNIQUE,            -- riferimento della registrazione automatica
    allegato    TEXT,
    allegato_nome TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cont_reg_anno ON cont_registrazioni(anno);
  CREATE TABLE IF NOT EXISTS cont_preventivo (
    anno     INTEGER NOT NULL,
    conto_id INTEGER NOT NULL REFERENCES cont_conti(id) ON DELETE CASCADE,
    importo  REAL DEFAULT 0,
    PRIMARY KEY (anno, conto_id)
  );
  CREATE TABLE IF NOT EXISTS cont_impostazioni (
    chiave TEXT PRIMARY KEY,
    valore TEXT
  );
  `);

  if (db.prepare('SELECT COUNT(*) n FROM cont_conti').get().n === 0) {
    const ins = db.prepare('INSERT INTO cont_conti(numero,descrizione,tipo,gruppo) VALUES(?,?,?,?)');
    db.transaction(() => PIANO_INIZIALE.forEach(c => ins.run(...c)))();
    console.log('Contabilità: piano dei conti iniziale creato');
  }

  // Allegati fuori dalla cartella pubblica /uploads: si scaricano solo da admin
  const ALLEGATI_DIR = path.join(DATA_DIR, 'allegati');
  fs.mkdirSync(ALLEGATI_DIR, { recursive: true });
  const uploadAllegato = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, ALLEGATI_DIR),
      filename: (req, file, cb) => cb(null, `reg_${req.params.id}_${Date.now()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
      (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) ? cb(null, true) : cb(new Error('Solo PDF o immagini')),
  });
  const rimuoviFile = f => { if (f) { try { fs.unlinkSync(path.join(ALLEGATI_DIR, path.basename(f))); } catch (e) {} } };

  // ── IMPOSTAZIONI ───────────────────────────────────────────────────
  function impostazioni() {
    const out = JSON.parse(JSON.stringify(IMPOSTAZIONI_INIZIALI));
    db.prepare('SELECT chiave, valore FROM cont_impostazioni').all().forEach(r => {
      try { out[r.chiave] = JSON.parse(r.valore); } catch (e) {}
    });
    return out;
  }

  const contiById  = () => new Map(db.prepare('SELECT * FROM cont_conti').all().map(c => [c.id, c]));
  const idDaNumero = () => new Map(db.prepare('SELECT id, numero FROM cont_conti').all().map(c => [c.numero, c.id]));

  // ── REGISTRAZIONI AUTOMATICHE ──────────────────────────────────────
  // Calcola le registrazioni che quote/spese/trasferte DEVONO generare e allinea
  // la tabella (inserisce, aggiorna, elimina). Idempotente: si può chiamare sempre.
  function sincronizzaAutomatiche() {
    const S = impostazioni(), N = idDaNumero(), avvisi = new Set();
    const conto = (num, cosa) => { const id = N.get(String(num || '')); if (!id) avvisi.add(`Conto ${num || '?'} non trovato (${cosa})`); return id; };
    const liquidita = metodo => conto(S.metodi?.[metodo] || S.metodo_predefinito, `metodo ${metodo || 'predefinito'}`);
    const voluti = [];
    const dal = /^\d{4}-\d{2}-\d{2}$/.test(S.automatiche_dal || '') ? S.automatiche_dal : null;
    const add = (rif, origine, anno, data, descrizione, dare, avere, importo) => {
      importo = r2(importo);
      data = String(data || `${anno}-12-31`).slice(0, 10);
      if (dal && data < dal) return; // movimento anteriore alla partenza delle automatiche
      if (importo > 0 && dare && avere && dare !== avere)
        voluti.push({ rif, origine, anno, data, descrizione, dare_id: dare, avere_id: avere, importo });
    };

    // Quote sociali pagate
    db.prepare(`SELECT q.*, s.nome, s.cognome FROM quote q JOIN soci s ON s.id=q.socio_id WHERE q.pagato=1`).all()
      .forEach(q => add(`quota:${q.socio_id}:${q.anno}`, 'quota', q.anno, q.data_pag,
        `Quota sociale ${q.anno} – ${q.cognome} ${q.nome}`, liquidita(q.metodo), conto(S.conto_quote, 'quote'), q.importo));

    // Spese: importo speso = costo, incassato = ricavo (per categoria)
    db.prepare('SELECT * FROM spese').all().forEach(s => {
      const cat = S.spese_categorie?.[s.categoria] || S.spese_categorie?.Altro || {};
      const liq = conto(S.spese_liquidita, 'spese');
      add(`spesa:${s.id}:costo`, 'spesa', s.anno, s.data_spesa, s.descrizione, conto(cat.costo, `costo ${s.categoria}`), liq, s.importo);
      add(`spesa:${s.id}:ricavo`, 'spesa', s.anno, s.data_spesa, `${s.descrizione} (incasso)`, liq, conto(cat.ricavo, `ricavo ${s.categoria}`), s.incassato);
    });

    // Iscrizioni trasferte: acconto + saldo versati
    db.prepare(`SELECT i.*, t.nome AS trasferta, t.anno, t.data_inizio, s.nome, s.cognome
                FROM iscrizioni_trasferta i JOIN trasferte t ON t.id=i.trasferta_id JOIN soci s ON s.id=i.socio_id`).all()
      .forEach(i => add(`trasferta:${i.trasferta_id}:${i.socio_id}`, 'trasferta', i.anno, i.data_iscr || i.data_inizio,
        `${i.trasferta} – ${i.cognome} ${i.nome}`, liquidita(i.metodo), conto(S.conto_trasferte, 'trasferte'),
        (i.acconto || 0) + (i.saldo || 0)));

    const esistenti = new Map(db.prepare("SELECT * FROM cont_registrazioni WHERE origine!='manuale'").all().map(r => [r.rif, r]));
    const ins = db.prepare(`INSERT INTO cont_registrazioni(anno,data,descrizione,dare_id,avere_id,importo,origine,rif) VALUES(?,?,?,?,?,?,?,?)`);
    const upd = db.prepare(`UPDATE cont_registrazioni SET anno=?,data=?,descrizione=?,dare_id=?,avere_id=?,importo=? WHERE id=?`);
    const del = db.prepare('DELETE FROM cont_registrazioni WHERE id=?');
    db.transaction(() => {
      const visti = new Set();
      for (const v of voluti) {
        visti.add(v.rif);
        const e = esistenti.get(v.rif);
        if (!e) ins.run(v.anno, v.data, v.descrizione, v.dare_id, v.avere_id, v.importo, v.origine, v.rif);
        else if (e.anno !== v.anno || e.data !== v.data || e.descrizione !== v.descrizione || e.dare_id !== v.dare_id || e.avere_id !== v.avere_id || r2(e.importo) !== v.importo)
          upd.run(v.anno, v.data, v.descrizione, v.dare_id, v.avere_id, v.importo, e.id); // l'allegato resta
      }
      for (const [rif, e] of esistenti) if (!visti.has(rif)) { rimuoviFile(e.allegato); del.run(e.id); }
    })();
    return [...avvisi];
  }

  // Primo esercizio della contabilità: da impostazioni, altrimenti il primo anno con registrazioni
  function annoInizio(S) {
    return parseInt(S.anno_inizio) || db.prepare('SELECT MIN(anno) m FROM cont_registrazioni').get().m || new Date().getFullYear();
  }

  // ── CALCOLO BILANCIO ───────────────────────────────────────────────
  // Convenzione interna: saldo = dare − avere (attivi e costi positivi, passivi e ricavi negativi).
  // Saldi di apertura (importi positivi nel conto):
  //  - attivi/passivi: valgono dall'esercizio di inizio, poi si riportano con i movimenti;
  //  - costi/ricavi: movimenti del primo esercizio non dettagliati (come in Banana):
  //    entrano nel risultato del primo esercizio e poi nel "risultato esercizi precedenti".
  function calcolaBilancio(anno) {
    anno = parseInt(anno);
    const avvisi = sincronizzaAutomatiche();
    const S = impostazioni(), inizio = annoInizio(S);
    const conti = db.prepare('SELECT * FROM cont_conti ORDER BY numero').all();
    const mov = (cond, ...par) => new Map(db.prepare(`
      SELECT c.id,
        COALESCE((SELECT SUM(importo) FROM cont_registrazioni WHERE dare_id=c.id  AND ${cond}),0) AS dare,
        COALESCE((SELECT SUM(importo) FROM cont_registrazioni WHERE avere_id=c.id AND ${cond}),0) AS avere
      FROM cont_conti c`).all(...par, ...par).map(r => [r.id, r]));
    // Movimenti degli esercizi precedenti, a partire da quello di inizio
    const prima = mov('anno >= ? AND anno < ?', inizio, anno), anno_ = mov('anno = ?', anno);
    const prev = new Map(db.prepare('SELECT conto_id, importo FROM cont_preventivo WHERE anno=?').all(anno).map(r => [r.conto_id, r.importo]));

    let risultatoPrecedenti = 0;
    const righe = conti.map(c => {
      const p = prima.get(c.id), m = anno_.get(c.id);
      const patrimoniale = c.tipo === 'A' || c.tipo === 'P';
      const apInterna = ((c.tipo === 'A' || c.tipo === 'C') ? 1 : -1) * (c.apertura || 0); // convenzione dare − avere
      let apertura;
      if (patrimoniale) {
        // Saldo iniziale + movimenti degli esercizi precedenti
        apertura = anno >= inizio ? r2(apInterna + p.dare - p.avere) : 0;
      } else {
        apertura = anno === inizio ? r2(apInterna) : 0;
        if (anno > inizio) risultatoPrecedenti += -apInterna + p.avere - p.dare;
      }
      const saldo = r2(apertura + m.dare - m.avere);
      const segno = (c.tipo === 'A' || c.tipo === 'C') ? 1 : -1; // per mostrarli positivi
      return {
        id: c.id, numero: c.numero, descrizione: c.descrizione, tipo: c.tipo, gruppo: c.gruppo, attivo: c.attivo,
        apertura: r2(segno * apertura), dare: r2(m.dare), avere: r2(m.avere), saldo: r2(segno * saldo),
        preventivo: prev.has(c.id) ? r2(prev.get(c.id)) : null,
      };
    });
    const tot = t => r2(righe.filter(r => r.tipo === t).reduce((s, r) => s + r.saldo, 0));
    const attivi = tot('A'), passivi = tot('P'), costi = tot('C'), ricavi = tot('R');
    const risultato = r2(ricavi - costi);
    risultatoPrecedenti = r2(risultatoPrecedenti);
    const differenza = r2(attivi - (passivi + risultatoPrecedenti + risultato));
    const liquidita = r2(righe.filter(r => r.tipo === 'A' && /liquid/i.test(r.gruppo)).reduce((s, r) => s + r.saldo, 0));
    const nReg = db.prepare('SELECT COUNT(*) n FROM cont_registrazioni WHERE anno=?').get(anno).n;
    const totPrev = t => r2(righe.filter(r => r.tipo === t).reduce((s, r) => s + (r.preventivo || 0), 0));
    return {
      anno, anno_inizio: inizio, conti: righe, avvisi, n_registrazioni: nReg,
      totali: { attivi, passivi, costi, ricavi, risultato, risultato_precedenti: risultatoPrecedenti, differenza, liquidita,
                preventivo_costi: totPrev('C'), preventivo_ricavi: totPrev('R') },
    };
  }

  // ── API: IMPOSTAZIONI ──────────────────────────────────────────────
  app.get('/api/contabilita/impostazioni', requireAdmin, (req, res) => res.json(impostazioni()));
  app.put('/api/contabilita/impostazioni', requireAdmin, (req, res) => {
    try {
      const up = db.prepare('INSERT INTO cont_impostazioni(chiave,valore) VALUES(?,?) ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore');
      db.transaction(() => Object.keys(IMPOSTAZIONI_INIZIALI).forEach(k => {
        if (req.body[k] !== undefined) up.run(k, JSON.stringify(req.body[k]));
      }))();
      res.json({ ok: true, avvisi: sincronizzaAutomatiche() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── API: PIANO DEI CONTI ───────────────────────────────────────────
  app.get('/api/contabilita/conti', requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM cont_registrazioni r WHERE r.dare_id=c.id OR r.avere_id=c.id) AS n_movimenti
                         FROM cont_conti c ORDER BY numero`).all());
  });
  const validaConto = b => {
    if (!/^\d{3,6}$/.test(String(b.numero || '').trim())) throw new Error('Numero conto: da 3 a 6 cifre');
    if (!String(b.descrizione || '').trim()) throw new Error('Descrizione obbligatoria');
    if (!['A', 'P', 'C', 'R'].includes(b.tipo)) throw new Error('Tipo non valido');
  };
  app.post('/api/contabilita/conti', requireAdmin, (req, res) => {
    const b = req.body;
    try {
      validaConto(b);
      const r = db.prepare('INSERT INTO cont_conti(numero,descrizione,tipo,gruppo,apertura) VALUES(?,?,?,?,?)')
        .run(String(b.numero).trim(), b.descrizione.trim(), b.tipo, b.gruppo || '', r2(b.apertura));
      res.json(db.prepare('SELECT * FROM cont_conti WHERE id=?').get(r.lastInsertRowid));
    } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Numero conto già esistente' : e.message }); }
  });
  app.patch('/api/contabilita/conti/:id', requireAdmin, (req, res) => {
    const b = req.body;
    try {
      validaConto(b);
      db.prepare('UPDATE cont_conti SET numero=?,descrizione=?,tipo=?,gruppo=?,attivo=?,apertura=? WHERE id=?')
        .run(String(b.numero).trim(), b.descrizione.trim(), b.tipo, b.gruppo || '', b.attivo === 0 ? 0 : 1, r2(b.apertura), req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Numero conto già esistente' : e.message }); }
  });
  app.delete('/api/contabilita/conti/:id', requireAdmin, (req, res) => {
    const n = db.prepare('SELECT COUNT(*) n FROM cont_registrazioni WHERE dare_id=? OR avere_id=?').get(req.params.id, req.params.id).n;
    if (n) return res.status(400).json({ error: `Il conto ha ${n} registrazioni: disattivalo invece di eliminarlo` });
    db.prepare('DELETE FROM cont_conti WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });
  // Saldi di apertura (inizio della contabilità) in un colpo solo
  app.put('/api/contabilita/aperture', requireAdmin, (req, res) => {
    try {
      const up = db.prepare('UPDATE cont_conti SET apertura=? WHERE id=?');
      db.transaction(() => (req.body || []).forEach(a => up.run(r2(a.apertura), a.id)))();
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── API: REGISTRAZIONI ─────────────────────────────────────────────
  const SELECT_REG = `
    SELECT r.*, d.numero AS dare_num, d.descrizione AS dare_desc, a.numero AS avere_num, a.descrizione AS avere_desc
    FROM cont_registrazioni r JOIN cont_conti d ON d.id=r.dare_id JOIN cont_conti a ON a.id=r.avere_id`;

  app.get('/api/contabilita/registrazioni', requireAdmin, (req, res) => {
    try {
      const avvisi = sincronizzaAutomatiche();
      const anno = parseInt(req.query.anno) || new Date().getFullYear();
      const righe = db.prepare(`${SELECT_REG} WHERE r.anno=? ORDER BY r.data, r.id`).all(anno);
      righe.forEach(r => { r.allegato = r.allegato ? true : false; });
      res.json({ registrazioni: righe, avvisi });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  const validaReg = b => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) throw new Error('Data non valida');
    if (!String(b.descrizione || '').trim()) throw new Error('Descrizione obbligatoria');
    if (!b.dare_id || !b.avere_id) throw new Error('Indica conto dare e conto avere');
    if (String(b.dare_id) === String(b.avere_id)) throw new Error('Dare e avere devono essere conti diversi');
    if (!(r2(b.importo) > 0)) throw new Error("L'importo deve essere maggiore di zero");
  };
  app.post('/api/contabilita/registrazioni', requireAdmin, (req, res) => {
    const b = req.body;
    try {
      validaReg(b);
      const anno = parseInt(b.anno) || parseInt(b.data.slice(0, 4));
      const r = db.prepare(`INSERT INTO cont_registrazioni(anno,data,doc,descrizione,dare_id,avere_id,importo) VALUES(?,?,?,?,?,?,?)`)
        .run(anno, b.data, b.doc || '', b.descrizione.trim(), b.dare_id, b.avere_id, r2(b.importo));
      res.json(db.prepare(`${SELECT_REG} WHERE r.id=?`).get(r.lastInsertRowid));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  const soloManuale = (req, res, next) => {
    const r = db.prepare('SELECT origine FROM cont_registrazioni WHERE id=?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Registrazione non trovata' });
    if (r.origine !== 'manuale')
      return res.status(400).json({ error: `Registrazione automatica: modificala dalla sezione ${r.origine === 'quota' ? 'Quote' : r.origine === 'spesa' ? 'Spese' : 'Trasferte'}` });
    next();
  };
  app.patch('/api/contabilita/registrazioni/:id', requireAdmin, soloManuale, (req, res) => {
    const b = req.body;
    try {
      validaReg(b);
      const anno = parseInt(b.anno) || parseInt(b.data.slice(0, 4));
      db.prepare('UPDATE cont_registrazioni SET anno=?,data=?,doc=?,descrizione=?,dare_id=?,avere_id=?,importo=? WHERE id=?')
        .run(anno, b.data, b.doc || '', b.descrizione.trim(), b.dare_id, b.avere_id, r2(b.importo), req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/contabilita/registrazioni/:id', requireAdmin, soloManuale, (req, res) => {
    const r = db.prepare('SELECT allegato FROM cont_registrazioni WHERE id=?').get(req.params.id);
    rimuoviFile(r?.allegato);
    db.prepare('DELETE FROM cont_registrazioni WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // Allegati (consentiti anche sulle registrazioni automatiche)
  app.post('/api/contabilita/registrazioni/:id/allegato', requireAdmin, (req, res, next) => {
    if (!db.prepare('SELECT 1 FROM cont_registrazioni WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Registrazione non trovata' });
    next();
  }, uploadAllegato.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File mancante' });
    const old = db.prepare('SELECT allegato FROM cont_registrazioni WHERE id=?').get(req.params.id);
    rimuoviFile(old?.allegato);
    db.prepare('UPDATE cont_registrazioni SET allegato=?, allegato_nome=? WHERE id=?').run(req.file.filename, req.file.originalname, req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/contabilita/registrazioni/:id/allegato', requireAdmin, (req, res) => {
    const r = db.prepare('SELECT allegato, allegato_nome FROM cont_registrazioni WHERE id=?').get(req.params.id);
    if (!r?.allegato) return res.status(404).json({ error: 'Nessun allegato' });
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.allegato_nome || r.allegato)}"`);
    res.sendFile(path.join(ALLEGATI_DIR, path.basename(r.allegato)));
  });
  app.delete('/api/contabilita/registrazioni/:id/allegato', requireAdmin, (req, res) => {
    const r = db.prepare('SELECT allegato FROM cont_registrazioni WHERE id=?').get(req.params.id);
    rimuoviFile(r?.allegato);
    db.prepare('UPDATE cont_registrazioni SET allegato=NULL, allegato_nome=NULL WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── API: BILANCIO E PREVENTIVO ─────────────────────────────────────
  app.get('/api/contabilita/bilancio', requireAdmin, (req, res) => {
    try { res.json(calcolaBilancio(req.query.anno || new Date().getFullYear())); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/contabilita/preventivo/:anno', requireAdmin, (req, res) => {
    try {
      const up = db.prepare('INSERT INTO cont_preventivo(anno,conto_id,importo) VALUES(?,?,?) ON CONFLICT(anno,conto_id) DO UPDATE SET importo=excluded.importo');
      const del = db.prepare('DELETE FROM cont_preventivo WHERE anno=? AND conto_id=?');
      db.transaction(() => (req.body || []).forEach(p => {
        if (p.importo === null || p.importo === '' || p.importo === undefined) del.run(req.params.anno, p.conto_id);
        else up.run(req.params.anno, p.conto_id, r2(p.importo));
      }))();
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // Copia il preventivo da un altro anno (es. base per l'anno nuovo)
  app.post('/api/contabilita/preventivo/:anno/copia-da/:da', requireAdmin, (req, res) => {
    db.prepare(`INSERT INTO cont_preventivo(anno,conto_id,importo) SELECT ?,conto_id,importo FROM cont_preventivo WHERE anno=?
                ON CONFLICT(anno,conto_id) DO UPDATE SET importo=excluded.importo`).run(req.params.anno, req.params.da);
    res.json({ ok: true });
  });

  // ── EXPORT ─────────────────────────────────────────────────────────
  app.get('/api/contabilita/export', requireAdmin, (req, res) => {
    const anno = parseInt(req.query.anno) || new Date().getFullYear();
    const formato = req.query.formato || 'csv';
    sincronizzaAutomatiche();
    const num = n => r2(n).toFixed(2);
    if (formato === 'banana') {
      // File di testo separato da tabulazioni con le intestazioni di colonna di Banana
      // (Data, Doc, Descrizione, Conto Dare, Conto Avere, Importo)
      const righe = db.prepare(`${SELECT_REG} WHERE r.anno=? ORDER BY r.data, r.id`).all(anno);
      const clean = s => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
      const txt = ['Date\tDoc\tDescription\tAccountDebit\tAccountCredit\tAmount',
        ...righe.map(r => [r.data, clean(r.doc), clean(r.descrizione), r.dare_num, r.avere_num, num(r.importo)].join('\t'))].join('\r\n');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ctr-registrazioni-${anno}-banana.txt"`);
      return res.send(txt);
    }
    const csv = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    let righe;
    if (formato === 'bilancio') {
      const b = calcolaBilancio(anno);
      const TIPI = { A: 'Attivo', P: 'Passivo', C: 'Costo', R: 'Ricavo' };
      righe = [['Conto', 'Descrizione', 'Tipo', 'Gruppo', 'Apertura', 'Dare', 'Avere', 'Saldo', 'Preventivo'],
        ...b.conti.filter(c => c.apertura || c.dare || c.avere || c.preventivo)
          .map(c => [c.numero, c.descrizione, TIPI[c.tipo], c.gruppo, num(c.apertura), num(c.dare), num(c.avere), num(c.saldo), c.preventivo === null ? '' : num(c.preventivo)]),
        [], ['', 'Totale attivi', '', '', '', '', '', num(b.totali.attivi)],
        ['', 'Totale passivi', '', '', '', '', '', num(b.totali.passivi)],
        ['', 'Risultato esercizi precedenti', '', '', '', '', '', num(b.totali.risultato_precedenti)],
        ['', `Risultato d'esercizio ${anno}`, '', '', '', '', '', num(b.totali.risultato)]];
    } else {
      righe = [['Data', 'Doc', 'Descrizione', 'Conto dare', 'Descrizione dare', 'Conto avere', 'Descrizione avere', 'Importo', 'Origine'],
        ...db.prepare(`${SELECT_REG} WHERE r.anno=? ORDER BY r.data, r.id`).all(anno)
          .map(r => [r.data, r.doc, r.descrizione, r.dare_num, r.dare_desc, r.avere_num, r.avere_desc, num(r.importo), r.origine])];
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ctr-${formato === 'bilancio' ? 'bilancio' : 'registrazioni'}-${anno}.csv"`);
    res.send('﻿' + righe.map(r => r.map(csv).join(';')).join('\r\n')); // BOM: Excel riconosce UTF-8
  });

  // ── RENDICONTO STAMPABILE (Salva come PDF dal browser) ─────────────
  app.get('/api/contabilita/rendiconto', requireAdmin, (req, res) => {
    try {
      const b = calcolaBilancio(req.query.anno || new Date().getFullYear());
      const { totali: T, anno } = b;
      const f = n => (n === null || n === undefined) ? '' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const vis = c => c.saldo || c.apertura || c.dare || c.avere || c.preventivo;
      const tab = (tipo, titolo, conPrev) => {
        const rows = b.conti.filter(c => c.tipo === tipo && vis(c));
        const tot = rows.reduce((s, c) => s + c.saldo, 0), totP = rows.reduce((s, c) => s + (c.preventivo || 0), 0);
        return `<table><thead><tr><th class="n">Conto</th><th>${titolo}</th>${conPrev ? '<th class="r">Preventivo</th>' : ''}<th class="r">${anno}</th>${conPrev ? '<th class="r">Scostamento</th>' : ''}</tr></thead><tbody>
          ${rows.map(c => `<tr><td class="n">${esc(c.numero)}</td><td>${esc(c.descrizione)}</td>${conPrev ? `<td class="r">${f(c.preventivo)}</td>` : ''}<td class="r">${f(c.saldo)}</td>${conPrev ? `<td class="r">${c.preventivo === null ? '' : f(c.saldo - c.preventivo)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="5" class="vuoto">Nessun movimento</td></tr>`}
          </tbody><tfoot><tr><td></td><td>Totale ${titolo.toLowerCase()}</td>${conPrev ? `<td class="r">${f(totP)}</td>` : ''}<td class="r">${f(tot)}</td>${conPrev ? `<td class="r">${f(tot - totP)}</td>` : ''}</tr></tfoot></table>`;
      };
      const oggi = new Date().toLocaleDateString('it-CH');
      res.send(`<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rendiconto ${anno} — CTR La Röda</title>
<style>
  *{box-sizing:border-box} body{font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;background:#eee}
  .pagina{background:#fff;max-width:210mm;margin:1.5rem auto;padding:16mm 15mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #5a8a1a;padding-bottom:8px;margin-bottom:14px}
  h1{font-size:20px;margin:0;color:#3d6010} .sub{font-size:11px;color:#666;margin-top:3px}
  h2{font-size:14px;margin:20px 0 6px;color:#3d6010;text-transform:uppercase;letter-spacing:.06em}
  .due{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}
  th{text-align:left;border-bottom:1.5px solid #333;padding:4px 5px;font-size:10px;text-transform:uppercase;color:#444}
  td{padding:3px 5px;border-bottom:1px solid #e3e3e3} .n{width:46px;color:#666} .r{text-align:right;white-space:nowrap}
  tfoot td{font-weight:bold;border-top:1.5px solid #333;border-bottom:none} .vuoto{color:#999;font-style:italic}
  .ris{display:flex;justify-content:space-between;font-weight:bold;font-size:13px;padding:8px 10px;background:#f1f6e8;border-left:4px solid #5a8a1a;margin:8px 0}
  .avviso{background:#fff4e5;border-left:4px solid #e67e22;padding:6px 10px;font-size:11px;margin:8px 0}
  .firme{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:40px;font-size:11px}
  .firme div{border-top:1px solid #333;padding-top:4px;text-align:center}
  .bar{max-width:210mm;margin:1rem auto;text-align:right} .bar button{background:#5a8a1a;color:#fff;border:0;padding:9px 18px;border-radius:5px;font-size:13px;cursor:pointer}
  @media print{body{background:#fff}.pagina{box-shadow:none;margin:0;max-width:none;padding:0}.bar{display:none}@page{size:A4;margin:14mm}}
</style></head><body>
<div class="bar"><button onclick="window.print()">🖨 Stampa / Salva PDF</button></div>
<div class="pagina">
  <header><div><h1>Ciclo Team La Röda</h1><div class="sub">Rendiconto dell'esercizio ${anno} · 1.1.${anno} – 31.12.${anno}</div></div><div class="sub">Stampato il ${oggi}</div></header>
  ${T.differenza ? `<div class="avviso">⚠ Il bilancio non quadra di CHF ${f(T.differenza)}: verificare i saldi di apertura.</div>` : ''}
  <h2>Bilancio al 31.12.${anno}</h2>
  <div class="due">
    <div>${tab('A', 'Attivi', false)}</div>
    <div>${tab('P', 'Passivi', false)}
      <table><tbody>
        <tr><td>Risultato esercizi precedenti</td><td class="r">${f(T.risultato_precedenti)}</td></tr>
        <tr><td>Risultato d'esercizio ${anno}</td><td class="r">${f(T.risultato)}</td></tr>
      </tbody><tfoot><tr><td>Totale passivi e capitale</td><td class="r">${f(T.passivi + T.risultato_precedenti + T.risultato)}</td></tr></tfoot></table>
    </div>
  </div>
  <h2>Conto economico ${anno}</h2>
  ${tab('R', 'Ricavi', true)}
  ${tab('C', 'Costi', true)}
  <div class="ris"><span>${T.risultato >= 0 ? 'Avanzo' : 'Disavanzo'} d'esercizio</span><span>CHF ${f(T.risultato)}</span></div>
  <div class="firme"><div>Il/La Presidente</div><div>Il/La Cassiere/a</div><div>I revisori dei conti</div></div>
</div></body></html>`);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── IMPORT DA BANANA ───────────────────────────────────────────────
  // Legge l'export "Excel" di Banana (SpreadsheetML / XML Excel 2003): fogli Accounts,
  // Journal (o Transactions) e FileInfo. Sostituisce piano dei conti e registrazioni.
  const uploadBanana = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

  const decodifica = t => t
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  function leggiSpreadsheetML(xml) {
    if (!/urn:schemas-microsoft-com:office:spreadsheet/.test(xml.slice(0, 3000)))
      throw new Error('Formato non riconosciuto: in Banana usa "Esporta file → Esporta in Excel"');
    const num = (tag, def) => { const m = xml.match(new RegExp(`<${tag}[^>]*>(\\d+)<`)); return m ? +m[1] : def; };
    const rigaNomi = num('RowFieldNameXml', 6), rigaDati = num('RowDataBegin', 12);
    const fogli = {};
    const reWs = /<Worksheet\b([^>]*)>([\s\S]*?)<\/Worksheet>/g;
    let w;
    while ((w = reWs.exec(xml))) {
      const nome = (w[1].match(/ss:Name="([^"]*)"/) || [])[1];
      const righe = [];
      const reRow = /<Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Row>)/g;
      let r, ri = 0;
      while ((r = reRow.exec(w[2]))) {
        const ix = (r[1].match(/ss:Index="(\d+)"/) || [])[1];
        ri = ix ? +ix : ri + 1;
        const celle = [];
        const reCell = /<Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Cell>)/g;
        let c, ci = 0;
        while ((c = reCell.exec(r[2] || ''))) {
          const cx = (c[1].match(/ss:Index="(\d+)"/) || [])[1];
          ci = cx ? +cx : ci + 1;
          const d = (c[2] || '').match(/<(?:ss:)?Data\b[^>]*?ss:Type="([^"]*)"[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/);
          if (d) { const v = decodifica(d[2]); celle[ci - 1] = d[1] === 'Number' ? parseFloat(v) : v; }
        }
        righe[ri - 1] = celle;
      }
      // Trasforma in oggetti usando la riga con i nomi XML delle colonne
      const nomi = righe[rigaNomi - 1] || [];
      fogli[nome] = righe.slice(rigaDati - 1).filter(Boolean).map(cells => {
        const o = {};
        nomi.forEach((n, i) => { if (n && cells[i] !== undefined && cells[i] !== '') o[n] = cells[i]; });
        return o;
      });
    }
    return fogli;
  }

  const data_ = v => {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  };
  const giornoDopo = d => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

  function analizzaBanana(buffer) {
    const fogli = leggiSpreadsheetML(buffer.toString('utf8'));
    const acc = fogli.Accounts, jr = fogli.Journal || fogli.Transactions;
    if (!acc) throw new Error('Nel file manca la tabella Conti (Accounts)');
    const info = {};
    (fogli.FileInfo || []).forEach(r => { if (r.IdXml) info[`${r.SectionXml}/${r.IdXml}`] = r.Value; });
    const avvisi = [];

    // Piano dei conti: righe con numero di conto e classe base 1..4
    const TIPO = { 1: 'A', 2: 'P', 3: 'C', 4: 'R' };
    const conti = []; let sezione = '';
    for (const r of acc) {
      if (!r.Account) {
        if (r.Description && r.Section && /^\d$/.test(String(r.Section)))
          sezione = String(r.Description).trim().toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());
        continue;
      }
      const tipo = TIPO[parseInt(r.BClass)];
      if (!tipo) { avvisi.push(`Conto ${r.Account} senza classe base 1-4: ignorato`); continue; }
      const numero = String(r.Account).trim();
      if (!/^\d{3,6}$/.test(numero)) { avvisi.push(`Conto "${numero}" non numerico: ignorato`); continue; }
      const op = r2(r.Opening || 0);
      conti.push({
        numero, descrizione: String(r.Description || numero).trim(), tipo,
        gruppo: tipo === 'A' && /^10/.test(numero) ? 'Liquidità' : sezione,
        attivo: r.Disable ? 0 : 1,
        apertura: (tipo === 'A' || tipo === 'C') ? op : -op, // in Banana: dare +, avere −
        budget: r.Budget !== undefined ? r2(r.Budget) : null,
      });
    }
    if (!conti.length) throw new Error('Nessun conto trovato nel file');
    const numeri = new Set(conti.map(c => c.numero));

    // Registrazioni
    const reg = [];
    (jr || []).forEach((r, i) => {
      if (r.Amount === undefined && !r.Description && !r.Date) return;
      const data = data_(r.Date), dare = String(r.AccountDebit || '').trim(), avere = String(r.AccountCredit || '').trim();
      const importo = r2(r.Amount), desc = String(r.Description || '').trim();
      const quale = `Registrazione ${data || '?'} "${desc}"`;
      if (!data) return avvisi.push(`${quale}: data mancante, saltata`);
      if (!dare || !avere) return avvisi.push(`${quale}: manca il conto ${!dare ? 'dare' : 'avere'} (registrazione su più righe), saltata`);
      if (!numeri.has(dare) || !numeri.has(avere)) return avvisi.push(`${quale}: conto ${!numeri.has(dare) ? dare : avere} non presente nel piano dei conti, saltata`);
      if (!(importo > 0)) return avvisi.push(`${quale}: importo ${importo} non valido, saltata`);
      reg.push({ data, doc: String(r.Doc || '').trim(), descrizione: desc || '(senza descrizione)', dare, avere, importo,
                 note: r.Notes ? String(r.Notes) : '' });
    });

    const apertura = data_(info['AccountingDataBase/OpeningDate']);
    const anno = apertura ? +apertura.slice(0, 4) : (reg[0] ? +reg[0].data.slice(0, 4) : new Date().getFullYear());
    const ultima = reg.reduce((m, r) => r.data > m ? r.data : m, '');
    const tot = t => r2(conti.filter(c => c.tipo === t).reduce((s, c) => s + c.apertura, 0));
    const ap = { attivi: tot('A'), passivi: tot('P'), ricavi: tot('R'), costi: tot('C') };
    ap.differenza = r2(ap.attivi - ap.passivi - (ap.ricavi - ap.costi));
    if (ap.differenza) avvisi.push(`I saldi di apertura non quadrano di CHF ${ap.differenza.toFixed(2)}`);

    return {
      intestazione: info['Base/HeaderLeft'] || '', anno, apertura_data: apertura,
      conti, registrazioni: reg, aperture: ap, ultima_data: ultima || null,
      automatiche_dal: ultima ? giornoDopo(ultima) : (apertura || `${anno}-01-01`),
      totale_registrazioni: r2(reg.reduce((s, r) => s + r.importo, 0)),
      mappatura: proponiMappatura(conti), avvisi,
    };
  }

  // Collega quote/spese/trasferte ai conti importati cercando per descrizione
  function proponiMappatura(conti) {
    const trova = (tipo, ...re) => {
      for (const x of re) { const c = conti.find(c => c.tipo === tipo && c.attivo && x.test(c.descrizione)); if (c) return c.numero; }
      return (conti.find(c => c.tipo === tipo && c.attivo) || {}).numero || null;
    };
    const cassa = trova('A', /cassa/i);
    const banca = trova('A', /banc|raiffeisen|ubs|credit|post|bcc|bps|migros|c\.c\./i);
    const quote = trova('R', /quot.*soci|tessere|soci/i);
    const trasf = trova('R', /trasfert|primaveril|viaggi/i, /manifest/i, /altri ricavi/i);
    const ricMan = trova('R', /manifest|uscit/i, /altri ricavi/i);
    const ricAltri = trova('R', /altri ricavi|divers/i);
    const ricMat = trova('R', /vestiar|materiale|merce/i, /altri ricavi/i);
    const cosMan = trova('C', /manifest/i, /uscit/i);
    const cosTrasf = trova('C', /trasfert|primaveril|viaggi/i, /manifest/i);
    const cosMat = trova('C', /vestiar|materiale|merce/i);
    const cosQuota = trova('C', /tass|federaz|licenz|cicloamatori|swiss cycling/i, /comitato/i);
    const cosAltri = trova('C', /altri costi|divers|comitato/i);
    return {
      metodi: { Contanti: cassa, Bonifico: banca, TWINT: banca, PayPal: banca },
      metodo_predefinito: banca, conto_quote: quote, conto_trasferte: trasf, spese_liquidita: banca,
      spese_categorie: {
        Uscita: { costo: cosMan, ricavo: ricMan }, Trasferta: { costo: cosTrasf, ricavo: trasf },
        Materiale: { costo: cosMat, ricavo: ricMat }, Quota: { costo: cosQuota, ricavo: quote },
        Altro: { costo: cosAltri, ricavo: ricAltri },
      },
    };
  }

  app.post('/api/contabilita/import-banana', requireAdmin, uploadBanana.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File mancante' });
    let a;
    try { a = analizzaBanana(req.file.buffer); } catch (e) { return res.status(400).json({ error: e.message }); }
    const esistenti = db.prepare(`SELECT
        SUM(origine='manuale') AS manuali, SUM(origine!='manuale') AS automatiche, SUM(allegato IS NOT NULL) AS allegati
      FROM cont_registrazioni`).get();
    const riepilogo = { ...a, esistenti: { manuali: esistenti.manuali || 0, automatiche: esistenti.automatiche || 0, allegati: esistenti.allegati || 0 } };
    if (req.query.conferma !== '1') return res.json({ anteprima: true, ...riepilogo });

    try {
      const allegati = db.prepare('SELECT allegato FROM cont_registrazioni WHERE allegato IS NOT NULL').all();
      db.transaction(() => {
        db.prepare('DELETE FROM cont_registrazioni').run();
        db.prepare('DELETE FROM cont_preventivo').run();
        db.prepare('DELETE FROM cont_conti').run();
        const insC = db.prepare('INSERT INTO cont_conti(numero,descrizione,tipo,gruppo,attivo,apertura) VALUES(?,?,?,?,?,?)');
        a.conti.forEach(c => insC.run(c.numero, c.descrizione, c.tipo, c.gruppo, c.attivo, c.apertura));
        const N = idDaNumero();
        const insP = db.prepare('INSERT INTO cont_preventivo(anno,conto_id,importo) VALUES(?,?,?)');
        a.conti.filter(c => c.budget !== null && c.budget !== 0)
          .forEach(c => insP.run(a.anno, N.get(c.numero), Math.abs(c.budget)));
        const insR = db.prepare('INSERT INTO cont_registrazioni(anno,data,doc,descrizione,dare_id,avere_id,importo,origine) VALUES(?,?,?,?,?,?,?,\'manuale\')');
        a.registrazioni.forEach(r => insR.run(+r.data.slice(0, 4), r.data, r.doc,
          r.note ? `${r.descrizione} – ${r.note}` : r.descrizione, N.get(r.dare), N.get(r.avere), r.importo));
        const up = db.prepare('INSERT INTO cont_impostazioni(chiave,valore) VALUES(?,?) ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore');
        const imp = { ...a.mappatura, anno_inizio: a.anno, automatiche_dal: a.automatiche_dal };
        Object.entries(imp).forEach(([k, v]) => up.run(k, JSON.stringify(v)));
      })();
      allegati.forEach(r => rimuoviFile(r.allegato));
      const avvisi = sincronizzaAutomatiche();
      const automatiche = db.prepare("SELECT COUNT(*) n FROM cont_registrazioni WHERE origine!='manuale'").get().n;
      res.json({ ok: true, ...riepilogo, automatiche_create: automatiche, avvisi_mappatura: avvisi });
    } catch (e) { res.status(500).json({ error: 'Import non riuscito, nessun dato modificato: ' + e.message }); }
  });

  // Allinea subito le registrazioni automatiche all'avvio
  try {
    const a = sincronizzaAutomatiche();
    if (a.length) console.warn('Contabilità:', a.join('; '));
  } catch (e) { console.error('Contabilità sync:', e.message); }
};
