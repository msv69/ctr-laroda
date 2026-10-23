// ════════════════════════════════════════════════════════════════════
//  Pannello admin — CONTABILITÀ A PARTITA DOPPIA
//  Usa le funzioni globali del sito: api(), toast(), escH(), apriConToken(), ANNO
// ════════════════════════════════════════════════════════════════════
(function () {
  const TIPI = { A: 'Attivo', P: 'Passivo', C: 'Costo', R: 'Ricavo' };
  const ORIGINI = { quota: 'Quota', spesa: 'Spesa', trasferta: 'Trasferta' };
  const st = { tab: 'registrazioni', conti: [], reg: [], bil: null, imp: null, filtroConto: '', cerca: '' };

  const chf = n => (Number(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const $ = id => document.getElementById(id);
  const contoLabel = c => c ? `${c.numero} ${c.descrizione}` : '—';
  const optsConti = (sel, filtro) => st.conti
    .filter(c => (c.attivo || String(c.id) === String(sel) || c.numero === sel) && (!filtro || filtro.includes(c.tipo)))
    .map(c => `<option value="${c.id}" ${String(c.id) === String(sel) ? 'selected' : ''}>${escH(contoLabel(c))}</option>`).join('');
  const optsNumeri = (sel, tipi) => st.conti
    .filter(c => tipi.includes(c.tipo))
    .map(c => `<option value="${escH(c.numero)}" ${c.numero === sel ? 'selected' : ''}>${escH(contoLabel(c))}</option>`).join('');

  // ── CARICAMENTO ────────────────────────────────────────────────────
  async function loadContabilita() {
    const lbl = $('cont-anno-label');
    if (!lbl) return;
    lbl.textContent = ANNO;
    try {
      const [conti, reg, bil] = await Promise.all([
        api('GET', '/contabilita/conti'),
        api('GET', '/contabilita/registrazioni?anno=' + ANNO),
        api('GET', '/contabilita/bilancio?anno=' + ANNO),
      ]);
      st.conti = conti; st.reg = reg.registrazioni; st.bil = bil;
      renderKpi();
      renderAvvisi(reg.avvisi);
      renderTab();
    } catch (e) {
      $('cont-pane').innerHTML = `<div class="empty">Contabilità non disponibile: ${escH(e.message)}</div>`;
    }
  }

  function renderKpi() {
    const T = st.bil.totali;
    $('cont-k-liq').textContent = 'CHF ' + chf(T.liquidita);
    $('cont-k-ric').textContent = 'CHF ' + chf(T.ricavi);
    $('cont-k-cos').textContent = 'CHF ' + chf(T.costi);
    const r = $('cont-k-ris');
    r.textContent = (T.risultato >= 0 ? '+' : '') + chf(T.risultato);
    r.style.color = T.risultato >= 0 ? 'var(--verde-chiaro)' : '#e74c3c';
  }

  function renderAvvisi(avvisi) {
    const T = st.bil.totali, out = [];
    if (T.differenza) out.push(`Il bilancio non quadra di CHF ${chf(T.differenza)}: controlla i saldi di apertura nel <a href="#" onclick="contTab('conti');return false">Piano dei conti</a>.`);
    (avvisi || []).forEach(a => out.push(`Registrazioni automatiche: ${escH(a)}. Correggi in <a href="#" onclick="contTab('impostazioni');return false">Impostazioni</a>.`));
    $('cont-avvisi').innerHTML = out.map(t => `<div class="cont-avviso">⚠ ${t}</div>`).join('');
  }

  function contTab(t) {
    st.tab = t;
    document.querySelectorAll('#cont-tabs .gtab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    renderTab();
  }

  function renderTab() {
    ({ registrazioni: renderRegistrazioni, bilancio: renderBilancio, preventivo: renderPreventivo,
       conti: renderConti, impostazioni: renderImpostazioni })[st.tab]();
  }

  // ── REGISTRAZIONI ──────────────────────────────────────────────────
  function renderRegistrazioni() {
    const fc = st.filtroConto, q = st.cerca.toLowerCase();
    let rows = st.reg.filter(r =>
      (!fc || String(r.dare_id) === fc || String(r.avere_id) === fc) &&
      (!q || `${r.doc} ${r.descrizione} ${r.dare_num} ${r.avere_num} ${r.importo}`.toLowerCase().includes(q)));
    // Scheda conto: saldo progressivo dall'apertura dell'esercizio
    let saldoProg = null, contoSel = null;
    if (fc) {
      contoSel = st.bil.conti.find(c => String(c.id) === fc);
      const segno = ['A', 'C'].includes(contoSel.tipo) ? 1 : -1;
      saldoProg = contoSel.apertura;
      rows = rows.map(r => {
        saldoProg += segno * ((String(r.dare_id) === fc ? r.importo : 0) - (String(r.avere_id) === fc ? r.importo : 0));
        return { ...r, _saldo: saldoProg };
      });
    }
    const tot = rows.reduce((s, r) => s + r.importo, 0);
    $('cont-pane').innerHTML = `
      <div class="cont-bar">
        <button class="btn bv2" onclick="contApriReg()">+ Nuova registrazione</button>
        <input class="sb" type="text" placeholder="🔍 Cerca..." value="${escH(st.cerca)}" oninput="contCerca(this.value)" style="flex:1;min-width:160px">
        <select onchange="contFiltroConto(this.value)" class="cont-sel" title="Scheda conto">
          <option value="">Tutti i conti</option>${optsConti(fc)}
        </select>
      </div>
      ${contoSel ? `<div class="cont-scheda">Scheda conto <strong>${escH(contoLabel(contoSel))}</strong> · Apertura CHF ${chf(contoSel.apertura)} · Saldo CHF ${chf(contoSel.saldo)}</div>` : ''}
      <div class="tw sc" style="padding:0;max-height:520px">
        <table class="cont-t"><thead><tr><th>Data</th><th>Doc</th><th>Descrizione</th><th>Dare</th><th>Avere</th><th class="r">Importo</th>${fc ? '<th class="r">Saldo</th>' : ''}<th></th></tr></thead>
        <tbody>${rows.length ? rows.map(r => `
          <tr>
            <td class="m">${r.data.split('-').reverse().join('.')}</td>
            <td class="m">${escH(r.doc || '')}</td>
            <td>${escH(r.descrizione)}${r.origine !== 'manuale' ? ` <span class="cont-auto" title="Registrazione automatica dalla sezione ${ORIGINI[r.origine]}">AUTO · ${ORIGINI[r.origine]}</span>` : ''}</td>
            <td class="m" title="${escH(r.dare_desc)}">${escH(r.dare_num)} <small>${escH(r.dare_desc)}</small></td>
            <td class="m" title="${escH(r.avere_desc)}">${escH(r.avere_num)} <small>${escH(r.avere_desc)}</small></td>
            <td class="r m">${chf(r.importo)}</td>
            ${fc ? `<td class="r m">${chf(r._saldo)}</td>` : ''}
            <td style="white-space:nowrap">
              ${r.allegato ? `<button class="btn bo bs2" onclick="contVediAllegato(${r.id})" title="Apri ricevuta">📎</button>` : ''}
              <button class="btn bo bs2" onclick="contApriReg(${r.id})" title="${r.origine === 'manuale' ? 'Modifica' : 'Dettagli e ricevuta'}">${r.origine === 'manuale' ? '✏️' : '🔍'}</button>
              ${r.origine === 'manuale' ? `<button class="btn br2 bs2" onclick="contEliminaReg(${r.id})" title="Elimina">🗑</button>` : ''}
            </td>
          </tr>`).join('') : `<tr><td colspan="9"><div class="empty">Nessuna registrazione${q || fc ? ' trovata' : ` nel ${ANNO}`}</div></td></tr>`}
        </tbody>
        ${rows.length ? `<tfoot><tr><td colspan="5">${rows.length} registrazioni</td><td class="r m">${chf(tot)}</td>${fc ? '<td></td>' : ''}<td></td></tr></tfoot>` : ''}
        </table>
      </div>`;
  }
  let cercaTimer;
  function contCerca(v) { st.cerca = v; clearTimeout(cercaTimer); cercaTimer = setTimeout(() => { renderRegistrazioni(); const i = document.querySelector('#cont-pane .sb'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 200); }
  function contFiltroConto(v) { st.filtroConto = v; st.tab = 'registrazioni'; contTab('registrazioni'); }

  function contApriReg(id) {
    const r = id ? st.reg.find(x => x.id === id) : null;
    const auto = r && r.origine !== 'manuale';
    $('mcr-id').value = r ? r.id : '';
    $('mcr-title').textContent = r ? (auto ? 'Registrazione automatica' : 'Modifica registrazione') : 'Nuova registrazione';
    $('mcr-data').value = r ? r.data : (String(ANNO) === String(new Date().getFullYear()) ? new Date().toISOString().slice(0, 10) : `${ANNO}-01-01`);
    $('mcr-doc').value = r ? r.doc || '' : '';
    $('mcr-desc').value = r ? r.descrizione : '';
    $('mcr-dare').innerHTML = '<option value="">— conto dare —</option>' + optsConti(r ? r.dare_id : '');
    $('mcr-avere').innerHTML = '<option value="">— conto avere —</option>' + optsConti(r ? r.avere_id : '');
    $('mcr-importo').value = r ? r.importo : '';
    ['mcr-data', 'mcr-doc', 'mcr-desc', 'mcr-dare', 'mcr-avere', 'mcr-importo'].forEach(i => $(i).disabled = !!auto);
    $('mcr-auto-note').style.display = auto ? 'block' : 'none';
    if (auto) $('mcr-auto-note').innerHTML = `Generata automaticamente dalla sezione <strong>${ORIGINI[r.origine]}</strong>: si aggiorna da sola quando modifichi i dati lì. Puoi comunque allegare la ricevuta.`;
    $('mcr-file').value = '';
    $('mcr-allegato-att').innerHTML = r && r.allegato
      ? `📎 Ricevuta allegata · <a href="#" onclick="contVediAllegato(${r.id});return false">apri</a> · <a href="#" onclick="contRimuoviAllegato(${r.id});return false" style="color:#e74c3c">rimuovi</a>`
      : '<span style="color:var(--gm)">Nessuna ricevuta allegata</span>';
    $('mcr-salva').textContent = auto ? 'Salva ricevuta' : 'Salva';
    $('modal-cont-reg').classList.add('open');
    if (!auto) setTimeout(() => $('mcr-desc').focus(), 50);
  }

  async function contSalvaReg() {
    const id = $('mcr-id').value;
    const r = id ? st.reg.find(x => String(x.id) === id) : null;
    const auto = r && r.origine !== 'manuale';
    const file = $('mcr-file').files[0];
    try {
      let regId = id;
      if (!auto) {
        const body = {
          data: $('mcr-data').value, doc: $('mcr-doc').value.trim(), descrizione: $('mcr-desc').value.trim(),
          dare_id: $('mcr-dare').value, avere_id: $('mcr-avere').value,
          importo: parseFloat(String($('mcr-importo').value).replace(',', '.')), anno: ANNO,
        };
        if (body.data && parseInt(body.data.slice(0, 4)) !== ANNO &&
            !confirm(`La data è del ${body.data.slice(0, 4)} ma stai registrando nell'esercizio ${ANNO}. Continuare?`)) return;
        if (id) await api('PATCH', '/contabilita/registrazioni/' + id, body);
        else regId = (await api('POST', '/contabilita/registrazioni', body)).id;
      }
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        await api('POST', `/contabilita/registrazioni/${regId}/allegato`, fd);
      }
      closeModal('modal-cont-reg');
      toast(auto ? '✅ Ricevuta salvata' : '✅ Registrazione salvata');
      await loadContabilita();
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function contEliminaReg(id) {
    const r = st.reg.find(x => x.id === id);
    if (!confirm(`Eliminare la registrazione "${r.descrizione}" di CHF ${chf(r.importo)}?`)) return;
    try { await api('DELETE', '/contabilita/registrazioni/' + id); toast('🗑️ Registrazione eliminata'); await loadContabilita(); }
    catch (e) { toast('❌ ' + e.message); }
  }
  const contVediAllegato = id => apriConToken(`/api/contabilita/registrazioni/${id}/allegato`);
  async function contRimuoviAllegato(id) {
    if (!confirm('Rimuovere la ricevuta allegata?')) return;
    try { await api('DELETE', `/contabilita/registrazioni/${id}/allegato`); closeModal('modal-cont-reg'); toast('🗑️ Ricevuta rimossa'); await loadContabilita(); }
    catch (e) { toast('❌ ' + e.message); }
  }

  // ── BILANCIO E CONTO ECONOMICO ─────────────────────────────────────
  function tabellaConti(tipo, titolo, extra) {
    const rows = st.bil.conti.filter(c => c.tipo === tipo && (c.saldo || c.apertura || c.dare || c.avere));
    const tot = rows.reduce((s, c) => s + c.saldo, 0);
    return `<table class="cont-t"><thead><tr><th colspan="2">${titolo}</th><th class="r">Saldo</th></tr></thead><tbody>
      ${rows.map(c => `<tr class="cont-click" onclick="contFiltroConto('${c.id}')" title="Apri scheda conto">
        <td class="m" style="width:52px">${escH(c.numero)}</td><td>${escH(c.descrizione)}</td><td class="r m">${chf(c.saldo)}</td></tr>`).join('')
        || '<tr><td colspan="3" style="color:var(--gm)">Nessun movimento</td></tr>'}
      ${extra || ''}
    </tbody><tfoot><tr><td colspan="2">Totale ${titolo.toLowerCase()}</td><td class="r m">${chf(tot + (tipo === 'P' ? st.bil.totali.risultato_precedenti + st.bil.totali.risultato : 0))}</td></tr></tfoot></table>`;
  }
  function renderBilancio() {
    const T = st.bil.totali;
    const extraPassivi = `
      <tr><td></td><td><em>Risultato esercizi precedenti</em></td><td class="r m">${chf(T.risultato_precedenti)}</td></tr>
      <tr><td></td><td><em>Risultato d'esercizio ${ANNO}</em></td><td class="r m" style="color:${T.risultato >= 0 ? 'var(--verde-chiaro)' : '#e74c3c'}">${chf(T.risultato)}</td></tr>`;
    $('cont-pane').innerHTML = `
      <div class="cont-sub">Bilancio al 31.12.${ANNO}</div>
      <div class="cont-2col"><div>${tabellaConti('A', 'Attivi')}</div><div>${tabellaConti('P', 'Passivi', extraPassivi)}</div></div>
      <div class="cont-sub">Conto economico ${ANNO}</div>
      <div class="cont-2col"><div>${tabellaConti('R', 'Ricavi')}</div><div>${tabellaConti('C', 'Costi')}</div></div>
      <div class="cont-ris" style="border-left-color:${T.risultato >= 0 ? 'var(--verde)' : 'var(--rosso)'}">
        <span>${T.risultato >= 0 ? 'Avanzo' : 'Disavanzo'} d'esercizio ${ANNO}</span><span>CHF ${chf(T.risultato)}</span></div>
      <div style="font-size:.75rem;color:var(--gc);margin-top:.6rem">Clicca su un conto per vederne la scheda con i movimenti.</div>`;
  }

  // ── PREVENTIVO VS CONSUNTIVO ───────────────────────────────────────
  function renderPreventivo() {
    const blocco = (tipo, titolo) => {
      const rows = st.bil.conti.filter(c => c.tipo === tipo && (c.attivo || c.saldo || c.preventivo !== null));
      const totP = rows.reduce((s, c) => s + (c.preventivo || 0), 0), totC = rows.reduce((s, c) => s + c.saldo, 0);
      return `<tr class="cont-gr"><td colspan="6">${titolo}</td></tr>
        ${rows.map(c => {
          const sc = c.preventivo === null ? null : c.saldo - c.preventivo;
          const pct = c.preventivo ? Math.round(c.saldo / c.preventivo * 100) : null;
          // per i costi superare il preventivo è negativo, per i ricavi è positivo
          const male = sc !== null && (tipo === 'C' ? sc > 0 : sc < 0);
          return `<tr><td class="m" style="width:52px">${escH(c.numero)}</td><td>${escH(c.descrizione)}</td>
            <td class="r"><input class="cont-in" type="number" step="0.05" data-conto="${c.id}" value="${c.preventivo ?? ''}" placeholder="—"></td>
            <td class="r m">${chf(c.saldo)}</td>
            <td class="r m" style="color:${sc === null || !sc ? 'inherit' : male ? '#e74c3c' : 'var(--verde-chiaro)'}">${sc === null ? '' : (sc > 0 ? '+' : '') + chf(sc)}</td>
            <td style="width:120px">${pct === null ? '' : `<div class="cont-bar-pct"><div style="width:${Math.min(pct, 100)}%;background:${male ? 'var(--rosso)' : 'var(--verde)'}"></div></div><small class="m">${pct}%</small>`}</td></tr>`;
        }).join('')}
        <tr class="cont-tot"><td></td><td>Totale ${titolo.toLowerCase()}</td><td class="r m">${chf(totP)}</td><td class="r m">${chf(totC)}</td><td class="r m">${chf(totC - totP)}</td><td></td></tr>`;
    };
    const T = st.bil.totali;
    $('cont-pane').innerHTML = `
      <div class="cont-bar">
        <button class="btn bv2" onclick="contSalvaPreventivo()">💾 Salva preventivo</button>
        <button class="btn bo" onclick="contCopiaPreventivo()">Copia dal ${ANNO - 1}</button>
        <span style="font-size:.78rem;color:var(--gc);margin-left:auto">Risultato preventivato: <strong class="m">CHF ${chf(T.preventivo_ricavi - T.preventivo_costi)}</strong> · consuntivo: <strong class="m">CHF ${chf(T.risultato)}</strong></span>
      </div>
      <div class="tw" style="padding:0"><table class="cont-t">
        <thead><tr><th colspan="2">Conto</th><th class="r">Preventivo</th><th class="r">Consuntivo</th><th class="r">Scostamento</th><th>Utilizzo</th></tr></thead>
        <tbody>${blocco('R', 'Ricavi')}${blocco('C', 'Costi')}</tbody></table></div>`;
  }
  async function contSalvaPreventivo() {
    const dati = [...document.querySelectorAll('#cont-pane .cont-in[data-conto]')]
      .map(i => ({ conto_id: +i.dataset.conto, importo: i.value === '' ? null : parseFloat(i.value) }));
    try { await api('PUT', '/contabilita/preventivo/' + ANNO, dati); toast('✅ Preventivo salvato'); await loadContabilita(); }
    catch (e) { toast('❌ ' + e.message); }
  }
  async function contCopiaPreventivo() {
    if (!confirm(`Copiare nel ${ANNO} il preventivo del ${ANNO - 1}? I valori già inseriti per gli stessi conti verranno sostituiti.`)) return;
    try { await api('POST', `/contabilita/preventivo/${ANNO}/copia-da/${ANNO - 1}`); toast('✅ Preventivo copiato'); await loadContabilita(); }
    catch (e) { toast('❌ ' + e.message); }
  }

  // ── PIANO DEI CONTI E SALDI DI APERTURA ────────────────────────────
  function renderConti() {
    const somma = t => st.conti.filter(c => c.tipo === t).reduce((s, c) => s + (c.apertura || 0), 0);
    const sA = somma('A'), sP = somma('P'), sRis = somma('R') - somma('C');
    const diff = Math.round((sA - sP - sRis) * 100) / 100;
    const inizio = st.bil.anno_inizio;
    const gruppi = ['A', 'P', 'R', 'C'];
    $('cont-pane').innerHTML = `
      <div class="cont-bar">
        <button class="btn bv2" onclick="contApriConto()">+ Nuovo conto</button>
        <button class="btn bo" onclick="contSalvaAperture()">💾 Salva saldi di apertura</button>
        <span style="font-size:.78rem;margin-left:auto;color:${diff ? '#e74c3c' : 'var(--gc)'}">Apertura ${inizio}: attivi CHF ${chf(sA)} · passivi CHF ${chf(sP)}${sRis ? ` · risultato iniziale CHF ${chf(sRis)}` : ''}${diff ? ` · <strong>differenza CHF ${chf(diff)}</strong>` : ' · ✓ in pari'}</span>
      </div>
      <div style="font-size:.75rem;color:var(--gc);margin:-.3rem 0 .8rem">Saldi di apertura all'inizio della contabilità (esercizio ${inizio}): per attivi e passivi è quanto c'era il primo giorno; per ricavi e costi sono eventuali importi del ${inizio} non registrati in dettaglio (come in Banana). Gli anni successivi ripartono in automatico dai saldi di chiusura.</div>
      <div class="tw sc" style="padding:0;max-height:560px"><table class="cont-t">
        <thead><tr><th>Conto</th><th>Descrizione</th><th>Gruppo</th><th class="r">Apertura</th><th class="r">Movim.</th><th></th></tr></thead>
        <tbody>${gruppi.map(t => `<tr class="cont-gr"><td colspan="6">${TIPI[t]}i</td></tr>` + st.conti.filter(c => c.tipo === t).map(c => `
          <tr style="${c.attivo ? '' : 'opacity:.45'}">
            <td class="m">${escH(c.numero)}</td><td>${escH(c.descrizione)}${c.attivo ? '' : ' <small>(disattivato)</small>'}</td>
            <td style="color:var(--gc);font-size:.8rem">${escH(c.gruppo || '')}</td>
            <td class="r"><input class="cont-in" type="number" step="0.05" data-apertura="${c.id}" value="${c.apertura || ''}" placeholder="0"></td>
            <td class="r m">${c.n_movimenti || ''}</td>
            <td style="white-space:nowrap"><button class="btn bo bs2" onclick="contApriConto(${c.id})">✏️</button>
              ${c.n_movimenti ? '' : `<button class="btn br2 bs2" onclick="contEliminaConto(${c.id})">🗑</button>`}</td>
          </tr>`).join('')).join('')}
        </tbody></table></div>`;
  }
  async function contSalvaAperture() {
    const dati = [...document.querySelectorAll('#cont-pane [data-apertura]')].map(i => ({ id: +i.dataset.apertura, apertura: parseFloat(i.value) || 0 }));
    try { await api('PUT', '/contabilita/aperture', dati); toast('✅ Saldi di apertura salvati'); await loadContabilita(); }
    catch (e) { toast('❌ ' + e.message); }
  }
  function contApriConto(id) {
    const c = id ? st.conti.find(x => x.id === id) : null;
    $('mcc-id').value = c ? c.id : '';
    $('mcc-title').textContent = c ? 'Modifica conto' : 'Nuovo conto';
    $('mcc-numero').value = c ? c.numero : '';
    $('mcc-desc').value = c ? c.descrizione : '';
    $('mcc-tipo').value = c ? c.tipo : 'C';
    $('mcc-gruppo').value = c ? c.gruppo || '' : '';
    $('mcc-attivo').checked = c ? !!c.attivo : true;
    $('mcc-apertura').value = c ? c.apertura || 0 : 0;
    $('modal-cont-conto').classList.add('open');
  }
  async function contSalvaConto() {
    const id = $('mcc-id').value;
    const body = { numero: $('mcc-numero').value.trim(), descrizione: $('mcc-desc').value.trim(), tipo: $('mcc-tipo').value,
      gruppo: $('mcc-gruppo').value.trim(), attivo: $('mcc-attivo').checked ? 1 : 0, apertura: parseFloat($('mcc-apertura').value) || 0 };
    try {
      if (id) await api('PATCH', '/contabilita/conti/' + id, body); else await api('POST', '/contabilita/conti', body);
      closeModal('modal-cont-conto'); toast('✅ Conto salvato'); await loadContabilita();
    } catch (e) { toast('❌ ' + e.message); }
  }
  async function contEliminaConto(id) {
    const c = st.conti.find(x => x.id === id);
    if (!confirm(`Eliminare il conto ${c.numero} ${c.descrizione}?`)) return;
    try { await api('DELETE', '/contabilita/conti/' + id); toast('🗑️ Conto eliminato'); await loadContabilita(); }
    catch (e) { toast('❌ ' + e.message); }
  }

  // ── IMPOSTAZIONI DELLE REGISTRAZIONI AUTOMATICHE ───────────────────
  async function renderImpostazioni() {
    if (!st.imp) { try { st.imp = await api('GET', '/contabilita/impostazioni'); } catch (e) { toast('❌ ' + e.message); return; } }
    const S = st.imp;
    const riga = (label, id, val, tipi) => `<div class="fg"><label>${label}</label><select id="${id}">${optsNumeri(val, tipi)}</select></div>`;
    $('cont-pane').innerHTML = `
      <div style="font-size:.8rem;color:var(--gc);margin-bottom:1rem">Quote pagate, spese e iscrizioni alle trasferte vengono registrate in contabilità automaticamente con questi conti. Se cambi un'impostazione, le registrazioni automatiche esistenti vengono aggiornate.</div>
      <div class="cont-2col" style="margin-bottom:1rem">
        <div class="cont-box"><div class="fg" style="margin:0"><label>Esercizio di inizio della contabilità</label>
          <input id="ci-anno-inizio" type="number" min="2000" max="2100" value="${S.anno_inizio ?? ''}" placeholder="${st.bil.anno_inizio}">
          <div style="font-size:.72rem;color:var(--gc);margin-top:.35rem">I saldi di apertura valgono da questo anno. Vuoto = primo anno con registrazioni.</div></div></div>
        <div class="cont-box"><div class="fg" style="margin:0"><label>Registrazioni automatiche a partire dal</label>
          <input id="ci-auto-dal" type="date" value="${S.automatiche_dal ?? ''}">
          <div style="font-size:.72rem;color:var(--gc);margin-top:.35rem">Quote, spese e trasferte con data precedente non vengono registrate (es. già presenti nella contabilità importata da Banana). Vuoto = tutte.</div></div></div>
      </div>
      <div class="cont-2col">
        <div class="cont-box"><div class="cont-sub" style="margin-top:0">Incassi per metodo di pagamento</div>
          ${Object.keys(S.metodi).map(m => riga(m, 'ci-met-' + m, S.metodi[m], ['A'])).join('')}
          ${riga('Metodo non indicato', 'ci-met-def', S.metodo_predefinito, ['A'])}
        </div>
        <div class="cont-box"><div class="cont-sub" style="margin-top:0">Conti di ricavo e liquidità</div>
          ${riga('Quote sociali → ricavo', 'ci-quote', S.conto_quote, ['R'])}
          ${riga('Iscrizioni trasferte → ricavo', 'ci-trasf', S.conto_trasferte, ['R'])}
          ${riga('Spese pagate / incassate da', 'ci-spese-liq', S.spese_liquidita, ['A'])}
        </div>
      </div>
      <div class="cont-box" style="margin-top:1rem"><div class="cont-sub" style="margin-top:0">Categorie delle spese</div>
        <table class="cont-t"><thead><tr><th>Categoria</th><th>Importo speso → costo</th><th>Incassato → ricavo</th></tr></thead><tbody>
        ${Object.keys(S.spese_categorie).map(k => `<tr><td>${escH(k)}</td>
          <td><select class="cont-sel" id="ci-cat-c-${k}">${optsNumeri(S.spese_categorie[k].costo, ['C'])}</select></td>
          <td><select class="cont-sel" id="ci-cat-r-${k}">${optsNumeri(S.spese_categorie[k].ricavo, ['R'])}</select></td></tr>`).join('')}
        </tbody></table>
      </div>
      <div style="margin-top:1rem"><button class="btn bv2" onclick="contSalvaImpostazioni()">💾 Salva impostazioni</button></div>`;
  }
  async function contSalvaImpostazioni() {
    const S = st.imp;
    const ai = parseInt($('ci-anno-inizio').value);
    const body = {
      anno_inizio: ai || null, automatiche_dal: $('ci-auto-dal').value || null,
      metodi: Object.fromEntries(Object.keys(S.metodi).map(m => [m, $('ci-met-' + m).value])),
      metodo_predefinito: $('ci-met-def').value,
      conto_quote: $('ci-quote').value, conto_trasferte: $('ci-trasf').value, spese_liquidita: $('ci-spese-liq').value,
      spese_categorie: Object.fromEntries(Object.keys(S.spese_categorie).map(k => [k, { costo: $('ci-cat-c-' + k).value, ricavo: $('ci-cat-r-' + k).value }])),
    };
    try {
      const r = await api('PUT', '/contabilita/impostazioni', body);
      st.imp = null;
      toast(r.avvisi?.length ? '⚠️ Salvato con avvisi' : '✅ Impostazioni salvate');
      await loadContabilita();
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ── IMPORT DA BANANA ───────────────────────────────────────────────
  let importFile = null;
  function contApriImport() {
    importFile = null;
    $('mci-file').value = '';
    $('mci-esito').innerHTML = '';
    $('mci-conferma').style.display = 'none';
    $('modal-cont-import').classList.add('open');
  }
  async function contAnalizzaImport() {
    importFile = $('mci-file').files[0];
    if (!importFile) return toast('⚠️ Scegli il file esportato da Banana');
    $('mci-esito').innerHTML = '<div class="ld">Analisi del file</div>';
    $('mci-conferma').style.display = 'none';
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const a = await api('POST', '/contabilita/import-banana', fd);
      const TIPI_PL = { A: 'Attivi', P: 'Passivi', R: 'Ricavi', C: 'Costi' };
      const per = t => a.conti.filter(c => c.tipo === t).length;
      const E = a.esistenti, daSostituire = E.manuali + E.automatiche;
      const fmtD = d => d ? d.split('-').reverse().join('.') : '—';
      $('mci-esito').innerHTML = `
        <div class="cont-box" style="margin-top:1rem">
          <div style="font-weight:600;margin-bottom:.5rem">${escH(a.intestazione || 'Contabilità Banana')} · esercizio ${a.anno}</div>
          <table class="cont-t"><tbody>
            <tr><td>Piano dei conti</td><td class="r m">${a.conti.length} conti</td><td style="color:var(--gc);font-size:.78rem">${['A', 'P', 'R', 'C'].map(t => `${per(t)} ${TIPI_PL[t].toLowerCase()}`).join(' · ')}</td></tr>
            <tr><td>Registrazioni</td><td class="r m">${a.registrazioni.length}</td><td style="color:var(--gc);font-size:.78rem">${a.registrazioni.length ? `dal ${fmtD(a.registrazioni[0].data)} al ${fmtD(a.ultima_data)} · CHF ${chf(a.totale_registrazioni)}` : ''}</td></tr>
            <tr><td>Aperture</td><td class="r m">${a.aperture.differenza ? '⚠' : '✓'}</td><td style="color:var(--gc);font-size:.78rem">attivi ${chf(a.aperture.attivi)} · passivi ${chf(a.aperture.passivi)} · risultato iniziale ${chf(a.aperture.ricavi - a.aperture.costi)}${a.aperture.differenza ? ` · <span style="color:#e74c3c">differenza ${chf(a.aperture.differenza)}</span>` : ''}</td></tr>
            <tr><td>Automatiche dal</td><td class="r m">${fmtD(a.automatiche_dal)}</td><td style="color:var(--gc);font-size:.78rem">quote, spese e trasferte precedenti sono già nella contabilità di Banana</td></tr>
          </tbody></table>
          <div style="font-size:.78rem;color:var(--gc);margin-top:.7rem">Collegamenti proposti: quote → <span class="m">${escH(a.mappatura.conto_quote || '?')}</span>, contanti → <span class="m">${escH(a.mappatura.metodi.Contanti || '?')}</span>, bonifico/TWINT → <span class="m">${escH(a.mappatura.metodi.Bonifico || '?')}</span>, trasferte → <span class="m">${escH(a.mappatura.conto_trasferte || '?')}</span>. Puoi cambiarli dopo in Impostazioni.</div>
        </div>
        ${a.avvisi.map(t => `<div class="cont-avviso" style="margin-top:.6rem">⚠ ${escH(t)}</div>`).join('')}
        <div class="cont-avviso" style="margin-top:.6rem;border-left-color:var(--rosso);background:rgba(192,57,43,.12)">L'import <strong>sostituisce</strong> il piano dei conti attuale${daSostituire ? ` e le ${daSostituire} registrazioni presenti${E.manuali ? ` (di cui ${E.manuali} inserite a mano)` : ''}${E.allegati ? ` con ${E.allegati} ricevute allegate` : ''}. Le automatiche verranno ricreate sui nuovi conti. Scarica prima un backup se vuoi conservarle` : ''}.</div>`;
      $('mci-conferma').style.display = 'inline-block';
    } catch (e) { $('mci-esito').innerHTML = `<div class="cont-avviso" style="margin-top:1rem">❌ ${escH(e.message)}</div>`; }
  }
  async function contConfermaImport() {
    if (!importFile) return;
    if (!confirm('Confermi l\'import? Il piano dei conti e le registrazioni attuali verranno sostituiti.')) return;
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const r = await api('POST', '/contabilita/import-banana?conferma=1', fd);
      closeModal('modal-cont-import');
      st.imp = null; st.filtroConto = ''; st.cerca = '';
      if (r.anno && r.anno !== ANNO && typeof changeAnno === 'function') { try { changeAnno(r.anno); const sel = $('anno-select'); if (sel) sel.value = r.anno; } catch (e) {} }
      toast(`✅ Importati ${r.conti.length} conti e ${r.registrazioni.length} registrazioni`);
      await loadContabilita();
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ── EXPORT E RENDICONTO ────────────────────────────────────────────
  // Download diretto (senza lasciare una scheda vuota aperta)
  async function contExport(formato) {
    try {
      const r = await api('POST', '/link-token');
      const a = document.createElement('a');
      a.href = `/api/contabilita/export?anno=${ANNO}&formato=${formato}&t=${encodeURIComponent(r.token)}`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('❌ ' + e.message); }
  }
  const contRendiconto = () => apriConToken(`/api/contabilita/rendiconto?anno=${ANNO}`);

  // Quote, spese e trasferte generano registrazioni automatiche: dopo ogni loro
  // salvataggio/eliminazione il pannello le ricarica, e qui aggiorniamo anche la contabilità.
  let timerAgg;
  const aggiornaContabilitaPresto = () => {
    clearTimeout(timerAgg);
    timerAgg = setTimeout(() => {
      if (typeof ADMIN_TOKEN !== 'undefined' && ADMIN_TOKEN && $('cont-anno-label')) loadContabilita();
    }, 400);
  };
  ['loadQuote', 'loadSpese', 'loadTrasferte'].forEach(nome => {
    const originale = window[nome];
    if (typeof originale !== 'function') return;
    window[nome] = async function (...args) {
      const r = await originale.apply(this, args);
      aggiornaContabilitaPresto();
      return r;
    };
  });

  Object.assign(window, {
    loadContabilita, contTab, contCerca, contFiltroConto, contApriReg, contSalvaReg, contEliminaReg, contVediAllegato,
    contRimuoviAllegato, contSalvaPreventivo, contCopiaPreventivo, contSalvaAperture, contApriConto, contSalvaConto,
    contEliminaConto, contSalvaImpostazioni, contExport, contRendiconto, contApriImport, contAnalizzaImport, contConfermaImport,
  });
})();
