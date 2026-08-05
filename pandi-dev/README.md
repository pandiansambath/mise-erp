# pandi-dev.dineai.cloud — everything, in one place

Ravishankar's personal developer page. Nothing here is part of the restaurant
product; it shares the deploy and the domain and nothing else.

**Why this folder exists:** *"I need all the codes in a separate folder... for
future enquiries I don't need to search — I can straight go to my dev page
code."* So this is the map, and it is kept accurate.

---

## Where every piece lives

| What | Where | Why not here |
|---|---|---|
| **UI components** | `frontend/pandi-dev/*.tsx` | Next resolves `@/…` inside `frontend/`, so they must live in that tree. This is the only folder they're in. |
| **The route** | `frontend/app/dev/page.tsx` | Next requires routes under `app/`. Thin file: reads the env switch, loads the photo list, renders `DevProfile`. |
| **Photos** | `frontend/public/dev/` | `public/` is the only directory Next serves statically. Built output — never hand-edited. |
| **Source photos** | `my_photos/album/` | Gitignored originals off his phone. |
| **Build + ops scripts** | `pandi-dev/scripts/` | ← you are here |
| **Subdomain routing** | `frontend/middleware.ts` + `backend/app/api/site.py` | One line each: `pandi-dev` is recognised as a host and rewritten to `/dev`. Deliberately shared with the product's subdomain handling rather than duplicated. |

## The components

| File | Does |
|---|---|
| `DevProfile.tsx` | The page. Composes everything below. |
| `SkillOrbit.tsx` | **Solar system** — he is the star, his real résumé skills orbit as the planets. Inner rings faster (Kepler). Portrait auto-swaps every 65s with a cross-fade + drift, and is colour-graded into the page. |
| `Atmosphere.tsx` | Aurora blooms, a wave horizon, and scroll parallax. Sits *behind* the chain. |
| `ChainField.tsx` | The blockchain-style linked background — the "structure" layer. |
| `BootSequence.tsx` | The entry gate. Preloads every album thumbnail before letting you in, so the album is instant. |
| `Album.tsx` | The hidden photo album. |
| `Terminal.tsx` | The interactive terminal (`help`, `skills`, `contact`, `open linkedin`…). |
| `DecryptText.tsx` | The character-scramble reveal used on the name and title. |

Motion keyframes are namespaced `dev*` in `frontend/app/globals.css`
(`devFadeUp`, `devSpin`, `devOrbit`, `devAurora`, `devWave`) — prefixed so they
can never collide with the product's own motion vocabulary. Each has a
`prefers-reduced-motion` opt-out.

## Scripts

```bash
# Rebuild the album from my_photos/album/ into three tiers (thumb/full/blur).
python pandi-dev/scripts/build_dev_album.py

# The kill switch. Takes the page down WITHOUT a deploy or a code change.
bash pandi-dev/scripts/toggle_dev_site.sh off      # 404, as if it never existed
bash pandi-dev/scripts/toggle_dev_site.sh on
bash pandi-dev/scripts/toggle_dev_site.sh status
```

`_dev_site_remote.sh` runs **on the EC2 box** and is invoked by
`toggle_dev_site.sh` over SSM — never call it directly.

## The off switch

`DEV_PROFILE_ENABLED` on the backend container. Default **ON**. The check runs
**server-side**, so when it is off the page is never rendered and never sent —
hiding it with CSS would still ship every byte and anyone could read it in
devtools.

## The rule this page is built on

**Identity only — never company or project detail.** Who he is, where he is,
email, LinkedIn, Instagram, one portrait, the album, and the technologies he
works with. No employer names, no client work, no NIRAI/DineAI specifics.
`scripts/verify_live.sh` asserts this on every check ("no company/project
detail leaked").
