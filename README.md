# Ciclo Team La Röda — CTR 
  
Sito web del club ciclistico amatoriale. Backend Node.js + SQLite, frontend SPA.

## Deploy su Railway

### 1. Carica su GitHub
```bash
git init
git add .
git commit -m "CTR La Röda v1.0"
git remote add origin https://github.com/TUO-UTENTE/ctr-laroda.git
git push -u origin main
```

### 2. Deploy su Railway
1. Vai su [railway.app](https://railway.app) → **New Project**
2. Scegli **Deploy from GitHub repo**
3. Seleziona il repo `ctr-laroda`
4. Railway rileva automaticamente Node.js e fa il deploy

### 3. Volume persistente (importante per SQLite e upload)
Su Railway, i dati vanno persi ad ogni deploy senza un volume.

In Railway → tuo progetto → **Add Volume**:
- Mount path: `/app/data` (per il database)
- Aggiungi anche `/app/public/uploads` (per foto e video)

Poi aggiungi le variabili d'ambiente:
```
DB_PATH=/app/data/ctr.db
UPLOAD_DIR=/app/public/uploads
PORT=3000
ADMIN_USER=ctr                 # opzionale, default "ctr"
ADMIN_PWD=<password robusta>   # obbligatoria per l'area admin
TOKEN_SECRET=<stringa casuale lunga>   # es. output di: openssl rand -hex 32
```

### 4. Accesso
- **Sito pubblico**: URL generato da Railway
- **Admin**: username `ADMIN_USER` e password `ADMIN_PWD` impostati nelle Variables di Railway (mai nel codice)

## Sviluppo locale
```bash
npm install
npm start
# → http://localhost:3000
```

## Struttura
```
ctr/
├── server.js          # Backend Express + SQLite
├── public/
│   ├── index.html     # Frontend SPA
│   └── uploads/       # Foto e video caricati
├── data/
│   └── ctr.db         # Database SQLite (creato automaticamente)
├── railway.toml       # Configurazione Railway
└── package.json
```

## Funzionalità
- **Home** — hero, statistiche, ultime news
- **News** — 6 articoli del club
- **Soci** — il socio vede solo i propri dati; l'elenco completo è riservato all'admin
- **Uscite** — 10 uscite 2025, filtrabili per difficoltà
- **Gallery** — foto e video con upload reale
- **Admin** (credenziali da variabili d'ambiente):
  - KPI quote e soci
  - Gestione soci completa (aggiungi/modifica/elimina)
  - Quote sociali 2025 e 2026
  - Trasferta Diano Marina 2026
  - Note interne
  - Grafico entrate mensili
  - Switcher valuta CHF/EUR

## Sicurezza
- Login admin verificato dal server; il browser riceve un token firmato (HMAC) valido 12 ore.
- Login socio (tessera + cognome) → token valido 180 giorni che autorizza solo i dati di quel socio.
- Lettura pubblica: news, uscite, gallery, documenti, numero soci. Tutto il resto richiede un token.
- I login sono limitati a 10 tentativi ogni 15 minuti per IP.

## Contabilità (pannello admin)
Contabilità a partita doppia in stile Banana.ch, nel pannello admin → **📒 Contabilità**.
- **Piano dei conti** modificabile (attivi, passivi, ricavi, costi) con saldi di apertura.
- **Registrazioni** con data, documento, conto dare, conto avere, importo e ricevuta allegata (PDF/foto, privata).
- **Automatiche**: quote pagate, spese e iscrizioni alle trasferte generano da sole le registrazioni
  (conti configurabili in *Impostazioni*). Si aggiornano quando cambi i dati di origine.
- **Bilancio e conto economico** per esercizio; i saldi patrimoniali si riportano da soli all'anno successivo.
- **Preventivo vs consuntivo** per conto.
- **Export**: CSV per Excel (registrazioni e bilancio) e file `.txt` importabile in Banana
  (colonne Date, Doc, Description, AccountDebit, AccountCredit, Amount).
- **Rendiconto stampabile** (Stampa → Salva come PDF) con bilancio, conto economico e firme.

- **Import da Banana**: in Banana *File → Esporta file → Esporta in Excel*, poi nel pannello *⬆ Importa da Banana*.
  Importa piano dei conti, aperture (anche su ricavi/costi), preventivo e registrazioni, con anteprima prima di confermare.
  Le registrazioni automatiche partono dal giorno dopo l'ultima registrazione importata, per non duplicare.

Codice: `contabilita.js` (API) e `public/contabilita.js` (interfaccia). Le ricevute stanno in `DATA_DIR/allegati`
(non pubbliche) e sono incluse nel backup.
