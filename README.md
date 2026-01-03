# visualcore

A minimal fullscreen experience for showcasing personal work. The entry animation presents “visual core” in oversized type, then dissolves each character into a 128×128 interactive pixel grid that reacts to pointer movement.

## Stack

- **React 19 + TypeScript** for UI logic
- **Vite** for dev server and build tooling
- **Tailwind CSS** for utility-first styling
- **Vitest + Testing Library** for lightweight tests

## Getting Started

```bash
npm install
npm run dev
```

The dev server runs on [http://localhost:5173](http://localhost:5173) with hot module replacement.

## Available Scripts

- `npm run dev` – launch the Vite dev server
- `npm run build` – type-check and output production assets to `dist/`
- `npm run preview` – serve the production build locally
- `npm run lint` – lint the project with ESLint
- `npm run test` – run Vitest once (CI-friendly)
- `npm run test:watch` – run Vitest in watch mode
- `npm run coverage` – generate V8 coverage reports
- `npm run check` – run linting and tests together

## Structure

```
src/
  App.tsx            // Splash-to-grid experience
  components/
    PixelGrid.tsx    // Canvas-based 128×128 grid renderer
  index.css          // Tailwind layers and global styles
  main.tsx           // React entry point
public/
  CNAME              // GitHub Pages custom domain (visualcore.com)
  vite.svg           // Placeholder asset
```

## Deployment

The GitHub Actions workflow (`.github/workflows/deploy.yml`) installs dependencies, runs lint/tests/build, and publishes `dist/` to the `gh-pages` branch using `peaceiris/actions-gh-pages`. The custom domain is preserved by copying `public/CNAME` into the build output.

## Notes

- The splash screen automatically transitions after **5 seconds**. Pressing `Enter`, `Space`, or clicking while the intro is visible will skip directly to the transition.
- The pixel grid redraws based on pointer position using a canvas for performance. Adjust the grid size or highlight behaviour inside `PixelGrid.tsx`.
- Vite recommends Node 20.19+ (or 22+). Running on Node 20.5.0 works but surfaces an engine warning during install/build.
