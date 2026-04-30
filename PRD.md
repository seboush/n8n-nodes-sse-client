# PRD — n8n-nodes-sse-client

## Résumé

Custom n8n **action node** (pas trigger) qui se connecte à un endpoint Server-Sent Events, collecte les événements en streaming, et les retourne quand une condition d'arrêt est remplie. Conçu pour être placé en milieu de workflow avec une URL dynamique (expressions n8n).

**Use case principal** : connecter un workflow n8n à l'API Claude Managed Agents (sessions beta) qui stream les événements via SSE à `GET /v1/sessions/{session_id}/events/stream`. Le session_id est dynamique (vient d'un node en amont), et l'endpoint exige des headers d'authentification.

**Use case générique** : tout endpoint SSE nécessitant auth, headers custom, et une condition d'arrêt configurable.

---

## Contexte et Motivation

### Problème

On veut connecter Telegram à un Claude Managed Agent via n8n. L'agent met 30-120+ secondes à répondre. Deux problèmes :

1. **Le webhook Telegram timeout après ~30s** → on split en 2 workflows n8n (Receiver acquitte en <1s, Processor traite en async). Résolu.

2. **Comment attendre la réponse de l'agent dans le Processor ?** L'API Claude MA offre deux méthodes :
   - **Polling** : `GET /sessions/{id}` toutes les 3s → 4 nodes en boucle (Wait → GET → IF → loop), lent, peut rater des événements
   - **SSE streaming** : `GET /sessions/{id}/events/stream` → connexion persistante, événements en temps réel, heartbeats

Le SSE Trigger natif de n8n (`n8n-nodes-base.sseTrigger`) ne supporte ni headers ni auth. Le package community `n8n-nodes-sse-trigger-extended` ajoute les headers mais c'est un **trigger** (démarre un workflow, URL statique). On a besoin d'un **action node** mid-workflow avec URL dynamique.

### Solution

Un custom community node `n8n-nodes-sse-client` : un action node qui reçoit des données en input (session_id), ouvre un stream SSE avec auth, collecte les événements, et les retourne quand une condition d'arrêt est remplie.

---

## Spécifications Fonctionnelles

### Comportement du node

1. Reçoit des items en entrée (comme tout action node n8n)
2. Pour chaque item, résout l'URL via expressions n8n (ex: `https://api.anthropic.com/v1/sessions/{{ $json.id }}/events/stream`)
3. Ouvre une connexion HTTP vers l'URL avec les headers configurés
4. Lit le stream SSE ligne par ligne, parse le protocole SSE (champs `data:`, `event:`, `id:`, `retry:`)
5. Accumule les événements dans un tableau
6. Vérifie après chaque événement si la condition d'arrêt est remplie (regex sur event type et/ou data)
7. Quand la condition est remplie, le timeout atteint, ou le stream se ferme : retourne tous les événements collectés comme items de sortie
8. Les nodes en aval reçoivent les événements et peuvent les filtrer/traiter

### Paramètres du node

| Paramètre | Type | Default | Requis | Description |
|---|---|---|---|---|
| **URL** | string (expression-enabled) | — | oui | URL de l'endpoint SSE. Supporte les expressions n8n pour les valeurs dynamiques. |
| **Authentication** | options: None / Bearer Auth / Header Auth | none | oui | Méthode d'auth. Bearer et Header Auth réutilisent les credential types natifs n8n. |
| **Send Custom Headers** | boolean | false | non | Active l'envoi de headers additionnels. |
| **Specify Headers** | options: Using Fields Below / JSON | keypair | non | Mode de saisie des headers (affiché si Send Custom Headers = true). |
| **Header Parameters** | fixedCollection (name/value pairs) | — | non | Paires clé-valeur de headers (affiché si Specify Headers = keypair). |
| **Headers (JSON)** | json | `{}` | non | Headers en JSON brut (affiché si Specify Headers = json). |
| **Stop Event Type** | string (expression-enabled) | — | non | Pattern regex sur le champ `event:` SSE. Quand un événement matche, le node s'arrête et retourne. Vide = pas de stop sur event type. |
| **Stop Data Pattern** | string (expression-enabled) | — | non | Pattern regex sur le champ `data:` SSE. Quand un événement matche, le node s'arrête. Vide = pas de stop sur data. |
| **Include Stop Event** | boolean | true | non | Si true, l'événement qui déclenche le stop est inclus dans la sortie. |
| **Options** (collection) : | | | | |
| → Timeout (ms) | number | 300000 | non | Timeout global en ms (5 minutes par défaut). |
| → Retry Attempts | number | 3 | non | Nombre de tentatives de reconnexion sur erreur réseau. |
| → Retry Delay (ms) | number | 1000 | non | Délai entre les tentatives. |
| → Include Metadata | boolean | true | non | Ajoute `$metadata` (eventType, lastEventId, timestamp, origin) à chaque événement. |
| → Max Events | number | 0 | non | Nombre max d'événements à collecter (0 = illimité). Safety valve. |
| → HTTP Method | options: GET / POST | GET | non | Méthode HTTP (certains endpoints SSE utilisent POST). |
| → Request Body | json | — | non | Body de la requête (affiché si HTTP Method = POST). |

### Credentials

Pas de credential type custom. Le node réutilise les types natifs n8n :
- `httpBearerAuth` — pour Bearer token auth (`Authorization: Bearer xxx`)
- `httpHeaderAuth` — pour header custom auth (ex: `x-api-key: sk-ant-xxx`)

Affichés conditionnellement selon le choix d'Authentication.

### Format de sortie

Chaque événement SSE devient un item n8n. Exemple pour un événement `agent.message` de Claude MA :

```json
{
  "type": "agent.message",
  "content": [{ "type": "text", "text": "Voici ma réponse..." }],
  "$metadata": {
    "eventType": "agent.message",
    "lastEventId": "sevt_123",
    "timestamp": "2026-04-29T14:30:00.000Z",
    "origin": "https://api.anthropic.com/v1/sessions/sess_abc/events/stream"
  }
}
```

Si le `data:` SSE n'est pas du JSON valide, il est retourné tel quel dans `{ "data": "raw string..." }`.

### Gestion d'erreurs

- **Timeout** : si des événements ont été collectés → les retourner. Si aucun événement → erreur `NodeOperationError`.
- **Erreur HTTP** (4xx, 5xx) : retry selon la config, puis erreur.
- **Stream interrompu** : retry, puis retourner ce qui a été collecté.
- **`continueOnFail`** : si activé dans n8n, les erreurs retournent `{ error: "message" }` au lieu de stopper le workflow.
- **Annulation n8n** : respecter `getExecutionCancelSignal()` pour arrêter proprement.

---

## Spécifications Techniques

### Architecture

```
n8n-nodes-sse-client/
├── package.json                    # npm package avec attribut "n8n"
├── tsconfig.json                   # Target ES2019, CommonJS
├── .eslintrc.js
├── README.md
├── LICENSE                         # MIT
├── nodes/
│   └── SseClient/
│       ├── SseClient.node.ts       # Classe INodeType avec execute()
│       ├── SseClient.node.json     # Codex metadata (catégories, alias)
│       └── sse-client.svg          # Icône du node
└── (pas de dossier credentials/)
```

### Dépendances

- **Runtime** : ZÉRO. Utilise `fetch` + `ReadableStream` natifs (Node 18+). Pas de package `eventsource`.
- **Peer** : `n8n-workflow` (fourni par n8n au runtime)
- **Dev** : `@n8n/node-cli`, `typescript`, `eslint`, `prettier`

### Interface TypeScript

Le node implémente `INodeType` avec la méthode `execute()` (pas `trigger()`).

```typescript
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';

export class SseClient implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'SSE Client',
    name: 'sseClient',
    icon: 'file:sse-client.svg',
    group: ['input'],
    version: 1,
    subtitle: '={{$parameter["url"]}}',
    description: 'Connect to an SSE endpoint, collect events, return on stop condition',
    defaults: { name: 'SSE Client' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [ /* httpBearerAuth, httpHeaderAuth conditionnel */ ],
    properties: [ /* voir paramètres ci-dessus */ ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    // Pour chaque item en entrée :
    // 1. Résoudre URL + headers
    // 2. fetch() avec AbortController (timeout + cancellation n8n)
    // 3. reader.read() en boucle, parse SSE, accumule events
    // 4. Stop sur regex match ou timeout
    // 5. Retourne les events collectés
  }
}
```

### Parsing SSE

Le protocole SSE (RFC 8895) définit ces champs ligne par ligne :
- `data: ...` — données de l'événement (plusieurs lignes `data:` sont jointes avec `\n`)
- `event: ...` — type d'événement (défaut: `message`)
- `id: ...` — identifiant de l'événement
- `retry: ...` — délai de reconnexion suggéré (en ms)
- `: ...` — commentaire (ignoré, utilisé comme heartbeat)
- Ligne vide — fin d'un bloc événement, dispatch

### Logique cœur (pseudo-code)

```
response = fetch(url, { headers, signal: abortController.signal })
reader = response.body.getReader()
buffer = ""

WHILE not stopReached:
    { done, value } = reader.read()
    IF done: BREAK
    
    buffer += decode(value)
    lines = buffer.split("\n")
    buffer = last incomplete line
    
    FOR each line:
        IF empty line:
            IF currentEvent has data:
                CHECK stopEventType regex against event type
                CHECK stopDataPattern regex against event data
                IF match: stopReached = true (include event if configured)
                ELSE: add event to collectedEvents
                CHECK maxEvents limit
            RESET currentEvent
        ELIF starts with "data:": append to currentEvent.data
        ELIF starts with "event:": set currentEvent.event
        ELIF starts with "id:": set currentEvent.id
        ELIF starts with "retry:": set currentEvent.retry
        ELIF starts with ":": ignore (heartbeat/comment)

RETURN collectedEvents as n8n items
```

### Retry

Wrap la connexion dans une boucle retry :
```
FOR attempt = 0 TO maxRetries:
    TRY: connect + read stream
    CATCH:
        IF AbortError (timeout): don't retry, return what we have
        IF attempt < maxRetries: wait retryDelay, continue
        ELSE: throw
```

### Cancellation n8n

```typescript
const cancelSignal = this.getExecutionCancelSignal?.();
if (cancelSignal) {
  cancelSignal.addEventListener('abort', () => controller.abort());
}
```

Avec try-catch pour compatibilité avec les anciennes versions de n8n.

---

## package.json

```json
{
  "name": "n8n-nodes-sse-client",
  "version": "0.1.0",
  "description": "SSE Client action node for n8n — connects to SSE endpoints mid-workflow with auth, custom headers, and configurable stop conditions",
  "license": "MIT",
  "author": {
    "name": "25hour",
    "email": "sebastien@25hour.io"
  },
  "keywords": [
    "n8n-community-node-package",
    "n8n",
    "sse",
    "server-sent-events",
    "streaming"
  ],
  "engines": { "node": ">=18.10" },
  "main": "index.js",
  "scripts": {
    "build": "n8n-node build",
    "dev": "n8n-node dev",
    "lint": "n8n-node lint",
    "lint:fix": "n8n-node lint --fix",
    "release": "n8n-node release",
    "prepublishOnly": "n8n-node prerelease"
  },
  "files": ["dist"],
  "n8n": {
    "n8nNodesApiVersion": 1,
    "strict": true,
    "credentials": [],
    "nodes": [
      "dist/nodes/SseClient/SseClient.node.js"
    ]
  },
  "devDependencies": {
    "@n8n/node-cli": "*",
    "typescript": "~5.9.0"
  },
  "peerDependencies": {
    "n8n-workflow": "*"
  }
}
```

---

## Use Case : Telegram ↔ Claude Managed Agent

Ce node est créé dans le cadre d'un projet plus large : connecter Telegram à un Claude Managed Agent via 2 workflows n8n.

### Workflow 1 — Receiver (< 1s)

```
Telegram Trigger
  → Set (chat_id, text)
  → HTTP Request: sendChatAction "typing"
  → Execute Workflow 2 (waitForCompletion: false)
```

### Workflow 2 — Processor

```
Execute Workflow Trigger (chat_id, text)
  → HTTP Request: POST /v1/sessions (créer session)
  → HTTP Request: POST /v1/sessions/{id}/events (envoyer message)
  → SSE Client (ce node)
      URL: https://api.anthropic.com/v1/sessions/{{ $('Create Session').item.json.id }}/events/stream
      Auth: Header Auth (x-api-key: sk-ant-xxx)
      Headers: anthropic-version: 2023-06-01, anthropic-beta: managed-agents-2026-04-01
      Stop Event Type: session\.status_(idle|terminated)
      Timeout: 300000
  → Code: extraire texte des events agent.message
  → HTTP Request: sendMessage Telegram
```

### Config Claude MA

- Agent ID : `agent_011Ca73zrLWF6QuYwEuVxzJG`
- Environment ID : `env_01MAxLFCckVBtYbKs6DB9Vr8`
- API headers requis : `anthropic-version: 2023-06-01`, `anthropic-beta: managed-agents-2026-04-01`
- Auth : `x-api-key: <ANTHROPIC_API_KEY>`

---

## Installation sur n8n self-hosted

```bash
# Dev (npm link)
cd /path/to/n8n-nodes-sse-client
npm install && npm run build && npm link
cd ~/.n8n/custom && npm link n8n-nodes-sse-client
# Redémarrer n8n

# Prod (npm install, si publié)
cd ~/.n8n && npm install n8n-nodes-sse-client
# Redémarrer n8n

# GUI n8n (si publié sur npm)
Settings > Community Nodes > Install > "n8n-nodes-sse-client"
```

---

## Séquence d'implémentation

1. Scaffolding du projet (`package.json`, `tsconfig.json`, structure dossiers)
2. Squelette du node (description, propriétés, credentials) — compile mais ne fait rien
3. Logique SSE cœur (fetch + ReadableStream + parsing protocole SSE)
4. Stop conditions (regex sur event type + data)
5. Auth (Bearer + Header Auth) + custom headers
6. Retry + timeout + error handling + cancellation n8n
7. Codex metadata + icône SVG + README
8. Build + lint + test local avec endpoint SSE public (https://sse.dev/test)
9. Test avec Claude MA API
10. Créer les 2 workflows n8n Telegram
11. Test end-to-end : message Telegram → réponse agent

---

## Critères d'acceptation

- [ ] `npm run build` compile sans erreur
- [ ] `npm run lint` passe
- [ ] Le node apparaît dans l'éditeur n8n après installation
- [ ] Connexion à un endpoint SSE public fonctionne (https://sse.dev/test)
- [ ] Auth Header fonctionne avec l'API Claude MA
- [ ] Custom headers (anthropic-version, anthropic-beta) sont envoyés
- [ ] URL dynamique avec expressions n8n fonctionne
- [ ] Stop condition regex arrête la collecte au bon moment
- [ ] Timeout retourne les événements collectés (pas d'erreur si des events existent)
- [ ] Message Telegram → réponse agent complète reçue dans Telegram

## Références

- [Source code SSE Trigger natif n8n](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/SseTrigger/SseTrigger.node.ts)
- [Source code SSE Trigger Extended (community)](https://github.com/ResetNetwork/n8n-nodes/blob/main/n8n-nodes-sse-trigger-extended/nodes/trigger/SseTriggerExtended/SseTriggerExtended.node.ts)
- [n8n community node building docs](https://docs.n8n.io/integrations/community-nodes/build-community-nodes/)
- [Claude Managed Agents API — Sessions](https://platform.claude.com/docs/en/managed-agents/overview)
- [SSE specification (RFC 8895)](https://html.spec.whatwg.org/multipage/server-sent-events.html)
