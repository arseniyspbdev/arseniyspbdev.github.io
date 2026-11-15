# Demo redesign — 2026-11-14

Eight individual visual identities are layered over the existing demo applications.
`studio.css` and `studio.js` provide shared navigation, viewport safety and optional reveals.
Each demo owns its `redesign.css`. Original interaction selectors and form logic are preserved.
Cake and pottery scene backgrounds were adjusted to the new palettes; candle and kiln scenes retain their dark mode.
Telegram theme variables remain authoritative in the barber application.

## Verification

- Inline JavaScript syntax and local file references checked for all eight pages.
- Browser layout checks at 320, 390, 600, 768 and 1280 pixels: no document overflow.
- Browser checks: repair/class selection, flower addition, nail shade selection,
  schedule filter, cake tabs, barber service selection, pottery controls and coffee booking controls.
- Mobile visual review of every demo, including rendered cake and pottery models.
- Real Telegram host, real iPhone Safari and external submission backends were not tested.
- The main portfolio now uses current WebP screenshots in `previews/`. Old interaction videos remain archived in `reels/` and are no longer loaded by the main page.

Full before/after source archives are stored outside the repository under `site-backups/`.
