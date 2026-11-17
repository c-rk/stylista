const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Body mesh data and the segmentation network ship as bundled binary assets.
config.resolver.assetExts.push('bin', 'onnx');

// three's CommonJS entry calls Node's process.emitWarning(), which does not exist in React
// Native and crashes the app at startup. Resolve every `three` import (including the CommonJS
// require inside @react-three/fiber) to the ES module build, which is also a single instance.
const threeModule = path.join(__dirname, 'node_modules/three/build/three.module.js');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeModule };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
