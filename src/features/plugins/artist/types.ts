export type ArtistTab = "blender" | "gallery";
export type GalleryMode = "2d" | "3d";
export type BlenderMcpState = "not-installed" | "installed" | "running" | "error";

export interface GalleryFilter {
  search: string;
  sortBy: "name" | "date" | "size";
  sortDir: "asc" | "desc";
  fileTypes: string[];
}

export const DEFAULT_GALLERY_FILTER: GalleryFilter = {
  search: "",
  sortBy: "date",
  sortDir: "desc",
  fileTypes: [],
};
