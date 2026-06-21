# Ciclo Team La Röda — CTR1

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
```

### 4. Accesso
- **Sito pubblico**: URL generato da Railway
- **Admin**: username `ctr` / password `laroda2025`

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
- **Soci** — lista pubblica con ricerca e ordinamento
- **Uscite** — 10 uscite 2025, filtrabili per difficoltà
- **Gallery** — foto e video con upload reale
- **Admin** (ctr/laroda2025):
  - KPI quote e soci
  - Gestione soci completa (aggiungi/modifica/elimina)
  - Quote sociali 2025 e 2026
  - Trasferta Diano Marina 2026
  - Note interne
  - Grafico entrate mensili
  - Switcher valuta CHF/EUR
