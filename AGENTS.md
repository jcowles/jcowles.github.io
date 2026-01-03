# Agent Notes for `visualcore`

## Project Shape
- **Stack**: React 19 + TypeScript, Vite, Tailwind CSS.
- **Entry Flow**: Single-screen experience (`src/App.tsx`) with a timed intro that animates the text “visual core” into a 128×128 canvas-driven pixel grid (`src/components/PixelGrid.tsx`). There is no client-side routing.
- **Build Targets**: Root-level Vite project with `dist/` output. GitHub Pages deploy workflow (`.github/workflows/deploy.yml`) expects `npm` scripts to run from the repo root and publishes the `dist` folder along with `public/CNAME` (custom domain: `visualcore.com`).

## Implementation Guidelines
1. **App Structure**
   - Keep the app single-screen unless the owner explicitly requests routing. If new views are needed, prefer toggling states inside `App.tsx` before adding React Router.
   - Organize new shared UI or logic under `src/components/`. Avoid reintroducing the previous `features/` or `pages/` directories unless the site significantly expands.

2. **Styling**
   - Tailwind is the primary styling tool; add utilities or `@layer` rules in `src/index.css` if necessary. Maintain the dark, minimal aesthetic.
   - Fonts are loaded via the Google Fonts import at the top of `src/index.css`. Keep typography consistent with `font-display` / `font-sans` families already configured in `tailwind.config.js`.

3. **Animations & Interactivity**
   - The intro timing is governed by constants in `src/App.tsx` (`INTRO_DURATION`, per-character durations). When tweaking animation curves or timings, keep transitions accessible (e.g., allow keyboard skip via space/enter and pointer click).
   - The pixel grid relies on canvas rendering tied to `window.requestAnimationFrame`. Any adjustments should preserve performance at 128×128 cells.

4. **Testing**
   - Tests live alongside components (e.g., `src/App.test.tsx`). Use Vitest with Testing Library. There is a canvas mock in `src/test/setup.ts`; extend it if more canvas APIs are used.
   - Existing tests focus on ensuring the splash renders, responds to skip, and transitions cleanly. Add similar high-level behavior tests rather than snapshot or implementation-detail checks.

5. **Tooling & Scripts**
   - `package.json` scripts (`dev`, `build`, `lint`, `test`, etc.) run from the root. Keep any new tooling in line with the current setup.
   - The project expects Node ≥20.19 (Vite requirement). If adding dependencies, verify they support that minimum.

6. **Assets & Static Files**
   - Static assets belong in `public/`. The `CNAME` file must stay intact for GitHub Pages.
   - Avoid reintroducing `visualcore-app/` or other nested app directories.

By default, preserve the minimal fullscreen concept. Coordinate with the owner before introducing navigation, complex state management, or large visual changes.
