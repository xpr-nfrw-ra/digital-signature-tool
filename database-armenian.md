# Տվյալների Բազայի Նկարագրություն

**Ծրագիր:** Digital Signature Tool  
**Տվյալների բազա:** SQLite (Prisma ORM-ի միջոցով)  
**Ֆայլ:** `digital-signature-tool/dev.db`  
**Սխեմա:** `digital-signature-tool/prisma/schema.prisma`

---

## Տեղադրում և Օգտագործում

### Առաջին անգամ

```bash
cd digital-signature-tool
npm install                  # postinstall hook-ով կանչում է `prisma generate`
npx prisma migrate deploy    # ստեղծում է dev.db և կիրառում բոլոր միգրացիաները
```

`dev.db`-ն ստեղծվում է `digital-signature-tool/dev.db` ճանապարհով։ Այն gitignore-ված է։

### Տվյալների զննում

```bash
npx prisma studio    # բացում է web UI հասցեով http://localhost:5555
```

### Սխեմայի փոփոխություն

1. Խմբագրեք `prisma/schema.prisma`
2. Գործարկեք `npx prisma migrate dev --name <description>` — ստեղծում և կիրառում է միգրացիան
3. Միգրացիան պահվում է `prisma/migrations/` պանակում և պետք է commit արվի

### Տվյալների բազայի վերագործարկում (բոլոր տվյալները ջնջվում են)

```bash
npx prisma migrate reset
```

### Որտեղ են սահմանված և կիրառվում սահմանափակումները

**Կարճ պատասխան.** Երկարության և ձևի (regex, արգելված նիշեր, ճշգրիտ երկարություն) կանոնները կիրառվում են API-ի մուտքում՝ [server/validators.js](digital-signature-tool/server/validators.js) ֆայլում։ Բոլոր write route-երը (`auth.js`, `keys.js`, `signatures.js`) կանչում են `validate()` մինչ տվյալների բազային դիմելը, և անվավեր մուտքը մերժվում է 400 պատասխանով՝ դեռ Prisma-ից առաջ։ SQLite-ն ինքնին կիրառում է միայն տիպերը, `NOT NULL`-ը, `UNIQUE`-ը և օտար բանալիները (հայտարարված `prisma/schema.prisma`-ում); այն անտեսում է `VARCHAR(n)` երկարությունը և չունի regex աջակցություն — այդ պատճառով երկարության և նիշերի դասի կանոնները կրում է հավելվածի մակարդակը։

Սահմանափակումները բնակվում են երեք տեղում — բոլոր երեքն էլ ստուգեք, երբ ստուգում եք սյունի կանոնները.

1. **Prisma սխեմա** (`prisma/schema.prisma`) — հիմնական աղբյուր։ Տիպեր, nullability, `@unique`, `@default`, FK կապեր և `onDelete`։
2. **SQLite — DB-ի կողմից կիրառվող սահմանափակումներ:**

   ```bash
   sqlite3 dev.db ".schema <table>"
   sqlite3 dev.db "PRAGMA table_info(<table>);"
   sqlite3 dev.db "PRAGMA foreign_key_list(<table>);"
   sqlite3 dev.db "PRAGMA index_list(<table>);"
   ```

3. **API մակարդակի սահմաններ և ձևի կանոններ** — SQLite-ը անտեսում է `VARCHAR(n)`-ը և չունի նիշերի դասերի սահմանափակում, ուստի թե՛ երկարության սահմանները, թե՛ ձևի կանոնները (regex, արգելված նիշեր, ճշգրիտ երկարություններ) կիրառվում են [server/validators.js](digital-signature-tool/server/validators.js)-ում։ `LIMITS` օբյեկտը հանդիսանում է ճշմարտության աղբյուր — տես այնտեղ դաշտերի ճշգրիտ կանոնները։

---

## Ընդհանուր Կառուցվածք

Տվյալների բազան բաղկացած է 5 աղյուսակից, որոնք բոլորը կապված են `users` աղյուսակի հետ.

```text
users ──< sessions
users ──< signature_log
users ──< public_keys
users ──1 user_settings
```

`──<` նշանը ցույց է տալիս **մեկ-բազմ** (one-to-many) կապ։ `──1` նշանը ցույց է տալիս **մեկ-մեկ** (one-to-one) կապ։

---

## Աղյուսակները

### 1. `users` — Օգտատերեր

**Նպատակ:** Պահում է գրանցված օգտատերերի տվյալները։ Փոխարինում է հին `data/users.json` ֆայլին։

| Սյուն | Տիպ | Նկարագրություն |
|-------|-----|----------------|
| `id` | INTEGER (PK) | Ավտոմատ, եզակի ID |
| `username` | TEXT (unique) | Օգտատիրոջ անուն — չի կրկնվում։ API մակարդակում՝ 3–32 նիշ, `^[a-zA-Z0-9_.-]+$` (տառեր, թվեր, `.`, `_`, `-`) |
| `password_hash` | TEXT | Bcrypt-ով հեշավորված գաղտնաբառ (60 նիշ) |
| `created_at` | DATETIME | Գրանցման ամսաթիվ |

**Կարևոր.** Գաղտնաբառերը երբեք բաց տեքստով չեն պահվում — միայն bcrypt հեշ։

---

### 2. `sessions` — Նստաշրջաններ

**Նպատակ:** Պահում է մուտքային նստաշրջանների տվյալները։ Փոխարինում է `express-session`-ի RAM-ի հիշողությանը, ինչի շնորհիվ նստաշրջանը չի կորչում սերվերի վերագործարկման ժամանակ։

| Սյուն | Տիպ | Նկարագրություն |
|-------|-----|----------------|
| `id` | TEXT (PK) | express-session-ի ID |
| `user_id` | INTEGER (FK, nullable) | Կապ `users.id`-ի հետ — `null` է անանուն նստաշրջանների համար |
| `session_data` | TEXT | JSON ձևաչափով կոդավորված նստաշրջանի տվյալներ |
| `expires_at` | DATETIME (indexed) | Ժամկետի ավարտ |

**Կապ.** `user_id` → `users.id` (CASCADE — օգտատիրոջ ջնջման դեպքում նստաշրջաններն էլ ջնջվում են)։

**Իրականացում.** [server/sessionStore.js](digital-signature-tool/server/sessionStore.js) — express-session-ի համար գրված անհատական `Store`, որը պահոցը պահում է Prisma-ով։ Ժամկետանց տողերը ջնջվում են սերվերի մեկնարկին `cleanupExpiredSessions()` ֆունկցիայով և ընթացքի մեջ՝ ժամկետանց տողերը կարդալիս։

---

### 3. `signature_log` — Ստորագրությունների մատյան

**Նպատակ:** Ամրագրում է ստորագրման բոլոր իրադարձությունները՝ աուդիտի և հետագա ստուգման համար։

| Սյուն | Տիպ | Նկարագրություն |
|-------|-----|----------------|
| `id` | INTEGER (PK) | Ավտոմատ ID |
| `user_id` | INTEGER (FK) | Ով ստորագրել է — կապ `users.id`-ի հետ |
| `document_name` | TEXT | Ստորագրված ֆայլի անուն կամ պիտակ։ API մակարդակում՝ 1–255 նիշ, առանց control նիշերի, առանց `/` կամ `\` |
| `document_hash` | TEXT | Ստորագրված բովանդակության hex hash։ API մակարդակում՝ ճշգրիտ 64 / 96 / 128 նիշ (SHA-256 / 384 / 512) |
| `public_key_id` | INTEGER (FK) | Որ բանալիով է ստորագրված — կապ `public_keys.id`-ի հետ |
| `signed_at` | DATETIME | Ստորագրման ժամ |

**Կապեր.** `user_id` → `users.id`, `public_key_id` → `public_keys.id`։

**Օգտագործման դեպք.** «Արդյո՞ք այս օգտատերն ստորագրել է այս փաստաթուղթը այս ժամին»։ Ստուգման ժամանակ FK-ի միջոցով անմիջական join է կատարվում `public_keys` աղյուսակի հետ՝ ստանալով fingerprint և PEM։

**Կրիպտոն.** Ստորագրման գործողությունը ամբողջությամբ կատարվում է բրաուզերում (forge.js-ի միջոցով)։ Տվյալների բազան պահում է *ապացույց* ստորագրման մասին, ոչ թե կատարում կրիպտոգրաֆիկ գործողություն։

**Չափի սահմանափակումներ.** SQLite-ը VARCHAR երկարությունը չի կիրառում։ Վերը նշված սահմանաչափերը ստուգվում են API մակարդակում՝ [server/validators.js](digital-signature-tool/server/validators.js) ֆայլում։

---

### 4. `public_keys` — Հանրային բանալիներ

**Նպատակ:** Թույլ է տալիս օգտատերերին պահել իրենց հանրային բանալիները սերվերի կողմից, որպեսզի այլ օգտատերերը կարողանան դրանք ստանալ ստուգման ժամանակ՝ առանց ձեռքով բանալի փոխանակման։

| Սյուն | Տիպ | Նկարագրություն |
|-------|-----|----------------|
| `id` | INTEGER (PK) | Ավտոմատ ID |
| `user_id` | INTEGER (FK) | Կապ `users.id`-ի հետ |
| `fingerprint` | TEXT (unique) | Բանալու SHA-256 մատնահետք (SPKI DER-ի hex)։ API մակարդակում՝ ճշգրիտ 64 hex նիշ |
| `public_key_pem` | TEXT | Հանրային բանալի PEM ձևաչափով։ API մակարդակում՝ 100–8192 նիշ, պարտադիր `-----BEGIN PUBLIC KEY-----…-----END PUBLIC KEY-----` ձևաչափով |
| `label` | TEXT | Օգտատիրոջ կողմից տված անուն (օր.՝ «Աշխատանքային բանալի»)։ API մակարդակում՝ 1–64 նիշ, առանց control նիշերի |
| `created_at` | DATETIME | Ավելացման ամսաթիվ |

**Կապ.** `user_id` → `users.id`։

**Կարևոր.** Մեկ օգտատերը կարող է ունենալ **բազմաթիվ** հանրային բանալիներ։ Բոլորն էլ պահվում են և որոնելի են ինչպես username-ով, այնպես էլ fingerprint-ով։ Հանրային բանալիները կարող են պահվել սերվերում — դրանք գաղտնիք չեն։ **Մասնավոր բանալիներն** երբեք չեն ուղարկվում կամ պահվում սերվերի կողմից։

---

### 5. `user_settings` — Օգտատիրոջ կարգավորումներ

**Նպատակ:** Պահում է յուրաքանչյուր օգտատիրոջ կրիպտո/UI նախընտրությունները (հեշ ալգորիթմ, ստորագրման ալգորիթմ, բանալու չափ, default հանրային բանալի)։ 1-ին-1 կապ `users` աղյուսակի հետ։ Փոխարինում է բրաուզերի RAM-ում պահվող `appSettings`-ին։

| Սյուն | Տիպ | Նկարագրություն |
|-------|-----|----------------|
| `user_id` | INTEGER (PK, FK) | Տերը — նաև primary key (1-ին-1 կապ `users.id`-ի հետ) |
| `hash_algorithm` | TEXT | `sha256` \| `sha384` \| `sha512` (SHA-3-ը հետաձգված է — forge.js չի աջակցում) |
| `signature_algorithm` | TEXT | `rsa` \| `ecdsa` |
| `key_size` | INTEGER | `2048` \| `3072` \| `4096` |
| `default_public_key_id` | INTEGER (FK, nullable) | Ստորագրման համար նախընտրելի բանալու **bookmark**։ **Չի** սահմանափակում, թե որ բանալիներն են պահվում կամ վերադարձվում որոնման արդյունքում — օգտատերը կարող է ունենալ բազմաթիվ բանալիներ, և բոլորն էլ որոնելի են։ |
| `updated_at` | DATETIME | Վերջին փոփոխման ժամ |

**Կապեր.** `user_id` → `users.id` (CASCADE), `default_public_key_id` → `public_keys.id` (SET NULL ջնջման դեպքում)։

**API.** `GET /api/settings` և `PUT /api/settings` (պահանջում է authentification)։ Default-երը տեղադրվում են գրանցման ժամանակ։

---

## Կապերի Ամփոփ Սխեման

```text
┌─────────────────────────────────────┐
│               users                 │
│─────────────────────────────────────│
│ id (PK)                             │
│ username                            │
│ password_hash                       │
│ created_at                          │
└──────────┬──────────────────────────┘
           │ (1)
    ┌──────┴───────────────────────┐
    │ (բազում — many)              │
    │                              │
    ▼              ▼               ▼
┌─────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────┐
│sessions │ │signature_log │ │public_   │ │user_settings │
│         │ │              │ │keys      │ │              │
│id       │ │id            │ │id        │ │user_id (PK)  │
│user_id? │ │user_id       │ │user_id   │ │hash_algo     │
│session_ │ │document_name │ │finger-   │ │sig_algo      │
│data     │ │document_hash │ │print     │ │key_size      │
│expires_ │ │public_key_id ├─┤public_   │ │default_pk_id?│
│at       │ │signed_at     │ │key_pem   │ │updated_at    │
└─────────┘ └──────────────┘ │label     │ └──────────────┘
                             │created_at│
                             └──────────┘

signature_log.public_key_id → public_keys.id (FK)
user_settings.default_public_key_id → public_keys.id (FK, nullable)
```

Օգտատերը կարող է պահել **բազմաթիվ** հանրային բանալիներ։ Բոլորն էլ վերադարձվում են `GET /api/keys/by-username/:u` հարցումով։ `user_settings.default_public_key_id`-ն ընդամենը անձնական bookmark է — այն չի թաքցնում կամ սահմանափակում որևէ այլ բանալի։

---

## Տվյալների բազայից հարցումներ կատարելը

Տվյալների բազայից տեղեկություն ստանալու երեք եղանակ կա՝ կախված, թե ով է հարցումը կատարում։

### 1. Սերվերի կողմից — Prisma Client (հիմնական եղանակ)

Հավելվածի ողջ կոդը հարցումները կատարում է Prisma-ի typed JS client-ի միջոցով (`prisma.user`, `prisma.publicKey` և այլն)։ Client-ը import-վում է [server/userStore.js](digital-signature-tool/server/userStore.js) ֆայլում, և յուրաքանչյուր router օգտագործում է այն ուղղակիորեն։

```js
// Օգտատերի որոնում (auth.js)
await prisma.user.findUnique({ where: { username } });

// Username-ով գտնել տվյալ օգտատիրոջ ԲՈԼՈՐ հանրային բանալիները (keys.js)
const user = await prisma.user.findUnique({ where: { username } });
await prisma.publicKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
});

// Fingerprint-ով գտնել կոնկրետ բանալին (keys.js)
await prisma.publicKey.findUnique({ where: { fingerprint } });

// Ստորագրման մատյանի նոր գրառում, որը կապվում է բանալու fingerprint-ով (signatures.js)
const key = await prisma.publicKey.findUnique({ where: { fingerprint } });
await prisma.signatureLog.create({
    data: { userId, documentName, documentHash, publicKeyId: key.id },
});

// Օգտատիրոջ ստորագրման պատմություն՝ բանալու հետ join-ով (signatures.js)
await prisma.signatureLog.findMany({
    where: { userId },
    orderBy: { signedAt: 'desc' },
    include: { publicKey: { select: { fingerprint: true, label: true } } },
});
```

Բոլոր այս հարցումները async են և վերադարձնում են սովորական JS օբյեկտներ՝ սխեմայի կառուցվածքով։ Prisma-ն ինքն է կատարում պարամետրերի escape-ը — երբեք ձեռքով SQL մի կազմեք։

### 2. Բրաուզերի կողմից — HTTP API

Բրաուզերը ուղղակիորեն չի կարող մուտք գործել տվյալների բազա։ Այն կանչում է HTTP endpoint-ները, որոնք իրենց հերթին կատարում են վերը նշված Prisma հարցումները.

| Endpoint | Ինչ է անում |
|---|---|
| `GET  /api/auth/me` | Ընթացիկ նստաշրջանի մասին տեղեկություն |
| `GET  /api/settings`     `PUT /api/settings` | Կարդալ / փոփոխել `user_settings` |
| `POST /api/keys` | Գրանցել հանրային բանալի (սերվերը հաշվում է fingerprint, ավելացնում տող) |
| `GET  /api/keys/mine` | Ընթացիկ օգտատիրոջ բոլոր հանրային բանալիները |
| `GET  /api/keys/by-username/:u` | Տվյալ username-ով օգտատիրոջ բոլոր հանրային բանալիները |
| `GET  /api/keys/by-fingerprint/:fp` | Մեկ բանալի fingerprint-ով |
| `DELETE /api/keys/:id` | Ջնջել կանչողի սեփական բանալիներից մեկը |
| `POST /api/signatures` | Ամրագրել ստորագրման իրադարձություն |
| `GET  /api/signatures/mine` | Կանչողի ստորագրման պատմություն |

Բոլոր write endpoint-ները և lookup-ները պահանջում են authentication (`requireAuth`)։

### 3. Հավելվածից դուրս — Prisma Studio կամ raw SQL

Զննման, debugging-ի կամ մեկանգամյա հաշվետվությունների համար.

```bash
cd digital-signature-tool
npx prisma studio        # web UI http://localhost:5555 — դիտել ու խմբագրել ցանկացած տող
```

Ad-hoc SQL հարցումների համար.

```bash
sqlite3 dev.db                                 # բացում է SQLite shell
sqlite> .tables                                # ցույց է տալիս աղյուսակները
sqlite> .schema public_keys                    # ցույց է տալիս CREATE TABLE-ը
sqlite> SELECT username, COUNT(pk.id) AS keys
   ...> FROM users u LEFT JOIN public_keys pk ON pk.user_id = u.id
   ...> GROUP BY u.id;
```

Raw SQL-ը շրջանցում է Prisma-ն ու API-ն — օգտակար է զննման համար, բայց չպետք է օգտագործվի հավելվածի կոդում։ Եթե հավելվածի տրամաբանությունը պահանջում է այնպիսի հարցում, որը Prisma-ով հեշտ չի արտահայտվում, օգտագործեք `prisma.$queryRaw` (նույնպես parameterized) և ոչ թե `sqlite3`-ը։

---

## Անվտանգության Հիմնական Սկզբունք

> **Մասնավոր բանալիներն երբեք չպետք է պահվեն սերվերի կողմից։**

Բոլոր կրիպտոգրաֆիկ գործողությունները (ստորագրում, ստուգում, բանալիների գեներացում) կատարվում են **բրաուզերում**՝ forge.js-ի միջոցով։ Սերվերը պահում է.

- Հանրային բանալիներ (`public_keys`)
- Ստորագրման *ապացույց* (`signature_log`)
- Օգտատերերի տվյալներ (`users`)
- Նստաշրջանի տվյալներ (`sessions`)
- Օգտատիրոջ նախընտրությունները (`user_settings`)
