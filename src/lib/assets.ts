import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';

/** Resolves a bundled asset to a readable file:// URI on device. */
export async function assetUri(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  let uri = asset.localUri ?? asset.uri;
  // Android release builds can hand back a bare resource name; unpack it to the cache.
  if (!uri.includes(':')) {
    const dest = new File(Paths.cache, `asset-${asset.hash}.${asset.type}`);
    if (!dest.exists) await copyAsync({ from: uri, to: dest.uri });
    uri = dest.uri;
  }
  return uri;
}

/** Reads a bundled binary asset into memory. */
export async function assetBytes(module: number): Promise<ArrayBuffer> {
  const bytes = await new File(await assetUri(module)).bytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
