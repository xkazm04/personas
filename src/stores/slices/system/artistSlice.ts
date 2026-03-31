import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { ArtistTab } from "@/lib/types/types";

export type GalleryMode = "2d" | "3d";
export type BlenderMcpState = "not-installed" | "installed" | "running" | "error";

export interface ArtistSlice {
  artistTab: ArtistTab;
  galleryMode: GalleryMode;
  blenderMcpState: BlenderMcpState;
  artistFolder: string | null;

  setArtistTab: (tab: ArtistTab) => void;
  setGalleryMode: (mode: GalleryMode) => void;
  setBlenderMcpState: (state: BlenderMcpState) => void;
  setArtistFolder: (folder: string | null) => void;
}

export const createArtistSlice: StateCreator<SystemStore, [], [], ArtistSlice> = (set) => ({
  artistTab: "blender" as ArtistTab,
  galleryMode: "2d" as GalleryMode,
  blenderMcpState: "not-installed" as BlenderMcpState,
  artistFolder: null,

  setArtistTab: (tab) => set({ artistTab: tab }),
  setGalleryMode: (mode) => set({ galleryMode: mode }),
  setBlenderMcpState: (state) => set({ blenderMcpState: state }),
  setArtistFolder: (folder) => set({ artistFolder: folder }),
});
