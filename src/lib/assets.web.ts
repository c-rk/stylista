import { Asset } from 'expo-asset';

export async function assetUri(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
}

export async function assetBytes(module: number): Promise<ArrayBuffer> {
  return (await fetch(await assetUri(module))).arrayBuffer();
}
