import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The one place the panel is named. Changing these two strings changes the
 * install prompt, the home-screen label and the browser tab together.
 */
const APP_NAME = "Office Panel";
const APP_SHORT_NAME = "Panel";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    /**
     * Installable, and able to open without a network.
     *
     * "Able to open" is the honest claim, and it is worth being precise about
     * why it is not "able to work". Every screen in this panel is a view onto
     * the server — a task list is rows from Mongo, a chat is a live socket —
     * so nothing here pretends those work offline. What the service worker
     * caches is the shell: the HTML, the JavaScript and the icons. Offline,
     * the app opens and says it cannot reach the server, which is a far better
     * answer than the browser's own error page.
     *
     * API responses are deliberately never cached. A stale task board that
     * looks live is worse than no task board, and caching authenticated
     * responses to disk is how one person's data ends up on a shared machine.
     */
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icons.svg"],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description:
          "Projects, tasks, team and client management for the studio — admin, team leader, employee and client panels.",
        // Falls through to the admin login, which is where an unauthenticated
        // visitor lands anyway.
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#ffffff",
        theme_color: "#2563EB",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            // Android crops icons to whatever shape the launcher uses, so the
            // maskable one carries the padding that keeps the mark inside it.
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],

        /**
         * Monaco is left out of the precache on purpose.
         *
         * Its language workers are enormous — the TypeScript one alone is
         * nearly 7 MB — and precaching means every panel user downloads all of
         * it on first visit, whether or not they ever open a workspace. There
         * would be nothing to show for the wait either: the editor is useless
         * without the files, and the files come from the API, which is not
         * cached. So these load on demand, over a network that by definition
         * has to be there anyway.
         */
        globIgnores: ["**/*.worker-*.js", "**/editor.api-*.js"],

        // Client-side routing: any navigation that is not a real file gets the
        // app shell — except the two paths that belong to the server.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/preview\//],

        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: {
        // Off in `npm run dev`: a service worker caching a dev build is the
        // single most common source of "I changed it and nothing happened".
        enabled: false,
      },
    }),
  ],
});
