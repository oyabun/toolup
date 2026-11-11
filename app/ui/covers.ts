// Cover photos for the Catalog's featured packs, in the order the packs are listed in the catalog.
// All are CC0 or public domain, from Wikimedia Commons; the credits are shown in Settings.
export interface Cover { file: string; title: string; artist: string; license: string; page: string }
export const COVERS: Cover[] = [
  {
    "file": "covers/workflow.jpg",
    "title": "Late 2010 MacBook Air.jpg",
    "artist": "Alejandro Escamilla",
    "license": "CC0",
    "page": "https://commons.wikimedia.org/wiki/File:Late_2010_MacBook_Air.jpg"
  },
  {
    "file": "covers/frontend.jpg",
    "title": "Code on computer monitor (Unsplash).jpg",
    "artist": "Markus Spiske markusspiske",
    "license": "CC0",
    "page": "https://commons.wikimedia.org/wiki/File:Code_on_computer_monitor_(Unsplash).jpg"
  },
  {
    "file": "covers/designer.jpg",
    "title": "Colored pencils lined up on pink surface.jpg",
    "artist": "Artsy Crafty",
    "license": "CC0",
    "page": "https://commons.wikimedia.org/wiki/File:Colored_pencils_lined_up_on_pink_surface.jpg"
  },
  {
    "file": "covers/backend.jpg",
    "title": "Data center roof.jpg",
    "artist": "Rsparks3",
    "license": "CC0",
    "page": "https://commons.wikimedia.org/wiki/File:Data_center_roof.jpg"
  },
  {
    "file": "covers/ship.jpg",
    "title": "Brightly lit STS-135 on launch pad 39a.jpg",
    "artist": "Bill Ingalls",
    "license": "Public domain",
    "page": "https://commons.wikimedia.org/wiki/File:Brightly_lit_STS-135_on_launch_pad_39a.jpg"
  },
  {
    "file": "covers/docs.jpg",
    "title": "Books on library shelves, Davison Building, Royal Holloway University of London, Surrey - September 2026 - 01.jpg",
    "artist": "Mertbiol",
    "license": "CC0",
    "page": "https://commons.wikimedia.org/wiki/File:Books_on_library_shelves,_Davison_Building,_Royal_Holloway_University_of_London,_Surrey_-_September_2026_-_01.jpg"
  }
];
