// llm-bridge v2.2.0 — mini-service Bun :3015 (cascade multi-provider, côté serveur)
//
// v2.2.0 (TODO HUD — 10.9.4) : sélecteur de modèle côté UI. Le pont expose :
//   - /statut + /modeles : liste models: [{id, name, provider, active, local,
//     up}] — cloud (catalogue pollinations /openai/models, cache 10 min,
//     openai-fast garanti ; zai-principal ; zai-alternatif) + LOCAUX détectés
//     best-effort (Ollama :11434/api/tags, LM Studio :1234/v1/models,
//     llama.cpp :8080/v1/models — timeout 1,5 s, silencieux si absent) ;
//   - POST /modeles : rafraîchissement manuel (catalogue + scan locaux) ;
//   - POST /complete accepte "model": id choisi (pollinations:X, zai-principal,
//     zai-alternatif, ollama:tag, lmstudio:id, llamacpp:id) → route DIRECTE vers
//     ce modèle ; en cas d'échec → CASCADE normale + "repli": true (jamais
//     d'erreur visible, N4 inchangé ; le repli est un booléen neutre).
//
// v2.1.0 (TODO gratuit — 10.9.3) : l'upstream ZAI reste saturé (429 par fenêtres,
// quota externe épuisé). Ajout d'un provider PRIMAIRE gratuit SANS clé :
//
//   1. POLLINATIONS (primaire) — https://text.pollinations.ai/openai
//      POST {base}/chat/completions, modèle « openai-fast » (gpt-oss-20b),
//      AUCUNE clé requise (tier anonymous). Peut être lent (5–30 s observés)
//      → timeout par tentative 40 s. Jamais le nom du provider ne sort du pont.
//   2. Cascade complète : pollinations → zai-principal → zai-alternatif.
//      Tout échec d'un provider (429/5xx/timeout/vide) → provider suivant ;
//      liste épuisée → backoff puis nouveau tour (RETRIES_MAX tours).
//      Les ZAI partagent un bucket de quota : un 429 sur l'un skip l'autre
//      au même tour (changer de modèle ZAI n'aide pas).
//   3. CIRCUIT-BREAKER PAR PROVIDER : 8 échecs consécutifs d'un provider →
//      il est mis en pause 20 s (skip immédiat), les autres continuent de
//      servir. llm_disponible = au moins un provider non-pausé.
//   4. TÉLÉMÉTRIE : /statut et /sante exposent
//      providers: [{name, up, last_status, ok, erreurs, ...}] (serveur only).
//
// Conservé de v2.0.0 (incident P0 502/429, 10.9.2) :
//   - CONTRAT D'ERREUR STRUCTURÉ {"erreur": phrase neutre, "code"} — le détail
//     technique (status/corps upstream, URL, provider) reste dans les LOGS.
//   - Retries exponentiels bornés + jitter, limiteur de concurrence (2 en vol,
//     espacement 250 ms, admission 25 s), cache LRU (60 × TTL 15 min) servi en
//     pause, GET /statut, GET /sante + llm_disponible.
//
// Contrats inchangés : GET /sante, POST /complete, POST /search.
// Aucun CORS (serveur-à-serveur). Aucun détail d'infrastructure ne franchit
// la frontière HTTP : les messages d'erreur sont des phrases neutres.
import ZAI from 'z-ai-web-dev-sdk';

const PORT = 3015; // port FIXE — jamais process.env.PORT
const VERSION = '2.2.0';

// ---- Réglages résilience -------------------------------------------------
const RETRIES_MAX = 3;                    // tours de cascade supplémentaires
const BACKOFF_BASE_MS = 300;              // 300 → 700 → 1500 (± 30 % jitter)
const BACKOFF_CAP_MS = 1600;
const BUDGET_TOTAL_MS = 55_000;           // plafond global /complete
const CONCURRENCE_MAX = 2;                // appels upstream simultanés
const ESPACEMENT_MIN_MS = 250;            // entre deux DÉPARTS upstream
const QUEUE_TIMEOUT_MS = 25_000;          // attente max dans la file
const SEUIL_CIRCUIT = 8;                  // échecs consécutifs d'UN provider → pause
const CIRCUIT_OUVERT_MS = 20_000;
const CACHE_TAILLE = 60;
const CACHE_TTL_MS = 15 * 60_000;

// Provider gratuit sans clé (primaire). Peut être lent → 40 s.
const POLLINATIONS_BASE = 'https://text.pollinations.ai/openai';
const POLLINATIONS_MODEL = 'openai-fast';
const POLLINATIONS_TIMEOUT_MS = 40_000;
const ZAI_TIMEOUT_MS = 45_000;

// ---- HUD modèles (v2.2.0) ---------------------------------------------------
type ModeleInfo = { id: string; name: string; provider: string; active: boolean; local: boolean; up: boolean };

// Endpoints locaux OpenAI-compatible (best-effort, détectés au démarrage +
// rafraîchissement manuel). AUCUN timeout long : si absent → ignoré.
const LOCAUX: Record<string, string> = {
  ollama: 'http://127.0.0.1:11434',      // /api/tags (natif) + /v1 (compatible)
  lmstudio: 'http://127.0.0.1:1234',     // /v1/models
  llamacpp: 'http://127.0.0.1:8080',     // /v1/models
};
const SCAN_LOCAL_TIMEOUT_MS = 1_500;
const SCAN_LOCAL_PERIODE_MS = 60_000;   // ré-scan auto au plus toutes les 60 s

// Catalogue pollinations (cache 10 min — la liste évolue lentement).
const CATALOGUE_TTL_MS = 10 * 60_000;
let cataloguePollinations: { ids: string[]; ts: number } = { ids: [], ts: 0 };
const MODELES_POLLINATIONS_MAX = 8;

// Locaux détectés : genre → ts de détection (up = présent).
const locauxDetectes: Map<string, { base: string; ts: number }> = new Map();

// ---- Registre providers (ordre = priorité de cascade) ----------------------
type KindProvider = 'pollinations' | 'zai';
type Provider = {
  id: string;
  kind: KindProvider;
  model?: string;
  bucket: string;   // quota partagé (un 429 skip les autres du même bucket/tour)
  timeout_ms: number;
};
const PROVIDERS: Provider[] = [
  { id: 'pollinations', kind: 'pollinations', model: POLLINATIONS_MODEL, bucket: 'pollinations', timeout_ms: POLLINATIONS_TIMEOUT_MS },
  { id: 'zai-principal', kind: 'zai', bucket: 'zai', timeout_ms: ZAI_TIMEOUT_MS },                       // modèle par défaut du token
  { id: 'zai-alternatif', kind: 'zai', model: 'glm-4.5-air', bucket: 'zai', timeout_ms: ZAI_TIMEOUT_MS }, // secours (autre chemin modèle)
];

// ---- Types ------------------------------------------------------------------
type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };

// Codes d'erreur STABLES (le sidecar les utilise pour sa télémétrie, jamais
// pour l'affichage utilisateur — il a ses propres libellés neutres).
const CODE = {
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  UPSTREAM_ERREUR: 'UPSTREAM_ERREUR',
  CIRCUIT_OUVERT: 'CIRCUIT_OUVERT',
  QUEUE_SATUREE: 'QUEUE_SATUREE',
  REQUETE_INVALIDE: 'REQUETE_INVALIDE',
  CACHE_SERVI: 'CACHE_SERVI',
  AUCUN_PROVIDER: 'AUCUN_PROVIDER',
} as const;

// Phrases neutres OBLIGATOIRES (jamais de status/corps/provider dedans).
const MESSAGES_NEUTRES: Record<string, string> = {
  [CODE.RATE_LIMITED]: 'Le modèle de langue est momentanément saturé.',
  [CODE.TIMEOUT]: 'Le modèle de langue a mis trop de temps à répondre.',
  [CODE.UPSTREAM_ERREUR]: 'Le modèle de langue est momentanément indisponible.',
  [CODE.CIRCUIT_OUVERT]: 'Le modèle de langue est momentanément en pause (surchargé).',
  [CODE.QUEUE_SATUREE]: 'Le modèle de langue reçoit trop de demandes pour le moment.',
  [CODE.REQUETE_INVALIDE]: 'Requête invalide pour le modèle de langue.',
  [CODE.AUCUN_PROVIDER]: 'Le modèle de langue est momentanément indisponible.',
  [CODE.CACHE_SERVI]: '', // jamais utilisé comme erreur
};

// ---- Découverte des modèles (cloud + locaux) -------------------------------
async function chargerCataloguePollinations(force = false): Promise<string[]> {
  const frais = Date.now() - cataloguePollinations.ts < CATALOGUE_TTL_MS;
  if (!force && frais && cataloguePollinations.ids.length > 0) return cataloguePollinations.ids;
  try {
    const r = await fetch(`${POLLINATIONS_BASE}/models`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const d = (await r.json()) as { data?: Array<{ id?: string }> };
      const ids = (Array.isArray(d?.data) ? d.data : [])
        .map((m) => (typeof m?.id === 'string' ? m.id : ''))
        .filter((s) => s.length > 0);
      // openai-fast GARANTI (primaire), puis le reste du catalogue, borné.
      const uniques = [POLLINATIONS_MODEL, ...ids.filter((i) => i !== POLLINATIONS_MODEL)];
      cataloguePollinations = { ids: Array.from(new Set(uniques)).slice(0, MODELES_POLLINATIONS_MAX), ts: Date.now() };
    }
  } catch {
    // Catalogue indisponible : on garde l'ancien cache, sinon le primaire seul.
    if (cataloguePollinations.ids.length === 0) {
      cataloguePollinations = { ids: [POLLINATIONS_MODEL], ts: Date.now() };
    }
  }
  return cataloguePollinations.ids;
}

async function scannerLocaux(force = false): Promise<void> {
  const dernierScan = Math.max(0, ...Array.from(locauxDetectes.values()).map((v) => v.ts));
  if (!force && Date.now() - dernierScan < SCAN_LOCAL_PERIODE_MS && locauxDetectes.size > 0) return;
  for (const [genre, base] of Object.entries(LOCAUX)) {
    try {
      const chemin = genre === 'ollama' ? '/api/tags' : '/v1/models';
      const r = await fetch(`${base}${chemin}`, { signal: AbortSignal.timeout(SCAN_LOCAL_TIMEOUT_MS) });
      if (!r.ok) {
        locauxDetectes.delete(genre);
        continue;
      }
      const d = (await r.json()) as { models?: Array<{ name?: string }>; data?: Array<{ id?: string }> };
      const noms =
        genre === 'ollama'
          ? (Array.isArray(d?.models) ? d.models : []).map((m) => (typeof m?.name === 'string' ? m.name : ''))
          : (Array.isArray(d?.data) ? d.data : []).map((m) => (typeof m?.id === 'string' ? m.id : ''));
      if (noms.some((n) => n.length > 0)) {
        locauxDetectes.set(genre, { base, ts: Date.now() });
      } else {
        locauxDetectes.delete(genre);
      }
    } catch {
      locauxDetectes.delete(genre); // silencieux : absent = pas de section locale
    }
  }
}

function listeModeles(): ModeleInfo[] {
  const sortie: ModeleInfo[] = [];
  // Cloud — pollinations (catalogue dynamique, le primaire est "actif")
  const ids = cataloguePollinations.ids.length > 0 ? cataloguePollinations.ids : [POLLINATIONS_MODEL];
  const pollUp = circuits.get('pollinations')!.autoriser();
  for (const id of ids) {
    sortie.push({
      id: `pollinations:${id}`,
      name: id,
      provider: 'pollinations',
      active: id === POLLINATIONS_MODEL,
      local: false,
      up: pollUp,
    });
  }
  // Cloud — zai
  for (const p of PROVIDERS) {
    if (p.kind !== 'zai') continue;
    sortie.push({
      id: p.id,
      name: p.model ?? p.id,
      provider: p.id,
      active: false,
      local: false,
      up: circuits.get(p.id)!.autoriser(),
    });
  }
  return sortie;
}

// Cache détaillé des items locaux (id complet + nom), rempli par scannerLocaux.
let itemsLocaux: ModeleInfo[] = [];
async function rafraichirItemsLocaux(force = false): Promise<void> {
  await scannerLocaux(force);
  const sortie: ModeleInfo[] = [];
  for (const [genre] of locauxDetectes.entries()) {
    const base = LOCAUX[genre];
    try {
      const chemin = genre === 'ollama' ? '/api/tags' : '/v1/models';
      const r = await fetch(`${base}${chemin}`, { signal: AbortSignal.timeout(SCAN_LOCAL_TIMEOUT_MS) });
      if (!r.ok) continue;
      const d = (await r.json()) as { models?: Array<{ name?: string }>; data?: Array<{ id?: string }> };
      const noms =
        genre === 'ollama'
          ? (Array.isArray(d?.models) ? d.models : []).map((m) => (typeof m?.name === 'string' ? m.name : ''))
          : (Array.isArray(d?.data) ? d.data : []).map((m) => (typeof m?.id === 'string' ? m.id : ''));
      for (const nom of noms) {
        if (!nom) continue;
        sortie.push({ id: `${genre}:${nom}`, name: nom, provider: genre, active: false, local: true, up: true });
      }
    } catch {
      // entre deux scans le serveur local peut mourir : section vidée silencieusement
    }
  }
  itemsLocaux = sortie;
}

async function tousLesModeles(force = false): Promise<ModeleInfo[]> {
  await chargerCataloguePollinations(force);
  await rafraichirItemsLocaux(force);
  return [...listeModeles(), ...itemsLocaux];
}

// ---- Instance SDK (une seule, paresseuse) -----------------------------------
let zaiPromise: ReturnType<typeof ZAI.create> | null = null;
function getZai(): ReturnType<typeof ZAI.create> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

// ---- Utilitaires -------------------------------------------------------------
function avecDelai<T>(tache: Promise<T>, delai_ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const garde = new Promise<never>((_res, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error(`Timeout après ${delai_ms} ms`)), delai_ms);
  });
  return Promise.race([tache, garde]).finally(() => {
    if (minuteur) clearTimeout(minuteur);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function delaiBackoff(tentative: number): number {
  const base = Math.min(BACKOFF_BASE_MS * Math.pow(2.4, tentative), BACKOFF_CAP_MS);
  const jitter = 0.7 + Math.random() * 0.6; // ± 30 %
  return Math.round(base * jitter);
}

function json(donnees: unknown, statut = 200): Response {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function reponseErreur(code: string, statutHttp: number, detailLog: string, chemin: string): Response {
  // Le détail technique reste STRICTEMENT dans les logs du bridge.
  console.error(`[llm-bridge] ${chemin} échec (${code}) : ${detailLog}`);
  return json({ erreur: MESSAGES_NEUTRES[code] ?? 'Le modèle de langue est momentanément indisponible.', code }, statutHttp);
}

function estMessageValide(m: unknown): m is Message {
  if (!m || typeof m !== 'object') return false;
  const msg = m as Record<string, unknown>;
  return (
    (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') &&
    typeof msg.content === 'string'
  );
}

function cleCache(messages: Message[], temperature: number, max_tokens: number): string {
  return JSON.stringify([messages, temperature, max_tokens]);
}

// ---- Limiteur de concurrence (sémaphore FIFO + espacement) --------------------
class Limiteur {
  private enVol = 0;
  private file: Array<() => void> = [];
  private dernierDepart = 0;

  async acquerir(): Promise<boolean> {
    const debutAttente = Date.now();
    // Place dans la file ?
    if (this.enVol >= CONCURRENCE_MAX) {
      const place = await new Promise<boolean>((resoudre) => {
        const entree = () => resoudre(true);
        this.file.push(entree);
        // Admission bornée : trop d'attente → refus immédiat (pas de latence inutile).
        setTimeout(() => {
          const idx = this.file.indexOf(entree);
          if (idx >= 0) {
            this.file.splice(idx, 1);
            resoudre(false);
          }
        }, QUEUE_TIMEOUT_MS);
      });
      if (!place) return false;
      const attente = Date.now() - debutAttente;
      if (attente > QUEUE_TIMEOUT_MS) return false;
    }
    // Espacement minimum entre départs (anti-rafale).
    const maintenant = Date.now();
    const reste = this.dernierDepart + ESPACEMENT_MIN_MS - maintenant;
    if (reste > 0) await sleep(reste);
    this.dernierDepart = Date.now();
    this.enVol += 1;
    return true;
  }

  relacher(): void {
    this.enVol = Math.max(0, this.enVol - 1);
    const suivant = this.file.shift();
    if (suivant) suivant();
  }
}
const limiteur = new Limiteur();

// ---- Circuit-breaker PAR PROVIDER ----------------------------------------------
class Circuit {
  etat: 'FERME' | 'OUVERT' | 'DEMI_OUVERT' = 'FERME';
  echecsConsecutifs = 0;
  ouvertDepuis = 0;

  autoriser(): boolean {
    if (this.etat === 'FERME') return true;
    if (this.etat === 'OUVERT') {
      if (Date.now() - this.ouvertDepuis >= CIRCUIT_OUVERT_MS) {
        this.etat = 'DEMI_OUVERT'; // une seule sonde passera (elle-même autorisée)
        return true;
      }
      return false;
    }
    return true; // DEMI_OUVERT : la sonde est autorisée
  }

  succes(): void {
    this.echecsConsecutifs = 0;
    this.etat = 'FERME';
  }

  echec(): void {
    this.echecsConsecutifs += 1;
    if (this.etat === 'DEMI_OUVERT' || this.echecsConsecutifs >= SEUIL_CIRCUIT) {
      this.etat = 'OUVERT';
      this.ouvertDepuis = Date.now();
      console.warn(`[llm-bridge] circuit OUVERT pour un provider (${this.echecsConsecutifs} échecs consécutifs, ré-essai dans ${CIRCUIT_OUVERT_MS / 1000}s)`);
    }
  }
}
const circuits: Map<string, Circuit> = new Map();
for (const p of PROVIDERS) circuits.set(p.id, new Circuit());
function unProviderActif(): boolean {
  return PROVIDERS.some((p) => circuits.get(p.id)!.autoriser());
}

// ---- Télémétrie par provider + globale ----------------------------------------
type StatsProvider = {
  ok: number;
  erreurs: number;
  dernier_statut: string; // 'ok' | code d'erreur
  dernier_ts: number;
};
const statsParProvider: Map<string, StatsProvider> = new Map();
for (const p of PROVIDERS) {
  statsParProvider.set(p.id, { ok: 0, erreurs: 0, dernier_statut: 'jamais_appelé', dernier_ts: 0 });
}

function noterSucces(provider: string): void {
  circuits.get(provider)?.succes();
  const s = statsParProvider.get(provider);
  if (s) {
    s.ok += 1;
    s.dernier_statut = 'ok';
    s.dernier_ts = Date.now();
  }
}

function noterEchec(provider: string, code: string): void {
  // Un RATE_LIMITED n'est pas une panne du provider : le circuit ne s'ouvre pas
  // pour un simple quota (backoff suffit). 5xx/timeout/vide → comptent.
  if (code !== CODE.RATE_LIMITED) circuits.get(provider)?.echec();
  const s = statsParProvider.get(provider);
  if (s) {
    s.erreurs += 1;
    s.dernier_statut = code;
    s.dernier_ts = Date.now();
  }
}

const compteurs = {
  complete_ok: 0,
  complete_rate_limited: 0,
  complete_timeout: 0,
  complete_erreur: 0,
  complete_circuit_ouvert: 0,
  complete_cache_servi: 0,
  retries_effectues: 0,
  search_ok: 0,
  search_echec: 0,
  dernier_succes_ts: 0 as number,
  derniere_erreur_ts: 0 as number,
  derniere_erreur_code: '' as string,
  dernier_provider_succes: '' as string,
};

// ---- Appel provider POLLINATIONS (une tentative) --------------------------------
async function appelPollinations(
  messages: Message[],
  temperature: number,
  max_tokens: number,
  timeout_ms: number,
  modele: string = POLLINATIONS_MODEL,
): Promise<{ ok: true; texte: string } | { ok: false; code: string; detail: string }> {
  try {
    const reponse = await fetch(`${POLLINATIONS_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modele, messages, temperature, max_tokens }),
      signal: AbortSignal.timeout(timeout_ms),
    });
    if (reponse.status === 429) {
      return { ok: false, code: CODE.RATE_LIMITED, detail: 'pollinations : rate-limit' };
    }
    if (!reponse.ok) {
      return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: `pollinations : statut ${reponse.status}` };
    }
    const data = (await reponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const texte = data?.choices?.[0]?.message?.content ?? '';
    if (typeof texte !== 'string' || texte.trim().length === 0) {
      return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: 'pollinations : réponse vide' };
    }
    return { ok: true, texte };
  } catch (e: unknown) {
    const brut = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(brut)) {
      return { ok: false, code: CODE.TIMEOUT, detail: `pollinations : timeout ${timeout_ms} ms` };
    }
    return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: `pollinations : ${brut.slice(0, 200)}` };
  }
}

// ---- Appel provider ZAI (une tentative) ------------------------------------------
async function appelZai(
  provider: Provider,
  messages: Message[],
  temperature: number,
  max_tokens: number,
): Promise<{ ok: true; texte: string } | { ok: false; code: string; detail: string }> {
  try {
    const zai = await getZai();
    const completion = await avecDelai(
      zai.chat.completions.create({
        messages: messages as unknown as Parameters<typeof zai.chat.completions.create>[0]['messages'],
        temperature,
        max_tokens,
        thinking: { type: 'disabled' },
        ...(provider.model ? { model: provider.model } : {}),
      } as Parameters<typeof zai.chat.completions.create>[0]),
      provider.timeout_ms,
    );
    const texte: string = completion?.choices?.[0]?.message?.content ?? '';
    if (typeof texte !== 'string' || texte.trim().length === 0) {
      return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: `${provider.id} : réponse SDK vide ou invalide` };
    }
    return { ok: true, texte };
  } catch (e: unknown) {
    const brut = e instanceof Error ? e.message : String(e);
    if (/status 429/i.test(brut) || /too many requests/i.test(brut)) {
      return { ok: false, code: CODE.RATE_LIMITED, detail: `${provider.id} : rate-limit upstream` };
    }
    if (/timeout/i.test(brut)) {
      return { ok: false, code: CODE.TIMEOUT, detail: `${provider.id} : timeout ${provider.timeout_ms} ms` };
    }
    return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: `${provider.id} : ${brut.slice(0, 200)}` };
  }
}

// ---- Appel serveur LOCAL OpenAI-compatible (une tentative) -----------------------
async function appelLocal(
  base: string,
  modele: string,
  messages: Message[],
  temperature: number,
  max_tokens: number,
): Promise<{ ok: true; texte: string } | { ok: false; code: string; detail: string }> {
  // Le nom de modèle local est "genre:nom" → l'API locale attend juste "nom".
  const nomLocal = modele.slice(modele.indexOf(':') + 1);
  try {
    const reponse = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: nomLocal, messages, temperature, max_tokens }),
      signal: AbortSignal.timeout(55_000), // les modèles locaux peuvent être lents (CPU)
    });
    if (!reponse.ok) {
      return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: 'serveur local : réponse non valide' };
    }
    const data = (await reponse.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const texte = data?.choices?.[0]?.message?.content ?? '';
    if (typeof texte !== 'string' || texte.trim().length === 0) {
      return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: 'serveur local : réponse vide' };
    }
    return { ok: true, texte };
  } catch (e: unknown) {
    const brut = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(brut)) {
      return { ok: false, code: CODE.TIMEOUT, detail: 'serveur local : timeout' };
    }
    return { ok: false, code: CODE.UPSTREAM_ERREUR, detail: `serveur local : ${brut.slice(0, 160)}` };
  }
}

// ---- Modèle CHOISI (HUD) → route directe ----------------------------------------
// Retourne ok+provider, ou ok:false → l'appelant retombe sur la cascade avec
// le drapeau repli (AUCUNE erreur visible côté utilisateur, N4).
async function modeleDirect(
  model: string,
  messages: Message[],
  temperature: number,
  max_tokens: number,
): Promise<{ ok: true; texte: string; provider: string } | { ok: false; code: string; detail: string }> {
  if (model.startsWith('pollinations:')) {
    const r = await appelPollinations(messages, temperature, max_tokens, POLLINATIONS_TIMEOUT_MS, model.slice('pollinations:'.length));
    if (r.ok) noterSucces('pollinations');
    else noterEchec('pollinations', r.code);
    return r;
  }
  if (model === 'zai-principal' || model === 'zai-alternatif') {
    const p = PROVIDERS.find((x) => x.id === model);
    if (!p || !circuits.get(p.id)!.autoriser()) {
      return { ok: false, code: CODE.CIRCUIT_OUVERT, detail: `${model} en pause` };
    }
    const r = await appelZai(p, messages, temperature, max_tokens);
    if (r.ok) noterSucces(p.id);
    else noterEchec(p.id, r.code);
    return r;
  }
  const idx = model.indexOf(':');
  if (idx > 0) {
    const genre = model.slice(0, idx);
    const base = locauxDetectes.get(genre)?.base ?? (itemsLocaux.some((m) => m.id === model) ? LOCAUX[genre] : undefined);
    if (base) {
      const r = await appelLocal(base, model, messages, temperature, max_tokens);
      return r;
    }
  }
  return { ok: false, code: CODE.REQUETE_INVALIDE, detail: `modèle choisi inconnu (${model.length} car.)` };
}

// ---- Cascade multi-provider avec retries ------------------------------------------
type Resultat = { ok: true; texte: string; provider: string; duree_ms: number } | { ok: false; code: string; detail: string };

async function cascadeComplete(
  messages: Message[],
  temperature: number,
  max_tokens: number,
): Promise<Resultat> {
  const budgetDebut = Date.now();
  let dernierCode = CODE.AUCUN_PROVIDER;
  let dernierDetail = 'aucun provider disponible';
  const bucketsRates = new Set<string>();

  for (let tour = 0; tour <= RETRIES_MAX; tour++) {
    if (Date.now() - budgetDebut > BUDGET_TOTAL_MS) {
      return { ok: false, code: CODE.TIMEOUT, detail: `budget global dépassé (tour ${tour})` };
    }
    if (tour > 0) {
      compteurs.retries_effectues += 1;
      bucketsRates.clear(); // nouveau tour : tous les buckets re-testés
      await sleep(delaiBackoff(tour - 1));
      if (Date.now() - budgetDebut > BUDGET_TOTAL_MS) {
        return { ok: false, code: CODE.TIMEOUT, detail: `budget global dépassé avant tour ${tour + 1}` };
      }
    }

    let tenteQuelqueChose = false;
    for (const provider of PROVIDERS) {
      // Bucket déjà limité ce tour (quota partagé) → inutile d'insister.
      if (bucketsRates.has(provider.bucket)) continue;
      // Provider en pause (circuit ouvert) → skip immédiat, les autres servent.
      if (!circuits.get(provider.id)!.autoriser()) continue;
      if (Date.now() - budgetDebut > BUDGET_TOTAL_MS) break;

      tenteQuelqueChose = true;
      const acquisition = await limiteur.acquerir();
      if (!acquisition) {
        return { ok: false, code: CODE.QUEUE_SATUREE, detail: 'file de concurrence saturée' };
      }
      try {
        const resultat =
          provider.kind === 'pollinations'
            ? await appelPollinations(messages, temperature, max_tokens, provider.timeout_ms)
            : await appelZai(provider, messages, temperature, max_tokens);
        if (resultat.ok) {
          noterSucces(provider.id);
          return { ok: true, texte: resultat.texte, provider: provider.id, duree_ms: Date.now() - budgetDebut };
        }
        dernierCode = resultat.code;
        dernierDetail = resultat.detail;
        noterEchec(provider.id, resultat.code);
        if (resultat.code === CODE.RATE_LIMITED) bucketsRates.add(provider.bucket);
        // sinon : provider suivant de la cascade (failover immédiat)
      } finally {
        limiteur.relacher();
      }
    }

    // Tous les providers en pause et rien tenté ce tour → échec immédiat.
    if (!tenteQuelqueChose && unProviderActif() === false) {
      return { ok: false, code: CODE.CIRCUIT_OUVERT, detail: 'tous les providers en pause' };
    }
    if (!tenteQuelqueChose) {
      // Rien de tentable ce tour (buckets limités) mais au moins un circuit
      // non ouvert : backoff court et re-test au tour suivant.
      continue;
    }
  }
  return { ok: false, code: dernierCode, detail: dernierDetail };
}

// ---- Cache LRU des dernières bonnes réponses -------------------------------------
const cache = new Map<string, { texte: string; ts: number }>();

function cacheGet(cle: string): string | null {
  const entree = cache.get(cle);
  if (!entree) return null;
  if (Date.now() - entree.ts > CACHE_TTL_MS) {
    cache.delete(cle);
    return null;
  }
  return entree.texte;
}

function cachePut(cle: string, texte: string): void {
  if (cache.has(cle)) cache.delete(cle);
  cache.set(cle, { texte, ts: Date.now() });
  while (cache.size > CACHE_TAILLE) {
    const plusAncienne = cache.keys().next().value;
    if (plusAncienne === undefined) break;
    cache.delete(plusAncienne);
  }
}

// ---- Serveur ---------------------------------------------------------------------------
const serveur = Bun.serve({
  port: PORT,
  async fetch(requete): Promise<Response> {
    const debut = performance.now();
    const url = new URL(requete.url);
    const chemin = url.pathname;
    let statut = 500;

    try {
      // ---------- GET /sante ----------
      if (requete.method === 'GET' && chemin === '/sante') {
        statut = 200;
        return json({
          ok: true,
          service: 'llm-bridge',
          version: VERSION,
          llm_disponible: unProviderActif(),
          providers: PROVIDERS.map((p) => {
            const s = statsParProvider.get(p.id)!;
            const c = circuits.get(p.id)!;
            return { name: p.id, up: c.autoriser(), last_status: s.dernier_statut };
          }),
        }, statut);
      }

      // ---------- GET /statut (télémétrie) ----------
      if (requete.method === 'GET' && chemin === '/statut') {
        statut = 200;
        return json({
          service: 'llm-bridge',
          version: VERSION,
          circuit: {
            global_dispo: unProviderActif(),
            par_provider: Object.fromEntries(
              PROVIDERS.map((p) => {
                const c = circuits.get(p.id)!;
                return [p.id, {
                  etat: c.etat,
                  echecs_consecutifs: c.echecsConsecutifs,
                  ouvert_depuis_ts: c.etat === 'OUVERT' ? c.ouvertDepuis : null,
                  seuil: SEUIL_CIRCUIT,
                  pause_ms: CIRCUIT_OUVERT_MS,
                }];
              }),
            ),
          },
          compteurs,
          cache: { entrees: cache.size, taille_max: CACHE_TAILLE, ttl_ms: CACHE_TTL_MS },
          providers: PROVIDERS.map((p) => {
            const s = statsParProvider.get(p.id)!;
            const c = circuits.get(p.id)!;
            return {
              name: p.id,
              kind: p.kind,
              model: p.model ?? '(défaut)',
              up: c.autoriser(),
              last_status: s.dernier_statut,
              ok: s.ok,
              erreurs: s.erreurs,
              dernier_ts: s.dernier_ts,
            };
          }),
          // v2.2.0 (HUD) : liste des modèles cloud (+ locaux déjà scannés).
          // Best-effort : jamais bloquant, jamais une erreur visible.
          models: [...listeModeles(), ...itemsLocaux],
          dispo: unProviderActif(),
        }, statut);
      }

      // ---------- GET /modeles + POST /modeles (v2.2.0 HUD) ----------
      if (chemin === '/modeles' && (requete.method === 'GET' || requete.method === 'POST')) {
        const rafraichir = requete.method === 'POST';
        statut = 200;
        const models = await tousLesModeles(rafraichir);
        return json({ models, rafraichi: rafraichir }, statut);
      }

      // ---------- POST /complete ----------
      if (requete.method === 'POST' && chemin === '/complete') {
        let corps: Record<string, unknown>;
        try {
          corps = await requete.json();
        } catch {
          statut = 400;
          return reponseErreur(CODE.REQUETE_INVALIDE, statut, 'corps JSON illisible', chemin);
        }

        const messages = corps?.messages;
        if (
          !Array.isArray(messages) ||
          messages.length === 0 ||
          !messages.every(estMessageValide)
        ) {
          statut = 400;
          return reponseErreur(CODE.REQUETE_INVALIDE, statut, 'messages invalides', chemin);
        }
        const temperature = typeof corps.temperature === 'number' ? corps.temperature : 0.6;
        const max_tokens = typeof corps.max_tokens === 'number' ? corps.max_tokens : 1200;
        // v2.2.0 (HUD) : modèle choisi côté UI (id complet). Absent/vide/
        // "auto" → cascade normale inchangée.
        const modeleChoisi = typeof corps.model === 'string' ? corps.model.trim().slice(0, 120) : '';
        const msgs = messages as Message[];
        const cle = cleCache(msgs, temperature, max_tokens);

        // Tous les providers en pause : échec immédiat (zéro latence), sauf cache exact.
        if (!unProviderActif() && !(modeleChoisi && modeleChoisi !== 'auto')) {
          const enCache = cacheGet(cle);
          if (enCache !== null) {
            compteurs.complete_cache_servi += 1;
            statut = 200;
            return json({ texte: enCache, duree_ms: Math.round(performance.now() - debut), code: CODE.CACHE_SERVI }, statut);
          }
          compteurs.complete_circuit_ouvert += 1;
          compteurs.derniere_erreur_ts = Date.now();
          compteurs.derniere_erreur_code = CODE.CIRCUIT_OUVERT;
          statut = 503;
          return reponseErreur(CODE.CIRCUIT_OUVERT, statut, 'tous les providers en pause', chemin);
        }

        // v2.2.0 (HUD) : modèle choisi → route DIRECTE. Échec → cascade
        // normale + repli:true (le repli n'est JAMAIS une erreur visible).
        if (modeleChoisi && modeleChoisi !== 'auto') {
          const direct = await modeleDirect(modeleChoisi, msgs, temperature, max_tokens);
          if (direct.ok) {
            compteurs.complete_ok += 1;
            compteurs.dernier_succes_ts = Date.now();
            compteurs.dernier_provider_succes = direct.provider;
            cachePut(cle, direct.texte);
            statut = 200;
            return json({ texte: direct.texte, duree_ms: Math.round(performance.now() - debut), provider: direct.provider, model: modeleChoisi, repli: false }, statut);
          }
          console.error(`[llm-bridge] ${chemin} modèle choisi indisponible → cascade (détail interne : ${direct.code})`);
          const resultatCascade = await cascadeComplete(msgs, temperature, max_tokens);
          if (resultatCascade.ok) {
            compteurs.complete_ok += 1;
            compteurs.dernier_succes_ts = Date.now();
            compteurs.dernier_provider_succes = resultatCascade.provider;
            cachePut(cle, resultatCascade.texte);
            statut = 200;
            return json({ texte: resultatCascade.texte, duree_ms: resultatCascade.duree_ms, provider: resultatCascade.provider, repli: true }, statut);
          }
          // La cascade aussi a échoué : erreur structurée neutre habituelle.
          compteurs.derniere_erreur_ts = Date.now();
          compteurs.derniere_erreur_code = resultatCascade.code;
          statut = resultatCascade.code === CODE.RATE_LIMITED || resultatCascade.code === CODE.CIRCUIT_OUVERT || resultatCascade.code === CODE.QUEUE_SATUREE ? 503 : resultatCascade.code === CODE.TIMEOUT ? 504 : 502;
          return reponseErreur(resultatCascade.code, statut, resultatCascade.detail, chemin);
        }

        const resultat = await cascadeComplete(msgs, temperature, max_tokens);

        if (resultat.ok) {
          compteurs.complete_ok += 1;
          compteurs.dernier_succes_ts = Date.now();
          compteurs.dernier_provider_succes = resultat.provider;
          cachePut(cle, resultat.texte);
          statut = 200;
          return json({ texte: resultat.texte, duree_ms: resultat.duree_ms, provider: resultat.provider, repli: false }, statut);
        }

        compteurs.derniere_erreur_ts = Date.now();
        compteurs.derniere_erreur_code = resultat.code;
        if (resultat.code === CODE.RATE_LIMITED) {
          compteurs.complete_rate_limited += 1;
          statut = 503;
        } else if (resultat.code === CODE.TIMEOUT) {
          compteurs.complete_timeout += 1;
          statut = 504;
        } else if (resultat.code === CODE.QUEUE_SATUREE) {
          compteurs.complete_rate_limited += 1;
          statut = 503;
        } else if (resultat.code === CODE.CIRCUIT_OUVERT) {
          compteurs.complete_circuit_ouvert += 1;
          statut = 503;
        } else {
          compteurs.complete_erreur += 1;
          statut = 502;
        }
        return reponseErreur(resultat.code, statut, resultat.detail, chemin);
      }

      // ---------- POST /search ----------
      if (requete.method === 'POST' && chemin === '/search') {
        let corps: Record<string, unknown>;
        try {
          corps = await requete.json();
        } catch {
          statut = 400;
          return reponseErreur(CODE.REQUETE_INVALIDE, statut, 'corps JSON illisible', chemin);
        }

        const query = corps?.query;
        if (typeof query !== 'string' || query.trim().length === 0) {
          statut = 400;
          return reponseErreur(CODE.REQUETE_INVALIDE, statut, 'query invalide', chemin);
        }
        const num =
          typeof corps.num === 'number' && Number.isFinite(corps.num) && corps.num > 0
            ? Math.min(Math.floor(corps.num), 20)
            : 6;

        // Recherche : 1 retry léger (le web n'est pas critique dans le pipeline).
        let dernierDetail = 'inconnu';
        for (let tentative = 0; tentative <= 1; tentative++) {
          if (tentative > 0) await sleep(delaiBackoff(0));
          const acquisition = await limiteur.acquerir();
          if (!acquisition) {
            dernierDetail = 'file saturée';
            break;
          }
          try {
            const zai = await getZai();
            const resultats = await avecDelai(
              zai.functions.invoke('web_search', { query, num }) as Promise<
                Array<Record<string, unknown>>
              >,
              30_000,
            );
            const liste = (Array.isArray(resultats) ? resultats : []).map((r) => ({
              titre: typeof r?.name === 'string' ? r.name : '',
              url: typeof r?.url === 'string' ? r.url : '',
              extrait: typeof r?.snippet === 'string' ? r.snippet : '',
            }));
            compteurs.search_ok += 1;
            compteurs.dernier_succes_ts = Date.now();
            statut = 200;
            return json({ resultats: liste }, statut);
          } catch (e: unknown) {
            dernierDetail = e instanceof Error ? e.message : String(e);
          } finally {
            limiteur.relacher();
          }
        }
        compteurs.search_echec += 1;
        compteurs.derniere_erreur_ts = Date.now();
        compteurs.derniere_erreur_code = 'RECHERCHE_INDISPONIBLE';
        statut = 503;
        return reponseErreur('RECHERCHE_INDISPONIBLE', statut, dernierDetail.slice(0, 300), chemin);
      }

      // ---------- Aucun autre endpoint ----------
      statut = 404;
      return json(
        { erreur: 'Endpoint inconnu (routes : GET /sante, GET /statut, GET|POST /modeles, POST /complete, POST /search)' },
        statut,
      );
    } catch (e: unknown) {
      // Filet : même ici, AUCUNE chaîne brute ne part vers le client.
      statut = 502;
      const brut = e instanceof Error ? e.message : String(e);
      console.error(`[llm-bridge] erreur inattendue ${chemin} : ${brut}`);
      return reponseErreur(CODE.UPSTREAM_ERREUR, statut, brut.slice(0, 300), chemin);
    } finally {
      const duree = Math.round(performance.now() - debut);
      console.log(`[llm-bridge] ${requete.method} ${chemin} -> ${statut} (${duree} ms)`);
    }
  },
});

console.log(`[llm-bridge] écoute sur http://127.0.0.1:${serveur.port} (v${VERSION}, cascade: pollinations→zai→zai-alt, HUD modèles, résilience: retry+limiteur+circuit/provider+cache)`);

// v2.2.0 (HUD) : découverte en arrière-plan au démarrage (catalogue cloud +
// scan locaux) — best-effort, jamais bloquant, silencieux si absent.
setTimeout(() => {
  tousLesModeles(true).catch(() => {
    /* silencieux : le HUD restera sur « auto » si rien n'est découvert */
  });
}, 1_500);
