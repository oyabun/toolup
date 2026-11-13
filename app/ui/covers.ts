// Cover photos for the Catalog's featured packs, in the order the packs are listed in the catalog.
// All four covers are Tool up!'s own pixel art: a square one for the card, a wide one for the pack's page.
export interface Cover { /** A wider picture for the pack's own page, where the cover is a banner; the card's picture is used when there is none. */ banner?: string; file: string; title: string; artist: string; license: string; page: string }
export const COVERS: Cover[] = [
  {
    "file": "covers/workflow.png",
    "banner": "covers/workflow_banner.png",
    "title": "Superpowered workflow (pixel art)",
    "artist": "Tool up!",
    "license": "Own artwork",
    "page": ""
  },
  {
    "file": "covers/frontend.png",
    "banner": "covers/frontend_banner.png",
    "title": "Frontend toolbox (pixel art)",
    "artist": "Tool up!",
    "license": "Own artwork",
    "page": ""
  },
  {
    "file": "covers/productdesigner.png",
    "banner": "covers/productdesigner_banner.png",
    "title": "Product designer (pixel art)",
    "artist": "Tool up!",
    "license": "Own artwork",
    "page": ""
  },
  {
    "file": "covers/backend.png",
    "banner": "covers/backend_banner.png",
    "title": "Backend (pixel art)",
    "artist": "Tool up!",
    "license": "Own artwork",
    "page": ""
  }
];
