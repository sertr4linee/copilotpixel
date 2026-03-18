/**
 * Asset Loader - Loads furniture assets from per-folder manifests
 *
 * Scans assets/furniture/ subdirectories, reads each manifest.json,
 * and loads all PNG files into SpriteData format for use in the webview.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { CHAR_COUNT, CHAR_FRAMES_PER_ROW, WALL_BITMASK_COUNT } from '../shared/assets/constants.js';
import type {
  FurnitureAsset,
  FurnitureManifest,
  InheritedProps,
  ManifestGroup,
} from '../shared/assets/manifestUtils.js';
import { flattenManifest } from '../shared/assets/manifestUtils.js';
import {
  decodeCharacterPng,
  decodeFloorPng,
  parseWallPng,
  pngToSpriteData,
} from '../shared/assets/pngDecoder.js';
import type { CharacterDirectionSprites } from '../shared/assets/types.js';
export type { CharacterDirectionSprites } from '../shared/assets/types.js';

import { LAYOUT_REVISION_KEY } from './constants.js';

export type { FurnitureAsset };

export interface LoadedAssets {
  catalog: FurnitureAsset[];
  sprites: Map<string, string[][]>; // assetId -> SpriteData
}

export async function loadFurnitureAssets(workspaceRoot: string): Promise<LoadedAssets | null> {
  try {
    const furnitureDir = path.join(workspaceRoot, 'assets', 'furniture');

    if (!fs.existsSync(furnitureDir)) {
      console.log('ℹ️  No furniture directory found at:', furnitureDir);
      return null;
    }

    const entries = fs.readdirSync(furnitureDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    if (dirs.length === 0) {
      console.log('ℹ️  No furniture subdirectories found');
      return null;
    }

    const catalog: FurnitureAsset[] = [];
    const sprites = new Map<string, string[][]>();

    for (const dir of dirs) {
      const itemDir = path.join(furnitureDir, dir.name);
      const manifestPath = path.join(itemDir, 'manifest.json');

      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent) as FurnitureManifest;

        const inherited: InheritedProps = {
          groupId: manifest.id,
          name: manifest.name,
          category: manifest.category,
          canPlaceOnWalls: manifest.canPlaceOnWalls,
          canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
          backgroundTiles: manifest.backgroundTiles,
        };

        let assets: FurnitureAsset[];

        if (manifest.type === 'asset') {
          assets = [
            {
              id: manifest.id,
              name: manifest.name,
              label: manifest.name,
              category: manifest.category,
              file: manifest.file ?? `${manifest.id}.png`,
              width: manifest.width!,
              height: manifest.height!,
              footprintW: manifest.footprintW!,
              footprintH: manifest.footprintH!,
              isDesk: manifest.category === 'desks',
              canPlaceOnWalls: manifest.canPlaceOnWalls,
              canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
              backgroundTiles: manifest.backgroundTiles,
              groupId: manifest.id,
            },
          ];
        } else {
          if (manifest.rotationScheme) {
            inherited.rotationScheme = manifest.rotationScheme;
          }
          const rootGroup: ManifestGroup = {
            type: 'group',
            groupType: manifest.groupType as 'rotation' | 'state' | 'animation',
            rotationScheme: manifest.rotationScheme,
            members: manifest.members!,
          };
          assets = flattenManifest(rootGroup, inherited);
        }

        for (const asset of assets) {
          try {
            const assetPath = path.join(itemDir, asset.file);
            if (!fs.existsSync(assetPath)) continue;
            const pngBuffer = fs.readFileSync(assetPath);
            sprites.set(asset.id, pngToSpriteData(pngBuffer, asset.width, asset.height));
          } catch (err) {
            console.warn(
              `  ⚠️  Error loading ${asset.id}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }

        catalog.push(...assets);
      } catch (err) {
        console.warn(
          `  ⚠️  Error processing ${dir.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { catalog, sprites };
  } catch (err) {
    console.error(
      `[AssetLoader] ❌ Error loading furniture assets: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

export function loadDefaultLayout(assetsRoot: string): Record<string, unknown> | null {
  const assetsDir = path.join(assetsRoot, 'assets');
  try {
    let bestRevision = 0;
    let bestPath: string | null = null;

    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) {
          const rev = parseInt(match[1], 10);
          if (rev > bestRevision) {
            bestRevision = rev;
            bestPath = path.join(assetsDir, file);
          }
        }
      }
    }

    if (!bestPath) {
      const fallback = path.join(assetsDir, 'default-layout.json');
      if (fs.existsSync(fallback)) {
        bestPath = fallback;
      }
    }

    if (!bestPath) return null;

    const content = fs.readFileSync(bestPath, 'utf-8');
    const layout = JSON.parse(content) as Record<string, unknown>;
    if (bestRevision > 0 && !layout[LAYOUT_REVISION_KEY]) {
      layout[LAYOUT_REVISION_KEY] = bestRevision;
    }
    return layout;
  } catch (err) {
    console.error(
      `[AssetLoader] Error loading default layout: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

export interface LoadedWallTiles {
  sets: string[][][][];
}

export async function loadWallTiles(assetsRoot: string): Promise<LoadedWallTiles | null> {
  try {
    const wallsDir = path.join(assetsRoot, 'assets', 'walls');
    if (!fs.existsSync(wallsDir)) return null;

    const entries = fs.readdirSync(wallsDir);
    const wallFiles: { index: number; filename: string }[] = [];
    for (const entry of entries) {
      const match = /^wall_(\d+)\.png$/i.exec(entry);
      if (match) wallFiles.push({ index: parseInt(match[1], 10), filename: entry });
    }

    if (wallFiles.length === 0) return null;
    wallFiles.sort((a, b) => a.index - b.index);

    const sets: string[][][][] = [];
    for (const { filename } of wallFiles) {
      const pngBuffer = fs.readFileSync(path.join(wallsDir, filename));
      sets.push(parseWallPng(pngBuffer));
    }

    console.log(
      `[AssetLoader] ✅ Loaded ${sets.length} wall tile set(s) (${sets.length * WALL_BITMASK_COUNT} pieces total)`,
    );
    return { sets };
  } catch (err) {
    console.error(`[AssetLoader] ❌ Error loading wall tiles: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function sendWallTilesToWebview(webview: vscode.Webview, wallTiles: LoadedWallTiles): void {
  webview.postMessage({ type: 'wallTilesLoaded', sets: wallTiles.sets });
}

export interface LoadedFloorTiles {
  sprites: string[][][];
}

export async function loadFloorTiles(assetsRoot: string): Promise<LoadedFloorTiles | null> {
  try {
    const floorsDir = path.join(assetsRoot, 'assets', 'floors');
    if (!fs.existsSync(floorsDir)) return null;

    const entries = fs.readdirSync(floorsDir);
    const floorFiles: { index: number; filename: string }[] = [];
    for (const entry of entries) {
      const match = /^floor_(\d+)\.png$/i.exec(entry);
      if (match) floorFiles.push({ index: parseInt(match[1], 10), filename: entry });
    }

    if (floorFiles.length === 0) return null;
    floorFiles.sort((a, b) => a.index - b.index);

    const sprites: string[][][] = [];
    for (const { filename } of floorFiles) {
      const pngBuffer = fs.readFileSync(path.join(floorsDir, filename));
      sprites.push(decodeFloorPng(pngBuffer));
    }

    console.log(`[AssetLoader] ✅ Loaded ${sprites.length} floor tile patterns`);
    return { sprites };
  } catch (err) {
    console.error(`[AssetLoader] ❌ Error loading floor tiles: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function sendFloorTilesToWebview(webview: vscode.Webview, floorTiles: LoadedFloorTiles): void {
  webview.postMessage({ type: 'floorTilesLoaded', sprites: floorTiles.sprites });
}

export interface LoadedCharacterSprites {
  characters: CharacterDirectionSprites[];
}

export async function loadCharacterSprites(assetsRoot: string): Promise<LoadedCharacterSprites | null> {
  try {
    const charDir = path.join(assetsRoot, 'assets', 'characters');
    const characters: CharacterDirectionSprites[] = [];

    for (let ci = 0; ci < CHAR_COUNT; ci++) {
      const filePath = path.join(charDir, `char_${ci}.png`);
      if (!fs.existsSync(filePath)) return null;
      characters.push(decodeCharacterPng(fs.readFileSync(filePath)));
    }

    console.log(
      `[AssetLoader] ✅ Loaded ${characters.length} character sprites (${CHAR_FRAMES_PER_ROW} frames × 3 directions each)`,
    );
    return { characters };
  } catch (err) {
    console.error(`[AssetLoader] ❌ Error loading character sprites: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function sendCharacterSpritesToWebview(
  webview: vscode.Webview,
  charSprites: LoadedCharacterSprites,
): void {
  webview.postMessage({ type: 'characterSpritesLoaded', characters: charSprites.characters });
}

export function sendAssetsToWebview(webview: vscode.Webview, assets: LoadedAssets): void {
  const spritesObj: Record<string, string[][]> = {};
  for (const [id, spriteData] of assets.sprites) {
    spritesObj[id] = spriteData;
  }
  webview.postMessage({
    type: 'furnitureAssetsLoaded',
    catalog: assets.catalog,
    sprites: spritesObj,
  });
}
