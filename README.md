# ArchaeoPlan v0.1.2

Første GitHub Pages-version af ArchaeoPlan.

## Funktioner

- GLB og GLTF
- OBJ med MTL og teksturbilleder
- PLY
- Flere modeller i samme scene
- Perspektiv og ortografisk visning
- Top, bund, front, bag, venstre og højre
- Flytning og rotation af modeller
- Vis/skjul og lås modeller
- Neutral gengivelse uden scenelys og tone mapping
- PNG-eksport
- Touch-betjening på iPad og mobil

## Publicering på GitHub Pages

1. Opret et nyt repository på GitHub, eksempelvis `ArchaeoPlan`.
2. Upload alle filerne fra denne mappe til repositoryets øverste niveau.
3. Åbn **Settings → Pages**.
4. Vælg **Deploy from a branch**.
5. Vælg `main` og mappen `/root`.
6. Tryk **Save**.

GitHub viser derefter adressen til programmet.

## OBJ-filer

Ved OBJ skal OBJ-filen, MTL-filen og alle teksturbilleder vælges samtidig.

## Privatliv

Modellerne indlæses lokalt i browseren og sendes ikke til GitHub eller andre servere.

## Kendte begrænsninger

Denne version bruger Three.js fra jsDelivr og kræver derfor internetforbindelse ved opstart.
Beskæring, profilklip og projektgemning kommer i senere versioner.


## Nyt i v0.1.2

- Ny knap: **Nyt projekt**
- Ny knap: **Tilføj fil**
- Filvælgeren accepterer nu GLB på iPad uden at gråtone filen
- Bedre bevarelse af originale GLB- og OBJ-teksturer
- GLTF kan indlæses sammen med separate BIN- og teksturfiler
- OBJ kan indlæses sammen med MTL- og teksturfiler
- Filvælgeren nulstilles efter import, så samme fil kan vælges igen
